// src/routes/classificationRoutes.js
// Updated routes with new monitoring endpoints

const express = require('express');
const router = express.Router();
const classificationController = require('../controllers/classificationController');

// Start a new classification
router.post('/classify', classificationController.startClassification);

// Continue classification using response_id
router.post('/classify/continue', classificationController.continueClassification);

// Simple health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'HTS Classification API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;