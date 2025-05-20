const OpenAI = require('openai');
const config = require('../config/config');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// JSON Schema for HTS Classification responses
const htsClassificationSchema = {
  name: "hts_classification_response",
  strict: true,
  schema: {
    type: "object",
    required: [
      "responseType",
      "question",
      "explanation",
      "options",
      "htsCode",
      "griApplied",
      "confidence"
    ],
    properties: {
      htsCode: {
        type: "string",
        description: "10-digit HTS code when responseType is 'classification'"
      },
      options: {
        type: "array",
        items: {
          type: "object",
          required: [
            "key",
            "value"
          ],
          properties: {
            key: {
              type: "string"
            },
            value: {
              type: "string"
            }
          },
          additionalProperties: false
        },
        description: "Multiple choice options when responseType is 'question'"
      },
      question: {
        type: "string",
        description: "The question being asked when responseType is 'question'"
      },
      confidence: {
        type: "string",
        description: "Confidence level when responseType is 'classification'"
      },
      griApplied: {
        type: "string",
        description: "GRI rules applied when responseType is 'classification'"
      },
      explanation: {
        type: "string",
        description: "Explanation for why the question matters or the classification rationale"
      },
      responseType: {
        enum: [
          "question",
          "classification"
        ],
        type: "string"
      }
    },
    dependencies: {
      responseType: {
        oneOf: [
          {
            required: [
              "question",
              "explanation",
              "options"
            ],
            properties: {
              responseType: {
                enum: [
                  "question"
                ]
              }
            }
          },
          {
            required: [
              "htsCode",
              "griApplied",
              "explanation",
              "confidence"
            ],
            properties: {
              responseType: {
                enum: [
                  "classification"
                ]
              }
            }
          }
        ]
      }
    },
    additionalProperties: false
  }
};

/**
 * Start a new classification using the Responses API
 * @param {string} productDescription - User's description of the product to classify
 * @returns {Object} - Session data with response ID and structured content
 */
async function startClassification(productDescription) {
  try {
    console.log('DEBUG: Starting classification for product:', productDescription);
    console.log('DEBUG: Using model:', config.openai.model);
    
    const requestConfig = {
      model: config.openai.model,
      instructions: config.systemPrompt,
      input: productDescription,
      text: {
        format: {
          type: "json_schema",
          ...htsClassificationSchema
        }
      },
      tools: [
        {
          type: "web_search_preview",
          user_location: {
            type: "approximate",
            country: "US"
          },
          search_context_size: "medium"
        }
      ],
      temperature: 1,
      max_output_tokens: 2048,
      top_p: 1
    };
    
    console.log('DEBUG: Request config:', JSON.stringify(requestConfig));
    
    const response = await openai.responses.create(requestConfig);
    
    console.log('DEBUG: Raw OpenAI Response Object Keys:', Object.keys(response));
    console.log('DEBUG: Response ID:', response.id);
    console.log('DEBUG: Response Text:', response.text);
    
    // Extract the actual structured output from the output array
    if (response.output && response.output.length > 0) {
      console.log('DEBUG: Response has output array:', JSON.stringify(response.output, null, 2));
      
      // Find the first message in the output array
      const outputMessage = response.output.find(item => item.type === 'message' && item.content);
      
      if (outputMessage && outputMessage.content && outputMessage.content.length > 0) {
        // Extract the text from the first content item
        const contentItem = outputMessage.content.find(content => content.type === 'output_text');
        
        if (contentItem && contentItem.text) {
          // Parse the JSON text
          const structuredResponse = JSON.parse(contentItem.text);
          console.log('DEBUG: Parsed structured response:', JSON.stringify(structuredResponse, null, 2));
          
          // Return the data
          return {
            response_id: response.id,
            response: structuredResponse
          };
        }
      }
    }
    
    // Fallback - handle case where expected output structure isn't found
    console.log('DEBUG: Non-string response:', response.text);
    
    return {
      response_id: response.id,
      response: response.text
    };
  } catch (error) {
    console.error('Error starting classification:', error);
    throw error;
  }
}

/**
 * Continue an existing classification with the user's selection
 * @param {string} previousResponseId - The ID of the previous response
 * @param {string} userSelection - The user's selection from the options
 * @returns {Object} - Updated response data
 */
async function continueClassification(previousResponseId, userSelection) {
  try {
    console.log('DEBUG: Continuing classification with selection:', userSelection);
    console.log('DEBUG: Previous response ID:', previousResponseId);
    
    // Use the previous_response_id parameter to maintain context
    const response = await openai.responses.create({
      model: config.openai.model,
      instructions: config.systemPrompt,
      input: userSelection,
      previous_response_id: previousResponseId,
      text: {
        format: {
          type: "json_schema",
          ...htsClassificationSchema
        }
      },
      tools: [
        {
          type: "web_search_preview",
          user_location: {
            type: "approximate",
            country: "US"
          },
          search_context_size: "medium"
        }
      ],
      temperature: 1,
      max_output_tokens: 2048,
      top_p: 1
    });
    
    console.log('DEBUG: Raw OpenAI Response Object Keys:', Object.keys(response));
    console.log('DEBUG: Response ID:', response.id);
    
    // Extract the actual structured output from the output array
    if (response.output && response.output.length > 0) {
      console.log('DEBUG: Response has output array:', JSON.stringify(response.output, null, 2));
      
      // Find the first message in the output array
      const outputMessage = response.output.find(item => item.type === 'message' && item.content);
      
      if (outputMessage && outputMessage.content && outputMessage.content.length > 0) {
        // Extract the text from the first content item
        const contentItem = outputMessage.content.find(content => content.type === 'output_text');
        
        if (contentItem && contentItem.text) {
          // Parse the JSON text
          const structuredResponse = JSON.parse(contentItem.text);
          console.log('DEBUG: Parsed structured response:', JSON.stringify(structuredResponse, null, 2));
          
          // Return the data
          return {
            response_id: response.id,
            response: structuredResponse
          };
        }
      }
    }
    
    // Fallback - handle case where expected output structure isn't found
    console.log('DEBUG: Non-string response or no output array:', response.text);
    
    return {
      response_id: response.id,
      response: response.text
    };
  } catch (error) {
    console.error('Error continuing classification:', error);
    throw error;
  }
}

module.exports = {
  startClassification,
  continueClassification
};