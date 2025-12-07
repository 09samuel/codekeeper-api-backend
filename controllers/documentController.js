const Document = require("../models/Document");
const User = require("../models/User");
const s3Service = require("../services/s3Service");
const path = require('path');

const axios = require('axios');

const WS_CONTROL_URL = process.env.WS_CONTROL_URL || 'http://localhost:1234/collab-event';

exports.createDocument = async (req, res) => {
  try {
    console.log("createDocument called");

    const user = req.user;
    const { title, content, parentFolderId, type } = req.body;

    // Validate type
    const docType = type || 'file';

    // Check storage limits for files
    if (docType === 'file') {
      const contentSize = Buffer.byteLength(content || '', 'utf8');
      
      // Get fresh user data with storage info
      const userWithStorage = await User.findById(user._id);
      if (!userWithStorage) {
        return res.status(404).json({ error: 'User not found' });
      }

      const storageLimit = userWithStorage.storageLimit || (100 * 1024 * 1024); 
      const storageUsed = userWithStorage.storageUsed || 0;

      if (storageUsed + contentSize > storageLimit) {
        return res.status(413).json({ 
          error: 'Storage limit exceeded',
          used: storageUsed,
          limit: storageLimit,
          required: contentSize,
          usedMB: (storageUsed / (1024 * 1024)).toFixed(2),
          limitMB: (storageLimit / (1024 * 1024)).toFixed(2),
          requiredMB: (contentSize / (1024 * 1024)).toFixed(2)
        });
      }
    }

    let inheritedCollaborators = [];
    if (docType === 'file' && parentFolderId) {
      const parentFolder = await Document.findById(parentFolderId);
      if (parentFolder && parentFolder.type === 'folder') {
        // Inherit collaborators but exclude the current user (who is now the owner)
        inheritedCollaborators = parentFolder.collaborators.filter(
          collab => collab.user.toString() !== user._id.toString()
        );
        
        // If the current user is NOT the folder owner, add folder owner as collaborator
        if (parentFolder.owner.toString() !== user._id.toString()) {
          inheritedCollaborators.push({
            user: parentFolder.owner,
            permission: 'edit', // Folder owner gets edit access to files in their folder
            addedBy: user._id,
          });
        }
      }
    }
    
    const doc = new Document({
      title: title,
      owner: user._id,
      type: docType,
      parentFolder: parentFolderId || null,
      collaborators: inheritedCollaborators,
      lastModifiedBy: user._id,
      contentSize: docType === 'file' ? Buffer.byteLength(content || '', 'utf8') : 0 
    });

    // In your createDocument endpoint
    if (docType === 'file') {
      const saved = await doc.save();

      let extension = path.extname(title);
      if (!extension || extension === '.') {
        extension = '.txt';
      }
      
      const s3Key = `files/${saved._id}${extension}`;
      
      try {
        const contentUrl = await s3Service.uploadPlainText(s3Key, content || "");
        
        // Verify upload succeeded
        //await s3Service.verifyFileExists(s3Key);
        
        saved.contentUrl = contentUrl;
        saved.s3Key = s3Key;
        await saved.save();

        // Update user's storageUsed
        await User.findByIdAndUpdate(user._id, {
          $inc: { storageUsed: saved.contentSize }
        });

        console.log(`[API] ✓ File ${saved._id} created at ${s3Key}`);

        // Return the COMPLETE document with all fields
        const completeDoc = saved.toObject();
        console.log('[API] Returning document:', completeDoc._id, 'with s3Key:', completeDoc.s3Key);

        if (parentFolderId) {
          await notifyCollaborators(parentFolderId, 'document-created', {
            document: completeDoc,
            createdBy: { _id: user._id, name: user.name, email: user.email }
          });
        }

        res.status(201).json(completeDoc);
      } catch (s3Error) {
        console.error(`[API] ✗ S3 upload failed:`, s3Error);
        await Document.findByIdAndDelete(saved._id);
        return res.status(500).json({ 
          error: 'File creation failed', 
          details: s3Error.message 
        });
      }
    }
  } catch (err) {
    console.error('[API] Error creating document:', err);
    res.status(500).json({ error: err.message });
  }
};





