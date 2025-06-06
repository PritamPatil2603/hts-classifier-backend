const mongodbService = require('./mongodbService');
const openaiService = require('./openaiService');

class HTSValidationService {
  
  // ✅ STEP 1: Enhanced validation with subheading fallback
  async validateHTSCode(htsCode) {
    try {
      const cleanCode = htsCode.replace(/\./g, '');
      
      // Basic format validation
      if (cleanCode.length !== 10 || !/^\d{10}$/.test(cleanCode)) {
        return {
          valid: false,
          error: "HTS code must be exactly 10 digits",
          provided_code: htsCode,
          format_valid: false
        };
      }

      // Check if exact code exists
      const exactMatch = await mongodbService.validateHtsCode(htsCode);
      
      if (exactMatch.isValid) {
        console.log('✅ Exact HTS code found in database');
        return {
          valid: true,
          hts_data: exactMatch.details
        };
      }

      // ✅ STEP 2: Find codes under same subheading (like reference)
      const subheading = cleanCode.substring(0, 6);
      console.log(`🔍 HTS code ${htsCode} not found. Looking under subheading: ${subheading}`);

      // Get subheading codes from MongoDB
      await mongodbService.connect();
      const codesUnderSubheading = await mongodbService.collection.find({
        $or: [
          { subheading: subheading },  // Direct field match
          { hts_code: { $regex: `^${subheading}` } }  // Regex fallback
        ]
      }).sort({ hts_code: 1 }).limit(15).toArray();

      if (codesUnderSubheading.length > 0) {
        console.log(`📋 Found ${codesUnderSubheading.length} codes under subheading ${subheading}`);
        return {
          valid: false,
          error: "HTS code not found in official US HTS database",
          provided_code: htsCode,
          format_valid: true,
          subheading_analysis: {
            subheading: subheading,
            subheading_appears_correct: true
          },
          valid_options_under_subheading: codesUnderSubheading.map(doc => ({
            hts_code: doc.hts_code,
            description: doc.description,
            full_description: doc.full_description,
            context_path: doc.context_path
          })),
          suggestion_context: `Found ${codesUnderSubheading.length} valid HTS codes under subheading ${subheading}. Please select the most appropriate one.`
        };
      } else {
        console.log(`❌ No codes found under subheading ${subheading}`);
        return {
          valid: false,
          error: "Subheading not found in official US HTS database",
          provided_code: htsCode,
          format_valid: true,
          subheading_analysis: {
            subheading: subheading,
            subheading_appears_correct: false
          }
        };
      }

    } catch (error) {
      console.error('❌ Database validation error:', error);
      return {
        valid: false,
        error: "Database validation failed",
        details: error.message
      };
    }
  }

  // ✅ STEP 2: Request correction from AI (like reference)
  async requestCorrection(originalClassification, validationError, previousResponseId) {
    try {
      let correctionPrompt = `VALIDATION FAILED for your classification.

ORIGINAL CLASSIFICATION: ${originalClassification.htsCode}
VALIDATION ERROR: ${validationError.error}

`;

      if (validationError.valid_options_under_subheading) {
        correctionPrompt += `ANALYSIS: Your subheading classification (${validationError.subheading_analysis.subheading}) appears CORRECT.

${validationError.suggestion_context}

VALID HTS CODES UNDER YOUR CHOSEN SUBHEADING:
${validationError.valid_options_under_subheading.map((option, index) => 
  `${index + 1}. ${option.hts_code} - ${option.description}
   Full: ${option.full_description}
   Context: ${option.context_path}`
).join('\n\n')}

Please select the most appropriate HTS code from the above official options.`;
      } else {
        correctionPrompt += `Please provide a corrected 10-digit US HTS code that exists in the official database.`;
      }

      correctionPrompt += `\n\nRequirements:
- Must be exactly 10 digits in format XXXX.XX.XX.XX
- Must exist in the official HTS database
- Provide your corrected classification using the same JSON schema`;

      console.log('🔧 Requesting correction from AI...');
      return await openaiService.continueClassification(previousResponseId, correctionPrompt);

    } catch (error) {
      console.error('❌ Correction request error:', error);
      throw error;
    }
  }

