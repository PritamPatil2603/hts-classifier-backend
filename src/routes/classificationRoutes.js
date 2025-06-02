// src/routes/classificationRoutes.js
// Updated routes with new monitoring endpoints

const express = require('express');
const router = express.Router();
const classificationController = require('../controllers/classificationController');

// ✅ EXISTING: Start a new classification
router.post('/classify', classificationController.startClassification);

// ✅ EXISTING: Continue an existing classification
router.post('/classify/continue', classificationController.continueClassification);

// ✅ EXISTING: Get session status
router.get('/classify/session/:sessionId', classificationController.getSessionStatus);

// ✅ NEW: Get session statistics (for monitoring)
router.get('/classify/stats', classificationController.getSessionStats);

// ✅ NEW: Test endpoint for development
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'HTS Classification API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

module.exports = router;