exports.createFolder = async (req, res) => {
  try {
    console.log("createFolder called");

    const user = req.user;
    const { title, parentFolderId } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Folder title is required' });
    }

    const folder = new Document({
      title: title.trim(),
      owner: user._id,
      type: 'folder',
      parentFolder: parentFolderId || null,
      lastModifiedBy: user._id
    });

    const saved = await folder.save();
    console.log(`[API] ✓ Folder ${saved._id} created: "${saved.title}"`);

    // Notify parent folder collaborators
    if (parentFolderId) {
      await notifyCollaborators(parentFolderId, 'document-created', {
        document: saved.toObject(),
        createdBy: { _id: user._id, name: user.name, email: user.email }
      });
    }
    
    res.status(201).json(saved);
  } catch (err) {
    console.error('[API] Error creating folder:', err);
    res.status(500).json({ error: err.message });
  }
};






exports.getUserDocuments = async (req, res) => {
  try {
    const user = req.user;
    const folderId = req.query.folder;

    console.log(`[API] getUserDocuments called by user ${user._id} for folder ${folderId || 'root'}`);
    
    const query = {
      $or: [
        { owner: user._id },
        { 'collaborators.user': user._id }
      ],
      parentFolder: folderId || null
    };
    
    const documents = await Document.find(query)
      .populate('owner', 'name email')
      .populate('collaborators.user', 'name email')
      .sort({ type: -1, title: 1 });
    
    const documentsWithPermissions = documents
      .map(doc => {
        try {
          // Skip if owner is null
          if (!doc.owner || !doc.owner._id) {
            console.warn(`Document ${doc._id} has null owner, skipping`);
            return null;
          }
          
          const isOwner = doc.owner._id.equals(user._id);
          
          // Safely find collaborator
          const collaborator = doc.collaborators?.find(c => 
            c.user && c.user._id && c.user._id.equals(user._id)
          );
          
          return {
            ...doc.toObject(),
            isOwner,
            userPermission: isOwner ? 'owner' : (collaborator?.permission || 'view'),
            sharedBy: isOwner ? null : (doc.owner.name || 'Unknown')
          };
        } catch (mapError) {
          console.error(`Error processing document ${doc._id}:`, mapError);
          return null;
        }
      })
      .filter(doc => doc !== null); // Remove null entries
    
    res.json(documentsWithPermissions);
  } catch (err) {
    console.error('Error in getUserDocuments:', err);
    res.status(500).json({ error: err.message });
  }
};



