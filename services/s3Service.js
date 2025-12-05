const mime = require('mime-types'); 
const s3 = require("../config/s3Config");
const Document = require("../models/Document");

const BUCKET_NAME = process.env.AWS_S3_BUCKET;

exports.uploadPlainText = async (key, content) => {
  const contentType = mime.lookup(key) || 'text/plain';

  const params = {
    Bucket: BUCKET_NAME,
    Key: key, 
    Body: content,
    ContentType: contentType,
  };
  const result = await s3.upload(params).promise();
  return result.Location;
};

exports.getSignedUrlForKey = (s3Key) => {
  console.log('[S3] Generating signed URL for key:', s3Key);
  
  const params = {
    Bucket: BUCKET_NAME,
    Key: s3Key, 
    Expires: 3600, // 1 hour
  };
  
  try {
    const url = s3.getSignedUrl('getObject', params);
    console.log('[S3] ✓ Signed URL generated:', url);
    return url;
  } catch (err) {
    console.error('[S3] ✗ Error generating signed URL:', err);
    throw new Error(`Failed to generate signed URL: ${err.message}`);
  }
};

exports.getSignedUrl = async (req, res) => {
  try {
    const fileId = req.query.id;
    if (!fileId) {
      return res.status(400).json({ error: "File ID is required" });
    }

    // 1. Fetch the file record from MongoDB
    const doc = await Document.findById(fileId);
    if (!doc) {
      return res.status(404).json({ error: "File not found" });
    }

    // 2. Ensure it actually has a stored S3 key
    if (!doc.s3Key) {
      return res.status(500).json({ error: "File missing s3Key in database" });
    }

    // 3. Build signed URL using the stored key
    const params = {
      Bucket: BUCKET_NAME,
      Key: doc.s3Key,     
      Expires: 60,
    };

    const url = s3.getSignedUrl("getObject", params);

    return res.json({ url });
  } catch (err) {
    console.error("Error generating signed URL:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.deleteFile = async (s3Key) => {
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Key: s3Key
  };
  
  return await s3.deleteObject(params).promise();
};