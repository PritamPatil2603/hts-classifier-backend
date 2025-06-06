const openaiService = require('../services/openaiService');
const htsValidationService = require('../services/htsValidationService'); // ✅ ADD: New service

// Lightweight session tracking (just to associate sessions with users)
const sessions = {};

/**
 * Start a new classification process
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function startClassification(req, res) {
  try {
    const { productDescription } = req.body;
    
    console.log('DEBUG CONTROLLER: Starting classification with body:', JSON.stringify(req.body, null, 2));
    
    if (!productDescription) {
      return res.status(400).json({ error: 'Product description is required' });
    }
    
    console.log('DEBUG CONTROLLER: Calling htsValidationService.classifyWithValidation'); // ✅ CHANGED: Use validation service
    
    // ✅ CHANGED: Use validation service instead of direct openai service
    const result = await htsValidationService.classifyWithValidation(productDescription);
    
    console.log('DEBUG CONTROLLER: Result from htsValidationService:', JSON.stringify(result, null, 2));
    
    // Generate a session ID
    const sessionId = Date.now().toString();
    
    // Store minimal session data
    sessions[sessionId] = {
      productDescription,
      lastResponseId: result.response_id
    };
    
    // ✅ SAME RESPONSE HANDLING AS BEFORE
    if (typeof result.response === 'object' && result.response.responseType) {
      const responseForUI = {
        ...result.response,
        type: result.response.responseType === 'classification' ? 'result' : result.response.responseType
      };
      
      return res.status(200).json({
        sessionId,
        ...responseForUI
      });
    } else {
      console.error('Unexpected response format:', result.response);
      return res.status(500).json({ 
        error: 'Unexpected response format from OpenAI',
        details: 'The response did not contain the expected structured data.'
      });
    }
  } catch (error) {
    console.error('Error starting classification:', error);
    return res.status(500).json({ error: 'Failed to start classification', message: error.message });
  }
}

/**
 * Continue an existing classification process with user selection
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function continueClassification(req, res) {
  try {
    const { sessionId, selection } = req.body; // ✅ SAME SESSIONID HANDLING
    
    console.log('DEBUG CONTROLLER: Continuing classification with body:', JSON.stringify(req.body, null, 2));
    
    if (!sessionId || !selection) {
      return res.status(400).json({ error: 'Session ID and selection are required' });
    }
    
    // ✅ SAME SESSION CHECK
    if (!sessions[sessionId]) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    console.log('DEBUG CONTROLLER: Calling htsValidationService.continueWithValidation'); // ✅ CHANGED: Use validation service
    
    // ✅ CHANGED: Use validation service instead of direct openai service
    const result = await htsValidationService.continueWithValidation(
      sessions[sessionId].lastResponseId,
      selection
    );
    
    console.log('DEBUG CONTROLLER: Result from continueWithValidation:', JSON.stringify(result, null, 2));
    
    // ✅ SAME SESSION UPDATE
    sessions[sessionId].lastResponseId = result.response_id;
    
    // ✅ SAME RESPONSE HANDLING
    if (typeof result.response === 'object' && result.response.responseType) {
      const responseForUI = {
        ...result.response,
        type: result.response.responseType === 'classification' ? 'result' : result.response.responseType
      };
      
      return res.status(200).json({
        sessionId,
        ...responseForUI
      });
    } else {
      console.error('Unexpected response format:', result.response);
      return res.status(500).json({ 
        error: 'Unexpected response format from OpenAI',
        details: 'The response did not contain the expected structured data.'
      });
    }
  } catch (error) {
    console.error('Error continuing classification:', error);
    return res.status(500).json({ error: 'Failed to continue classification', message: error.message });
  }
}

/**
 * Get the current status of a classification session
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function getSessionStatus(req, res) {
  try {
    const { sessionId } = req.params;
    
    console.log('DEBUG CONTROLLER: Getting session status for sessionId:', sessionId);
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Check if the session exists
    if (!sessions[sessionId]) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    return res.status(200).json({
      sessionId,
      productDescription: sessions[sessionId].productDescription,
      hasActiveConversation: !!sessions[sessionId].lastResponseId
    });
  } catch (error) {
    console.error('Error getting session status:', error);
    return res.status(500).json({ error: 'Failed to get session status', message: error.message });
  }
}

module.exports = {
  startClassification,
  continueClassification,
  getSessionStatus
};