exports.getDocumentById = async (req, res) => {
  try {
    const user = req.user;
    const doc = await Document.findById(req.params.id)
      .populate("collaborators.user", "name email")
      .populate("owner", "name email");
      
    if (!doc) return res.status(404).json({ error: "Document not found" });

    // Check access permissions (owner or collaborator only)
    const isOwner = doc.owner._id.equals(user._id);
    const collaborator = doc.collaborators.find(c => c.user._id.equals(user._id));

    if (!isOwner && !collaborator) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get content from S3
    let content = '';
    if (doc.contentUrl) {
      content = await s3Service.getSignedUrlForKey(doc.s3Key);
    }

    // Return document with user's permission level
    const userPermission = isOwner ? 'owner' : collaborator.permission;
    
    res.json({ 
      ...doc.toObject(), 
      content,
      userPermission 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


exports.getSignedUrl = (req, res) => {
  s3Service.getSignedUrl(req, res);
};

exports.saveDocumentContent = async (req, res) => {
  try {
    const { documentId, content } = req.body;
    
    if (!documentId || content === undefined) {
      return res.status(400).json({ error: 'Missing documentId or content' });
    }
    
    // Check if content looks like an XML error
    if (content.trim().startsWith('<?xml') && content.includes('<Error>')) {
      console.error(`[API] Rejecting XML error content for ${documentId}`);
      return res.status(400).json({ error: 'Invalid content - XML error detected' });
    }
    
    console.log(`[API] Saving document ${documentId} (${content.length} chars)`);
    
    // Get document from MongoDB
    const doc = await Document.findById(documentId);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if user has enough space to save updated content
    const oldSize = doc.contentSize || 0;
    const newSize = Buffer.byteLength(content, 'utf8');
    const sizeDiff = newSize - oldSize;

    // If size increased, check quota
    if (sizeDiff > 0) {
      const user = await User.findById(doc.owner);
      if (!user) {
        return res.status(404).json({ error: 'Document owner not found' });
      }

      const storageLimit = user.storageLimit || (100 * 1024 * 1024);
      const storageUsed = user.storageUsed || 0;

      if (storageUsed + sizeDiff > storageLimit) {
        return res.status(413).json({ 
          error: 'Storage limit exceeded',
          used: storageUsed,
          limit: storageLimit,
          required: sizeDiff,
          usedMB: (storageUsed / (1024 * 1024)).toFixed(2),
          limitMB: (storageLimit / (1024 * 1024)).toFixed(2)
        });
      }
    }

    // Extract extension from title, default to .txt if none
    let extension = path.extname(doc.title);
      
    if (!extension || extension === '.') {
      extension = '.txt';
    }
    
    //  Build s3Key
    const s3Key = `files/${documentId}${extension}`;
    
    try {
      // Upload to S3 and get the URL
      const contentUrl = await s3Service.uploadPlainText(s3Key, content);
      
      // Update both contentUrl AND s3Key (like in createDocument)
      doc.contentUrl = contentUrl;  // The full S3 URL
      doc.s3Key = s3Key;             // The S3 key for future reference
      doc.lastModified = new Date();
      doc.lastModifiedBy = req.user?._id;
      await doc.save();


      if (sizeDiff !== 0) {
        await User.findByIdAndUpdate(doc.owner, {
          $inc: { storageUsed: sizeDiff }
        });
        console.log(`[API] Updated storage for user ${doc.owner}: ${sizeDiff > 0 ? '+' : ''}${sizeDiff} bytes`);
      }

      
      console.log(`[API] ✓ Document ${documentId} saved to S3 at ${s3Key}`);
      res.json({ success: true, message: 'Document saved to S3' });
    } catch (s3Error) {
      console.error(`[API] ✗ S3 upload failed for ${documentId}:`, s3Error);
      return res.status(500).json({ 
        error: 'Failed to save to S3', 
        details: s3Error.message 
      });
    }
  } catch (err) {
    console.error('[API] Error saving document:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.getDocumentPermission = async (req, res) => {
  try {
    console.log("getDocumentPermission called with ID:", req.params.id);

    const { id } = req.params;
    const userId = req.user._id; 

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check if user is the owner
    if (document.owner.toString() === userId.toString()) {
      return res.json({ permission: 'edit' });
    }

    // Check if user is in collaborators array
    const collaborator = document.collaborators.find(
      collab => collab.user.toString() === userId.toString()
    );
    if (collaborator) {
      return res.json({ permission: collaborator.permission });
    }

    // User has no access
    return res.status(403).json({ error: 'No access to this document' });

  } catch (error) {
    console.error('Error fetching permission:', error);
    res.status(500).json({ error: 'Server error' });
  }
 
}

exports.renameItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { title } = req.body;
    const user = req.user;

    const doc = await Document.findById(id);
    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if user has edit permission
    const isOwner = doc.owner.equals(user._id);
    const collaborator = doc.collaborators.find(c => c.user.equals(user._id));
    const hasEditPermission = isOwner || (collaborator && collaborator.permission === 'edit');

    if (!hasEditPermission) {
      return res.status(403).json({ error: "You don't have permission to edit this document" });
    }

    const oldTitle = doc.title;

    // Update document (works for both files and folders)
    doc.title = title;
    doc.lastModified = new Date();
    doc.lastModifiedBy = user._id;
    
    await doc.save();

    console.log(`[API] ✓ ${doc.type} "${id}" renamed to "${title}"`);

    // Notify all collaborators
    await notifyCollaborators(id, 'document-renamed', {
      oldTitle,
      newTitle: title,
      renamedBy: { _id: user._id, name: user.name, email: user.email }
    });

    res.json(doc);
  } catch (err) {
    console.error('[API] Error updating document:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    console.log(`[API] Delete request for document: ${id}`);

    // Fetch complete doc BEFORE deleting
    const doc = await Document.findById(id)
      .populate('collaborators.user', '_id name email')
      .populate('owner', '_id name email');
      
    if (!doc) {
      console.log(`[API] Document ${id} not found`);
      return res.status(404).json({ error: "Document not found" });
    }

    if (!doc.owner._id.equals(user._id)) {
      console.log(`[API] User ${user._id} is not owner of ${id}`);
      return res.status(403).json({ error: "Only the owner can delete this document" });
    }

    const parentFolderId = doc.parentFolder;
    const docTitle = doc.title;
    const docType = doc.type;
    let totalStorageReclaimed = 0;  

    // Delete S3 file if needed
    if (doc.s3Key && doc.type === 'file') {
      try {
        await s3Service.deleteFile(doc.s3Key);
        console.log(`[API] ✓ Deleted S3 file: ${doc.s3Key}`);
        totalStorageReclaimed += (doc.contentSize || 0);
      } catch (s3Error) {
        console.error('[API] Error deleting from S3:', s3Error);
      }
    }

    // Delete folder contents
    if (doc.type === 'folder') {
      console.log(`[API] Deleting folder contents for: ${id}`);
      const folderStorageReclaimed = await deleteFolder(doc._id, user._id);
      totalStorageReclaimed += folderStorageReclaimed;
    }

    // Delete doc from DB
    await Document.deleteOne({ _id: id });
    console.log(`[API] ✓ Document ${id} deleted from database`);

    if (totalStorageReclaimed > 0) {
      await User.findByIdAndUpdate(user._id, {
        $inc: { storageUsed: -totalStorageReclaimed }
      });
      console.log(`[API] Reclaimed ${totalStorageReclaimed} bytes for user ${user._id}`);
    }

    // Notify collaborators using fallback doc (because DB entry is gone)
    try {
      await notifyCollaborators(
        id,
        'document-deleted',
        {
          title: docTitle,
          type: docType,
          deletedBy: { _id: user._id, name: user.name, email: user.email }
        },
        doc // ← PRE-DELETED fallback doc for collaborator list
      );

      if (parentFolderId) {
        await notifyCollaborators(
          parentFolderId,
          'document-deleted',
          {
            documentId: id,
            title: docTitle,
            type: docType,
            deletedBy: { _id: user._id, name: user.name, email: user.email }
          }
        );
      }
    } catch (notifyError) {
      console.error('[API] Error notifying collaborators (non-fatal):', notifyError.message);
    }

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err) {
    console.error('[API] Error deleting document:', err);
    console.error('[API] Error stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
};


exports.checkOwnership = async (req, res) => {
  try {
    console.log("checkOwnership called with ID:", req.params.itemId);
    const item = await Document.findById(req.params.itemId);
    if (!item) return res.status(404).json({ isOwner: false });

    const isOwner = item.owner.toString() === req.user.id;
    res.json({ isOwner });
  } catch (err) {
    res.status(500).json({ isOwner: false });
  }
};


// Helper function to recursively delete folder and its contents
async function deleteFolder(folderId, userId) {
  let totalStorageReclaimed = 0;

  // Find all documents in this folder
  const children = await Document.find({ parentFolder: folderId });

  for (const child of children) {
    if (child.type === 'folder') {
      // Recursively delete subfolder and accumulate storage
      const subfolderStorage = await deleteFolder(child._id, userId);
      totalStorageReclaimed += subfolderStorage;
    } else if (child.s3Key) {
      // Delete file from S3 and track storage
      try {
        await s3Service.deleteFile(child.s3Key);
        totalStorageReclaimed += (child.contentSize || 0);
      } catch (err) {
        console.error(`[API] Error deleting S3 file ${child.s3Key}:`, err);
      }
    }
    // Delete child from DB
    await Document.deleteOne({ _id: child._id });
  }

  return totalStorageReclaimed; // Return total bytes reclaimed
}

async function notifyCollaborators(documentId, eventType, payload, fallbackDoc = null) {
  try {
    let doc = null;

    // Try loading document from DB (fails if deleted)
    if (documentId) {
      doc = await Document.findById(documentId)
        .populate('collaborators.user', '_id name email')
        .populate('owner', '_id name email');
    }

    // If the document is deleted, use fallback doc
    if (!doc && fallbackDoc) {
      console.log(`📁 Using fallback doc for event "${eventType}" for doc ${documentId}`);
      doc = fallbackDoc;
    }

    // If still no document → cannot notify
    if (!doc) {
      console.log(`⚠️ notifyCollaborators: No document found for ${documentId}, skipping`);
      return;
    }

    // Get recipients: owner + collaborators
    const recipients = [
      ...doc.collaborators.map(c => c.user._id.toString()),
      doc.owner._id.toString()
    ];

    console.log(`📡 Broadcasting "${eventType}" to ${recipients.length} users for doc ${documentId}`);

    await axios.post(WS_CONTROL_URL, {
      docId: documentId,
      type: eventType,
      payload: {
        ...payload,
        documentId,
        recipients
      }
    }).catch(err => {
      console.error(`Error broadcasting ${eventType}:`, err.message);
    });

  } catch (err) {
    console.error('Error in notifyCollaborators:', err);
  }
}

