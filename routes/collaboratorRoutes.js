const express = require("express");
const router = express.Router();
const collaboratorController = require("../controllers/collaboratorController");
const authMiddleware = require("../middlewares/authMiddleware");

router.post('/:id', authMiddleware, collaboratorController.addCollaborator);
router.get('/:id', authMiddleware, collaboratorController.getCollaborators);
router.put('/:id/:collaboratorId', authMiddleware, collaboratorController.updateCollaborator);
router.delete('/:id/:collaboratorId', authMiddleware, collaboratorController.removeCollaborator);


module.exports = router;

