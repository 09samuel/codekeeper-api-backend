const express = require("express");
const router = express.Router();
const documentController = require("../controllers/documentController");
const authMiddleware = require("../middlewares/authMiddleware");


router.get('/:itemId/ownership', authMiddleware, documentController.checkOwnership);
router.get('/:id/permission', authMiddleware, documentController.getDocumentPermission);
router.get('/signed-url', authMiddleware, documentController.getSignedUrl);

router.post('/', authMiddleware, documentController.createDocument);
router.post('/save', documentController.saveDocumentContent);
router.post('/folders', authMiddleware, documentController.createFolder);
router.get('/', authMiddleware, documentController.getUserDocuments);

router.get('/:id', authMiddleware, documentController.getDocumentById);
router.put('/:id', authMiddleware, documentController.renameItem);
router.delete('/:id', authMiddleware, documentController.deleteItem);

module.exports = router;