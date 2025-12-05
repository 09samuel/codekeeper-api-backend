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

    // Check ownership
    if (document.owner.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the owner can add collaborators' });
    }

    // Find user to add
    const userToAdd = await User.findOne({ email });
    if (!userToAdd) return res.status(404).json({ error: 'User not found' });

    if (userToAdd._id.toString() === req.user.id) {
      return res.status(400).json({ error: 'Cannot add yourself as collaborator' });
    }

    // Helper: add collaborator to a document if not already present
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

    let added = false;

    if (document.type === 'folder') {

      // Attempt to add to the folder itself
      if (addIfNotExists(document)) added = true;

      // Add to nested files
      const allFiles = await getAllFilesInFolder(documentId);
      for (const file of allFiles) {
        if (addIfNotExists(file)) {
          added = true;
          await file.save();
        }
      }

      await document.save();

    } else {
      // File case
      if (addIfNotExists(document)) {
        added = true;
        await document.save();
      }
    }

    // Re-fetch collaborator data populated
    await document.populate('collaborators.user', 'name email');

    const newCollaborator = document.collaborators.find(
      (c) => c.user._id.toString() === userToAdd._id.toString()
    );

    if (added) {
      try {
        await axios.post(WS_CONTROL_URL, {
          docId: documentId,
          type: 'collaborator-added',
          payload: {
            _id: newCollaborator.user._id,
            name: newCollaborator.user.name,
            email: newCollaborator.user.email,
            permission: newCollaborator.permission,
            addedAt: newCollaborator.addedAt,
          }
        });
      } catch (e) {
        console.error('Error adding collaborator');
      }

      return res.json({
        _id: newCollaborator.user._id,
        name: newCollaborator.user.name,
        email: newCollaborator.user.email,
        permission: newCollaborator.permission,
        addedAt: newCollaborator.addedAt,
      });
    }

    // collaborator already existed. no return data
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
      }
    };

    if (document.type === 'folder') {
      updatePermissionIfExists(document);
      const allFiles = await getAllFilesInFolder(document._id);

      await Promise.all(allFiles.map(async (file) => {
        if (file.owner.toString() === document.owner.toString()) {
          updatePermissionIfExists(file);
          await file.save();
        }
      }));

      await document.save();
    } else {
      updatePermissionIfExists(document);
      await document.save();
    }

    console.log('🔄 Notifying WS server:', { docId: id, collaboratorId, permission });
    console.log('📡 WS_CONTROL_URL:', WS_CONTROL_URL);

    try {
      const response = await axios.post(
        WS_CONTROL_URL,
        {
          docId: id,                  // Document ID
          type: 'collaborator-permission-updated',
          payload: {
            _id: collaboratorId,      // User ID
            permission: permission,   // New permission ('view' or 'edit')
            documentId: id            // Document ID for WS routing
          }
        },
        {
          timeout: 5000, // 5 second timeout
          headers: { 'Content-Type': 'application/json' }
        }
      );

      console.log('✅ WS notification SUCCESS (permission):', response.status, response.data);
    } catch (error) {
      console.error('❌ WS notification FAILED (permission):', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data,
        url: WS_CONTROL_URL
      });
    }

    res.json({ message: 'Permission updated successfully' });
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
