const axios = require('axios');

const Document = require('../models/Document');
const User = require('../models/User');


const WS_CONTROL_URL = process.env.WS_CONTROL_URL || 'http://localhost:1234/collab-event';

// Get collaborators for a document
exports.getCollaborators = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id)
      .populate('collaborators.user', 'name email')
      .populate('owner', 'name email');

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Check if user has access to this document
    const hasAccess = document.owner._id.toString() === req.user.id ||
      document.collaborators.some(collab => collab.user._id.toString() === req.user.id);
      
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const collaborators = document.collaborators.map(collab => ({
      _id: collab.user._id,
      name: collab.user.name,
      email: collab.user.email,
      permission: collab.permission,
      addedAt: collab.addedAt,
      addedBy: collab.addedBy
    }));

    res.json({
      collaborators,
      owner: {
        _id: document.owner._id,
        name: document.owner.name,
        email: document.owner.email
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


exports.addCollaborator = async (req, res) => {
  try {
    const { email, permission } = req.body;
    const documentId = req.params.id;

    const document = await Document.findById(documentId);
    if (!document) return res.status(404).json({ error: 'Document not found' });

    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can add collaborators' });
    }

    const userToAdd = await User.findOne({ email });
    if (!userToAdd) return res.status(404).json({ error: 'User not found' });

    if (userToAdd._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself as collaborator' });
    }

    const addIfNotExists = (doc) => {
      const exists = doc.collaborators.some(
        (c) => c.user.toString() === userToAdd._id.toString()
      );
      if (exists) return false;

      doc.collaborators.push({
        user: userToAdd._id,
        permission: permission || 'view',
        addedBy: req.user.id,
      });

      return true;
    };

    // Track affected documents
    const affectedDocumentIds = [];
    let added = false;

    if (document.type === 'folder') {
      if (addIfNotExists(document)) {
        added = true;
        affectedDocumentIds.push(document._id.toString());
      }

      const allFiles = await getAllFilesInFolder(documentId);
      for (const file of allFiles) {
        if (addIfNotExists(file)) {
          added = true;
          affectedDocumentIds.push(file._id.toString());
          await file.save();
        }
      }

      await document.save();
    } else {
      if (addIfNotExists(document)) {
        added = true;
        affectedDocumentIds.push(document._id.toString());
        await document.save();
      }
    }

    await document.populate('collaborators.user', 'name email');

    const newCollaborator = document.collaborators.find(
      (c) => c.user._id.toString() === userToAdd._id.toString()
    );

    if (added) {
      console.log(`📢 Sending WS add notifications for ${affectedDocumentIds.length} documents`);
      
      // Send notification for each affected document
      const notifications = affectedDocumentIds.map(docId =>
        axios.post(WS_CONTROL_URL, {
          docId: docId,
          type: 'collaborator-added',
          payload: {
            _id: newCollaborator.user._id,
            name: newCollaborator.user.name,
            email: newCollaborator.user.email,
            permission: newCollaborator.permission,
            addedAt: newCollaborator.addedAt,
          }
        }).catch(e => console.error(`Error notifying for doc ${docId}:`, e.message))
      );

      await Promise.all(notifications);

      return res.json({
        _id: newCollaborator.user._id,
        name: newCollaborator.user.name,
        email: newCollaborator.user.email,
        permission: newCollaborator.permission,
        addedAt: newCollaborator.addedAt,
      });
    }

    return res.status(204).send();

  } catch (error) {
    console.error('Error adding collaborator:', error);
    res.status(500).json({ error: error.message });
  }
};




// Recursive helper: find all files inside a folder
async function getAllFilesInFolder(folderId) {
  const children = await Document.find({ parentFolder: folderId });
  let allFiles = [];

  for (const child of children) {
    if (child.type === 'file') {
      allFiles.push(child);
    } else if (child.type === 'folder') {
      // recursively get nested files
      const nestedFiles = await getAllFilesInFolder(child._id);
      allFiles = allFiles.concat(nestedFiles);
    }
  }
  return allFiles;
}

// Update collaborator permission
exports.updateCollaborator = async (req, res) => {
  try {
    console.log('Update collaborator called with params:', req.params, 'and body:', req.body);

    const { permission } = req.body;
    const { id, collaboratorId } = req.params;

    if (!['view', 'edit'].includes(permission)) {
      return res.status(400).json({ error: 'Invalid permission value' });
    }

    const document = await Document.findById(id);
    if (!document) return res.status(404).json({ error: 'Document not found' });

    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only owner can modify collaborators' });
    }

    const updatePermissionIfExists = (doc) => {
      const collaborator = doc.collaborators.find(
        (c) => c.user.toString() === collaboratorId
      );
      if (collaborator) {
        collaborator.permission = permission;
        doc.lastModified = new Date();
        doc.lastModifiedBy = req.user.id;
        return true; // Return true if updated
      }
      return false;
    };

    // Track all document IDs that were updated
    const updatedDocumentIds = [];

    if (document.type === 'folder') {
      if (updatePermissionIfExists(document)) {
        updatedDocumentIds.push(document._id.toString());
      }
      
      const allFiles = await getAllFilesInFolder(document._id);

      await Promise.all(allFiles.map(async (file) => {
        if (file.owner.toString() === document.owner.toString()) {
          if (updatePermissionIfExists(file)) {
            updatedDocumentIds.push(file._id.toString());
          }
          await file.save();
        }
      }));

      await document.save();
    } else {
      if (updatePermissionIfExists(document)) {
        updatedDocumentIds.push(document._id.toString());
      }
      await document.save();
    }

    console.log(`📢 Sending WS notifications for ${updatedDocumentIds.length} documents`);

    // Send WS event for EACH updated document
    const notifications = updatedDocumentIds.map(docId => 
      axios.post(
        WS_CONTROL_URL,
        {
          docId: docId,                  // Each individual document
          type: 'collaborator-permission-updated',
          payload: {
            _id: collaboratorId,
            permission: permission,
            documentId: docId
          }
        },
        {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' }
        }
      ).catch(error => {
        console.error(`❌ WS notification failed for doc ${docId}:`, error.message);
      })
    );

    // Wait for all notifications to complete
    await Promise.all(notifications);
    
    console.log(`✅ Sent ${updatedDocumentIds.length} WS permission notifications`);

    res.json({ 
      message: 'Permission updated successfully',
      updatedCount: updatedDocumentIds.length 
    });
  } catch (error) {
    console.error('Error updating collaborator:', error);
    res.status(500).json({ error: error.message });
  }
};




// Remove collaborator
exports.removeCollaborator = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) return res.status(404).json({ error: 'Document not found' });

    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only owner can remove collaborators' });
    }

    // Helper function to remove collaborator from a document
    const removeIfExists = (doc) => {
      doc.collaborators.pull({ user: req.params.collaboratorId });
    };


    if (document.type === 'folder') {
      // Remove from folder itself
      removeIfExists(document);

      // Remove from all files inside folder recursively
      const allFiles = await getAllFilesInFolder(document._id);
      for (const file of allFiles) {
        if (file.owner.toString() === document.owner.toString()) {
          removeIfExists(file);
          await file.save();
        }
  }

      await document.save();
    } else {
      // File only
      removeIfExists(document);
      await document.save();
    }

    // Notify WS backend to broadcast collaborator removed event
    await axios.post(WS_CONTROL_URL, {
      docId: req.params.id,               // used for routing in WS server
      type: 'collaborator-removed',       // event type
      payload: {
        _id: req.params.collaboratorId,   // user being removed
        // userId: req.params.collaboratorId, // optional for frontend fallback
        documentId: req.params.id         // allow global listeners to update sidebar
      }
    }).catch(() => { console.error('Error removing collaborator') });

   

    res.json({ message: 'Collaborator removed successfully' });
  } catch (error) {
    console.error('Error removing collaborator:', error);
    res.status(500).json({ error: error.message });
  }
};
