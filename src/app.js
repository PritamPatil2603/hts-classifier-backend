// File: src/app.js
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const config = require('./config/config');
const classificationRoutes = require('./routes/classificationRoutes');

// Initialize Express app
const app = express();

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(bodyParser.json());

// Routes
app.use('/api', classificationRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'An unexpected error occurred',
    message: config.nodeEnv === 'development' ? err.message : undefined
  });
});

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`HTS Classification API server running on port ${PORT}`);
});

module.exports = app; // For testing purposes