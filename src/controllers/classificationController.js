// src/controllers/classificationController.js
// Simplified controller without session management

const openaiService = require('../services/openaiService');
const mongodbService = require('../services/mongodbService');

// ✅ IMPROVED: Handle new validation structure  
async function validateHtsCode(htsCode) {
  try {
    const validation = await mongodbService.validateHtsCode(htsCode);
    
    if (validation.valid) {
      return {
        isValid: true,
        message: `HTS code ${htsCode} validated successfully`,
        details: validation.details,
        validationData: validation
      };
    } else {
      return {
        isValid: false,
        message: validation.error,
        details: null,
        relatedCodes: validation.relatedCodes || [],
        components: validation.components,
        hasAlternatives: !!(validation.relatedCodes && validation.relatedCodes.length > 0),
        validationData: validation
      };
    }
  } catch (error) {
    return {
      isValid: false,
      message: `Validation error: ${error.message}`,
      details: null,
      hasAlternatives: false,
      validationData: null
    };
  }
}

// ✅ IMPROVED: Better correction prompts with structured data
async function requestCorrection(responseId, invalidCode, validationResult) {
  try {
    let correctionPrompt;
    
    if (validationResult.hasAlternatives && validationResult.relatedCodes) {
      const codeOptions = validationResult.relatedCodes.slice(0, 10);
      const codeList = codeOptions.map((code, index) => 
        `${index + 1}. ${code.hts_code} - ${code.description}
   Full: ${code.full_description}
   Context: ${code.context_path}`
      ).join('\n\n');
      
      correctionPrompt = `VALIDATION FAILED for your classification.

ORIGINAL CLASSIFICATION: ${invalidCode}
VALIDATION ERROR: ${validationResult.validationData.error}

ANALYSIS: Your subheading classification (${validationResult.validationData.subheading_analysis?.subheading}) appears ${validationResult.validationData.subheading_analysis?.subheading_appears_correct ? 'CORRECT' : 'INCORRECT'}.

${validationResult.validationData.suggestion_context}

VALID HTS CODES UNDER YOUR CHOSEN SUBHEADING:
${codeList}

Please select the most appropriate HTS code from the above official options and provide your corrected classification using the same JSON schema.`;
    } else {
      correctionPrompt = `VALIDATION FAILED for your classification.

ORIGINAL CLASSIFICATION: ${invalidCode}
VALIDATION ERROR: ${validationResult.validationData.error}

Please provide a corrected 10-digit US HTS code that exists in the official database.

Requirements:
- Must be exactly 10 digits in format XXXX.XX.XX.XX
- Must exist in the official HTS database
- Provide your corrected classification using the same JSON schema`;
    }

    const result = await openaiService.continueClassification(responseId, correctionPrompt);
    return result;
  } catch (error) {
    console.error('Error requesting correction:', error);
    throw error;
  }
}

async function startClassification(req, res) {
  const startTime = Date.now();
  
  try {
    const { productDescription } = req.body;
    
    console.log('\n🚀 NEW CLASSIFICATION REQUEST');
    console.log('📝 Product length:', productDescription?.length || 0, 'characters');
    
    if (!productDescription || productDescription.trim().length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Product description is required',
        code: 'MISSING_DESCRIPTION'
      });
    }
    
    console.log('🔧 Starting OpenAI classification...');
    
    const result = await openaiService.startClassification(productDescription);
    
    console.log('✅ OpenAI classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // ✅ Handle error responses from AI
    if (result.response?.responseType === 'error') {
      const duration = Date.now() - startTime;
      return res.status(500).json({
        success: false,
        error: 'AI response error',
        details: result.response.message,
        code: 'AI_ERROR',
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Handle response based on type
    if (result.response?.responseType === 'classification') {
      const htsCode = result.response.htsCode;
      console.log('🔍 Validating HTS code:', htsCode);
      
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
          performance: { 
            duration,
            openai_time_ms: result.response_time_ms
          },
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('❌ Validation failed, requesting correction...');
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
            correction_requested: true,
            alternatives_found: validation.hasAlternatives
          },
          performance: { 
            duration,
            openai_time_ms: result.response_time_ms + (correctionResult.response_time_ms || 0)
          },
          timestamp: new Date().toISOString()
        });
      }
    } else if (result.response?.responseType === 'question') { // ✅ Updated from 'reasoning_question'
      const duration = Date.now() - startTime;
      
      return res.status(200).json({
        success: true,
        type: 'question',
        response_id: result.response_id,
        ...result.response,
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms
        },
        timestamp: new Date().toISOString()
      });
    } else {
      const duration = Date.now() - startTime;
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from AI',
        code: 'INVALID_RESPONSE_FORMAT',
        received_type: result.response?.responseType,
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms || 0
        },
        timestamp: new Date().toISOString()
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
      performance: { duration },
      timestamp: new Date().toISOString()
    });
  }
}

async function continueClassification(req, res) {
  const startTime = Date.now();
  
  try {
    const { response_id, sessionId, selection } = req.body;
    const actualResponseId = response_id || sessionId;
    
    console.log('\n🔄 CONTINUE CLASSIFICATION REQUEST');
    console.log('🔗 Response ID:', actualResponseId);
    console.log('💬 Selection:', selection);
    
    if (!actualResponseId || !selection) {
      return res.status(400).json({ 
        success: false,
        error: 'Response ID and selection are required',
        code: 'MISSING_PARAMETERS'
      });
    }
    
    console.log('🔧 Continuing AI classification...');
    
    const result = await openaiService.continueClassification(actualResponseId, selection);
    
    console.log('✅ Continue classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // ✅ Handle error responses from AI
    if (result.response?.responseType === 'error') {
      const duration = Date.now() - startTime;
      return res.status(500).json({
        success: false,
        error: 'AI response error',
        details: result.response.message,
        code: 'AI_ERROR',
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Handle response (same logic as start)
    if (result.response?.responseType === 'classification') {
      const htsCode = result.response.htsCode;
      console.log('🔍 Validating HTS code:', htsCode);
      
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
          performance: { 
            duration,
            openai_time_ms: result.response_time_ms
          },
          timestamp: new Date().toISOString()
        });
      } else {
        console.log('❌ Validation failed, requesting correction...');
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
            correction_requested: true,
            alternatives_found: validation.hasAlternatives
          },
          performance: { 
            duration,
            openai_time_ms: result.response_time_ms + (correctionResult.response_time_ms || 0)
          },
          timestamp: new Date().toISOString()
        });
      }
    } else if (result.response?.responseType === 'question') { // ✅ Updated from 'reasoning_question'
      const duration = Date.now() - startTime;
      
      return res.status(200).json({
        success: true,
        type: 'question',
        response_id: result.response_id,
        ...result.response,
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms
        },
        timestamp: new Date().toISOString()
      });
    } else {
      const duration = Date.now() - startTime;
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from AI',
        code: 'INVALID_RESPONSE_FORMAT',
        received_type: result.response?.responseType,
        performance: { 
          duration,
          openai_time_ms: result.response_time_ms || 0
        },
        timestamp: new Date().toISOString()
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
      performance: { duration },
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  startClassification,
  continueClassification
};