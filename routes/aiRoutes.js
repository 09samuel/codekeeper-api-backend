const express = require('express');
const router = express.Router();
const aiController = require('../controllers/aiController');
const authMiddleware = require("../middlewares/authMiddleware");

router.post('/generate-text', authMiddleware, aiController.generateText);

module.exports = router;