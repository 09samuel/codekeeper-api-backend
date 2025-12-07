const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['file', 'folder'], default: 'file' },
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  contentUrl: { type: String }, // S3 URL for file content
  s3Key: { type: String }, // S3 object key
  contentSize: { type: Number, default: 0 }, // Size of the content in bytes
  
  // Collaborators with permissions
  collaborators: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    permission: { 
      type: String, 
      enum: ['view', 'edit'], 
      default: 'view' 
    },
    addedAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Metadata
  lastModified: { type: Date, default: Date.now },
  lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

// Index for faster queries
documentSchema.index({ owner: 1 });
documentSchema.index({ 'collaborators.user': 1 });
documentSchema.index({ parentFolder: 1 });

module.exports = mongoose.model('Document', documentSchema);