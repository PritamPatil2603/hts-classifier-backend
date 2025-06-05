// src/controllers/classificationController.js
// Simplified controller without session management

const openaiService = require('../services/openaiService');
const mongodbService = require('../services/mongodbService');

// Simple validation (keep this - it's our core value)
async function validateHtsCode(htsCode) {
  try {
    const validation = await mongodbService.validateHtsCode(htsCode);
    
    if (validation.isValid) {
      return {
        isValid: true,
        message: `HTS code ${htsCode} validated successfully`,
        details: validation.details
      };
    } else {
      return {
        isValid: false,
        message: `HTS code ${htsCode} not found in database`,
        details: null,
        relatedCodes: validation.relatedCodes || [],
        components: validation.components,
        hasAlternatives: !!(validation.relatedCodes && validation.relatedCodes.length > 0)
      };
    }
  } catch (error) {
    return {
      isValid: false,
      message: `Validation error: ${error.message}`,
      details: null,
      hasAlternatives: false
    };
  }
}

// Simple correction (keep this - it's our core value)
async function requestCorrection(responseId, invalidCode, validationResult) {
  try {
    let correctionPrompt;
    
    if (validationResult.hasAlternatives && validationResult.relatedCodes) {
      const codeOptions = validationResult.relatedCodes.slice(0, 10);
      const codeList = codeOptions.map((code, index) => 
        `${String.fromCharCode(65 + index)}. ${code.hts_code} - ${code.description}`
      ).join('\n');
      
      correctionPrompt = `The HTS code ${invalidCode} does not exist in the official US HTS database.

Here are OFFICIAL HTS codes under the same subheading:

${codeList}

Select the most appropriate code from above based on the product description and user selections.`;
    } else {
      correctionPrompt = `The HTS code ${invalidCode} is invalid. Please provide a corrected 10-digit HTS code in format XXXX.XX.XX.XX.`;
    }

    const result = await openaiService.continueClassification(responseId, correctionPrompt);
    return result;
  } catch (error) {
    console.error('Error requesting correction:', error);
    throw error;
  }
}

// SIMPLIFIED: Start classification (no sessions!)
async function startClassification(req, res) {
  const startTime = Date.now();
  
  try {
    const { productDescription } = req.body;
    
    console.log('\n🚀 NEW CLASSIFICATION REQUEST');
    console.log('📝 Product length:', productDescription?.length || 0, 'characters');
    
    if (!productDescription || productDescription.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Product description is required',
        code: 'MISSING_DESCRIPTION'
      });
    }
    
    console.log('🔧 Starting OpenAI classification...');
    
    const result = await openaiService.startClassification(productDescription);
    
    console.log('✅ OpenAI classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // Handle response based on type
    if (result.response?.responseType === 'classification') {
      const htsCode = result.response.htsCode;
      const validation = await validateHtsCode(htsCode);
      
      if (validation.isValid) {
        const duration = Date.now() - startTime;
        
        return res.status(200).json({
          success: true,
          type: 'result',
          response_id: result.response_id,
          ...result.response,
          validation: {
            ...result.response.validation,
            database_confirmed: "✅ Validated in official database",
            validation_details: validation.details
          },
          performance: { duration },
          timestamp: new Date().toISOString()
        });
      } else {
        const correctionResult = await requestCorrection(result.response_id, htsCode, validation);
        const duration = Date.now() - startTime;
        
        return res.status(200).json({
          success: true,
          type: correctionResult.response?.responseType === 'classification' ? 'result' : 'question',
          response_id: correctionResult.response_id,
          ...correctionResult.response,
          validation_attempted: {
            original_code: htsCode,
            validation_result: validation.message,
            correction_requested: true
          },
          performance: { duration },
          timestamp: new Date().toISOString()
        });
      }
    } else if (result.response?.responseType === 'reasoning_question') {
      const duration = Date.now() - startTime;
      
      return res.status(200).json({
        success: true,
        type: 'question',
        response_id: result.response_id,
        ...result.response,
        performance: { duration },
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from AI',
        code: 'INVALID_RESPONSE_FORMAT'
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Classification failed in ${duration}ms:`, error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to start classification', 
      code: 'CLASSIFICATION_ERROR',
      message: error.message,
      duration
    });
  }
}

// SIMPLIFIED: Continue classification (use response_id directly!)
async function continueClassification(req, res) {
  const startTime = Date.now();
  
  try {
    // ✅ SIMPLIFIED: Support both field names for backwards compatibility
    const { response_id, sessionId, selection } = req.body;
    const actualResponseId = response_id || sessionId;
    
    console.log('\n🔄 CONTINUE CLASSIFICATION REQUEST');
    console.log('🔗 Response ID:', actualResponseId);
    console.log('💬 Selection:', selection);
    
    if (!actualResponseId || !selection) {
      return res.status(400).json({ 
        error: 'Response ID and selection are required',
        code: 'MISSING_PARAMETERS'
      });
    }
    
    console.log('🔧 Continuing AI classification...');
    
    const result = await openaiService.continueClassification(actualResponseId, selection);
    
    console.log('✅ Continue classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // Handle response (same logic as start)
    if (result.response?.responseType === 'classification') {
      const htsCode = result.response.htsCode;
      const validation = await validateHtsCode(htsCode);
      
      if (validation.isValid) {
        const duration = Date.now() - startTime;
        
        return res.status(200).json({
          success: true,
          type: 'result',
          response_id: result.response_id,
          ...result.response,
          validation: {
            ...result.response.validation,
            database_confirmed: "✅ Validated in official database",
            validation_details: validation.details
          },
          performance: { duration },
          timestamp: new Date().toISOString()
        });
      } else {
        const correctionResult = await requestCorrection(result.response_id, htsCode, validation);
        const duration = Date.now() - startTime;
        
        return res.status(200).json({
          success: true,
          type: correctionResult.response?.responseType === 'classification' ? 'result' : 'question',
          response_id: correctionResult.response_id,
          ...correctionResult.response,
          validation_attempted: {
            original_code: htsCode,
            validation_result: validation.message,
            correction_requested: true
          },
          performance: { duration },
          timestamp: new Date().toISOString()
        });
      }
    } else if (result.response?.responseType === 'reasoning_question') {
      const duration = Date.now() - startTime;
      
      return res.status(200).json({
        success: true,
        type: 'question',
        response_id: result.response_id,
        ...result.response,
        performance: { duration },
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from AI',
        code: 'INVALID_RESPONSE_FORMAT'
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Continue classification failed in ${duration}ms:`, error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to continue classification', 
      code: 'CONTINUE_ERROR',
      message: error.message,
      duration
    });
  }
}

module.exports = {
  startClassification,
  continueClassification
};