  // ✅ STEP 3: Complete classification workflow (like reference)
  async classifyWithValidation(productDescription, previousResponseId = null) {
    try {
      console.log('\n🔄 Starting classification with validation...');
      
      // Step 1: Get classification from AI
      const classificationResult = await openaiService.startClassification(productDescription);
      
      if (!classificationResult.response || classificationResult.response.responseType === 'error') {
        return {
          success: false,
          error: "Failed to get classification",
          details: classificationResult.response?.message
        };
      }

      // If it's a question, return it directly (no validation needed)
      if (classificationResult.response.responseType === 'question') {
        return {
          success: true,
          type: "question",
          response: classificationResult.response,
          response_id: classificationResult.response_id,
          needs_user_input: true
        };
      }

      // If it's a classification, validate the HTS code
      if (classificationResult.response.responseType === 'classification') {
        const alexResponse = classificationResult.response;
        console.log(`📊 AI classified as: ${alexResponse.htsCode}`);

        // Step 2: Validate the HTS code
        console.log('\n🔍 Validating HTS code...');
        const validationResult = await this.validateHTSCode(alexResponse.htsCode);

        if (validationResult.valid) {
          console.log('✅ Classification validated successfully!');
          return {
            success: true,
            type: "classification",
            response: alexResponse,
            response_id: classificationResult.response_id,
            validation: validationResult,
            validated: true
          };
        } else {
          console.log('⚠️ Validation failed, requesting correction...');
          
          const correctionResult = await this.requestCorrection(
            alexResponse,
            validationResult,
            classificationResult.response_id
          );

          if (correctionResult.response) {
            // Validate the corrected classification
            const correctedValidation = await this.validateHTSCode(correctionResult.response.htsCode);
            
            return {
              success: true,
              type: correctedValidation.valid ? "classification" : "correction_attempt",
              response: correctionResult.response,
              response_id: correctionResult.response_id,
              original_response: alexResponse,
              validation_error: validationResult,
              corrected_validation: correctedValidation,
              validated: correctedValidation.valid
            };
          } else {
            return {
              success: false,
              error: "Failed to get correction",
              original_response: alexResponse,
              validation_error: validationResult
            };
          }
        }
      }

      return {
        success: false,
        error: "Unexpected response type",
        response_type: classificationResult.response?.responseType
      };

    } catch (error) {
      console.error('❌ Classification workflow error:', error);
      return {
        success: false,
        error: error.message,
        type: 'WorkflowError'
      };
    }
  }

  // ✅ STEP 4: Continue conversation with validation
  async continueWithValidation(previousResponseId, userSelection) {
    try {
      console.log('\n🔄 Continuing classification with validation...');
      
      // Continue conversation with AI
      const continueResult = await openaiService.continueClassification(previousResponseId, userSelection);
      
      if (!continueResult.response || continueResult.response.responseType === 'error') {
        return {
          success: false,
          error: "Failed to continue classification",
          details: continueResult.response?.message
        };
      }

      // If it's a question, return it directly
      if (continueResult.response.responseType === 'question') {
        return {
          success: true,
          type: "question",
          response: continueResult.response,
          response_id: continueResult.response_id,
          needs_user_input: true
        };
      }

      // If it's a classification, validate it
      if (continueResult.response.responseType === 'classification') {
        const alexResponse = continueResult.response;
        console.log(`📊 AI classified as: ${alexResponse.htsCode}`);

        const validationResult = await this.validateHTSCode(alexResponse.htsCode);

        if (validationResult.valid) {
          console.log('✅ Classification validated successfully!');
          return {
            success: true,
            type: "classification",
            response: alexResponse,
            response_id: continueResult.response_id,
            validation: validationResult,
            validated: true
          };
        } else {
          console.log('⚠️ Validation failed, requesting correction...');
          
          const correctionResult = await this.requestCorrection(
            alexResponse,
            validationResult,
            continueResult.response_id
          );

          return {
            success: true,
            type: "correction_attempt", 
            response: correctionResult.response,
            response_id: correctionResult.response_id,
            original_response: alexResponse,
            validation_error: validationResult,
            validated: false
          };
        }
      }

      return {
        success: false,
        error: "Unexpected response type",
        response_type: continueResult.response?.responseType
      };

    } catch (error) {
      console.error('❌ Continue workflow error:', error);
      return {
        success: false,
        error: error.message,
        type: 'WorkflowError'
      };
    }
  }
}

module.exports = new HTSValidationService();