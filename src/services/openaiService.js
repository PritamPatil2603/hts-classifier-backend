const OpenAI = require('openai');
const config = require('../config/config');

// ✅ IMPROVED: Add retries and timeout
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2,
  timeout: 30000 // 30 seconds
});

// ✅ UPDATED SCHEMAS - Match frontend expectations
const questionResponseSchema = {
  type: "object",
  properties: {
    responseType: { type: "string", enum: ["question"] }, // ✅ Changed from "reasoning_question"
    reasoning: {
      type: "object",
      properties: {
        initial_assessment: {
          type: "object",
          properties: {
            product_description_analysis: { type: "string" },
            classification_hypotheses: { type: "array", items: { type: "string" } }
          },
          required: ["product_description_analysis", "classification_hypotheses"],
          additionalProperties: false
        },
        classification_analysis: {
          type: "object",
          properties: {
            most_likely_codes: { type: "array", items: { type: "string" } },
            critical_distinctions: { type: "array", items: { type: "string" } },
            why_question_needed: { type: "string" }
          },
          required: ["most_likely_codes", "critical_distinctions", "why_question_needed"],
          additionalProperties: false
        },
        confidence_analysis: {
          type: "object",
          properties: {
            current_confidence_level: { type: "number", minimum: 0, maximum: 100 },
            what_would_increase_confidence: { type: "array", items: { type: "string" } }
          },
          required: ["current_confidence_level", "what_would_increase_confidence"],
          additionalProperties: false
        }
      },
      required: ["initial_assessment", "classification_analysis", "confidence_analysis"],
      additionalProperties: false
    },
    question: { type: "string" }, // ✅ Simplified - just the question string
    explanation: { type: "string" }, // ✅ Added explanation field
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          value: { type: "string" },
          impact: { type: "string" }
        },
        required: ["key", "value", "impact"],
        additionalProperties: false
      },
      minItems: 2,
      maxItems: 4
    },
    reasoning: { type: "string" }, // ✅ Keep reasoning field
    confidence: { type: "string" } // ✅ Changed to string to match frontend expectation
  },
  required: ["responseType", "reasoning", "question", "explanation", "options", "reasoning", "confidence"],
  additionalProperties: false
};

const classificationResponseSchema = {
  type: "object",
  properties: {
    responseType: { type: "string", enum: ["classification"] },
    htsCode: { type: "string" },
    confidence: { type: "string" }, // ✅ Changed to string (e.g. "95%")
    explanation: { type: "string" }, // ✅ Added user-friendly explanation
    griApplied: { type: "string" }, // ✅ Added GRI field (usually "1")
    classificationPath: { // ✅ Changed to camelCase
      type: "object",
      properties: {
        chapter: { type: "string" },
        heading: { type: "string" },
        subheading: { type: "string" },
        statisticalSuffix: { type: "string" } // ✅ Changed to camelCase
      },
      required: ["chapter", "heading", "subheading", "statisticalSuffix"],
      additionalProperties: false
    },
    validation: {
      type: "object",
      properties: {
        database_confirmed: { type: "string" },
        description_match: { type: "string" }, // ✅ Added description_match
        alternative_considerations: { type: "string" }
      },
      required: ["database_confirmed", "description_match", "alternative_considerations"],
      additionalProperties: false
    },
    professional_considerations: {
      type: "object",
      properties: {
        audit_risk_level: { type: "string" },
        duty_rate_implications: { type: "string" }
      },
      required: ["audit_risk_level", "duty_rate_implications"],
      additionalProperties: false
    }
  },
  required: ["responseType", "htsCode", "confidence", "explanation", "griApplied", "classificationPath", "validation", "professional_considerations"],
  additionalProperties: false
};

// ✅ IMPROVED: Response extraction with better error handling
function extractResponse(response) {
  try {
    // Try different response paths
    if (response.output_text) {
      return JSON.parse(response.output_text);
    }

    if (response.output && Array.isArray(response.output)) {
      const messages = response.output.filter(item => item.type === 'message');
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage?.content) {
        for (const content of lastMessage.content) {
          if (content.type === 'text' && content.text) {
            try {
              return JSON.parse(content.text);
            } catch (parseError) {
              // Try to extract JSON from text
              const jsonMatch = content.text.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
              }
            }
          }
        }
      }
    }

    throw new Error('No valid response content found');
  } catch (error) {
    console.error('❌ Response extraction error:', error);
    console.error('📄 Raw response structure:', JSON.stringify(response, null, 2));
    
    return { 
      responseType: 'error', 
      message: 'Failed to parse AI response',
      details: error.message,
      raw_response: response
    };
  }
}

async function startClassification(productDescription) {
  const startTime = Date.now();
  
  try {
    console.log('🤖 Sending request to OpenAI Responses API...');
    
    // ✅ CORRECT: Use responses.create() without structured outputs first
    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: productDescription }
      ],
      temperature: 0,
      max_output_tokens: 2000,
      store: true
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`✅ OpenAI response received (${responseTime}ms)`);
    
    const extractedResponse = extractResponse(response);
    
    // ✅ Basic validation of response structure
    if (!extractedResponse.responseType || extractedResponse.responseType === 'error') {
      console.warn('⚠️ Invalid or error response from AI');
      return {
        response_id: response.id,
        response: extractedResponse,
        response_time_ms: responseTime
      };
    }
    
    console.log('📊 Response type:', extractedResponse.responseType);
    
    return {
      response_id: response.id,
      response: extractedResponse,
      response_time_ms: responseTime
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`❌ OpenAI API Error (${responseTime}ms):`, error.message);
    throw error;
  }
}

async function continueClassification(previousResponseId, userSelection) {
  const startTime = Date.now();
  
  try {
    console.log('🤖 Continuing conversation with OpenAI...');
    
    // ✅ CORRECT: Use responses.create() without structured outputs
    const response = await openai.responses.create({
      model: config.openai.model,
      input: [{ role: "user", content: userSelection }],
      previous_response_id: previousResponseId,
      temperature: 0,
      max_output_tokens: 2000,
      store: true
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`✅ Continue response received (${responseTime}ms)`);
    
    const extractedResponse = extractResponse(response);
    
    // ✅ Basic validation of response structure
    if (!extractedResponse.responseType || extractedResponse.responseType === 'error') {
      console.warn('⚠️ Invalid or error response from AI');
      return {
        response_id: response.id,
        response: extractedResponse,
        response_time_ms: responseTime
      };
    }
    
    console.log('📊 Continue response type:', extractedResponse.responseType);
    
    return {
      response_id: response.id,
      response: extractedResponse,
      response_time_ms: responseTime
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.error(`❌ OpenAI Continue API Error (${responseTime}ms):`, error.message);
    throw error;
  }
}

module.exports = {
  startClassification,
  continueClassification
};