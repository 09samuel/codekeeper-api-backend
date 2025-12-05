const express = require('express');
const router = express.Router();
const codeController = require('../controllers/codeController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/execute', authMiddleware, codeController.executeCode);
router.get('/runtimes', authMiddleware, codeController.getRuntimes);

module.exports = router;
