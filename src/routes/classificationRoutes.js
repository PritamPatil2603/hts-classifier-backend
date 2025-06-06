// File: src/routes/classificationRoutes.js
const express = require('express');
const router = express.Router();
const classificationController = require('../controllers/classificationController');

// POST /api/classify - Start a new classification
router.post('/classify', classificationController.startClassification);

// POST /api/classify/continue - Continue an existing classification
router.post('/classify/continue', classificationController.continueClassification);

// GET /api/classify/session/:sessionId - Get session status
router.get('/classify/session/:sessionId', classificationController.getSessionStatus);

module.exports = router;