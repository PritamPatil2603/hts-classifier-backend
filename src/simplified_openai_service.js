const OpenAI = require('openai');
const config = require('../config/config'); // Assuming config is in src/config/config.js

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// MongoDB function tools (same as before, but OpenAI will handle them automatically)
const mongodbTools = [
  {
    type: "function",
    name: "lookup_hts_by_six_digit_base",
    description: "Lookup all HTS codes and statistical suffixes for a given 6-digit base code from the official MongoDB database. Use this to find all possible statistical suffixes for a 6-digit HTS code.",
    parameters: {
      type: "object",
      properties: {
        six_digit_base: {
          type: "string",
          description: "The 6-digit base code to search for, e.g., '010121'"
        }
      },
      required: ["six_digit_base"]
    }
  },
  {
    type: "function",
    name: "validate_hts_code",
    description: "Validate if a complete HTS code exists in the official MongoDB database. Use this before returning any final classification to ensure the code is real.",
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "The complete HTS code to validate, e.g., '0101.21.00'"
        }
      },
      required: ["hts_code"]
    }
  }
];

// Structured output function tools (same as before)
const structuredOutputTools = [
  {
    type: "function",
    name: "generate_classification_question",
    description: "Generate a structured question to help classify an HTS product. Used when you need more information from the user.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to ask the user"
        },
        explanation: {
          type: "string",
          description: "Explanation of why this question is important for classification"
        },
        options: {
          type: "array",
          description: "Available answer options",
          items: {
            type: "object",
            properties: {
              key: {
                type: "string",
                description: "Option identifier (A, B, C, etc.)"
              },
              value: {
                type: "string",
                description: "Option description"
              }
            },
            required: ["key", "value"]
          }
        },
        reasoning: {
          type: "string",
          description: "Your chain of thought reasoning about why you're asking this question and how it will help classify the product"
        }
      },
      required: ["question", "explanation", "options", "reasoning"]
    }
  },
  {
    type: "function",
    name: "generate_final_classification",
    description: "Generate the final HTS classification for a product. Only use this when you have enough information to provide a final classification.",
    parameters: {
      type: "object",
      properties: {
        htsCode: {
          type: "string",
          description: "The final HTS code (e.g., '6302.60.0020'). Must be validated with validate_hts_code() first."
        },
        explanation: {
          type: "string",
          description: "Explanation of the classification reasoning"
        },
        confidence: {
          type: "string",
          description: "Confidence level in the classification (e.g., '95% - High')"
        },
        griApplied: {
          type: "string",
          description: "GRI rules applied in this classification (e.g., 'GRI 1')"
        },
        reasoning: {
          type: "string",
          description: "Your detailed chain of thought reasoning about this classification"
        }
      },
      required: ["htsCode", "explanation", "confidence", "griApplied", "reasoning"]
    }
  }
];

// All tools combined
const allTools = [
  ...mongodbTools,
  ...structuredOutputTools
];

// File search tool configuration
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 10
};

/**
 * Extract structured response from OpenAI output
 * Handles both function call outputs and text responses
 */
function extractStructuredResponse(response) {
  console.log('\n🔍 EXTRACTING RESPONSE');
  console.log(`📊 Response ID: ${response.id}`);
  console.log(`📋 Output items: ${response.output?.length || 0}`);

  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return null;
  }

  // Look for function call outputs (structured responses)
  for (const outputItem of response.output) {
    console.log(`📝 Processing output type: ${outputItem.type}`);
    
    if (outputItem.type === 'function_call') {
      const functionName = outputItem.name;
      const functionArgs = JSON.parse(outputItem.arguments);
      
      console.log(`🎯 Found function call: ${functionName}`);
      console.log(`📥 Arguments:`, functionArgs);
      
      if (functionName === 'generate_classification_question') {
        return {
          responseType: "question",
          question: functionArgs.question,
          explanation: functionArgs.explanation,
          options: functionArgs.options.map(opt => ({
            key: opt.key,
            value: opt.value
          })),
          _reasoning: functionArgs.reasoning
        };
      }
      
      if (functionName === 'generate_final_classification') {
        return {
          responseType: "classification",
          htsCode: functionArgs.htsCode,
          explanation: functionArgs.explanation,
          confidence: functionArgs.confidence,
          griApplied: functionArgs.griApplied,
          _reasoning: functionArgs.reasoning
        };
      }
    }
  }

  // Look for message content (text responses)
  for (const outputItem of response.output) {
    if (outputItem.type === 'message' && outputItem.content) {
      for (const contentItem of outputItem.content) {
        if (contentItem.type === 'output_text' && contentItem.text) {
          console.log(`📄 Found text response: ${contentItem.text.substring(0, 100)}...`);
          
          // Try to extract JSON from text (backward compatibility)
          const extracted = extractRelevantFieldsFromText(contentItem.text);
          if (extracted) {
            console.log(`✅ Extracted structured data from text`);
            return extracted;
          }
          
          // Return plain text if no JSON found
          return {
            responseType: "text",
            content: contentItem.text
          };
        }
      }
    }
  }

  console.log('❌ No extractable response found');
  return null;
}

/**
 * Extract JSON from text (backward compatibility)
 * Same as your original function
 */
function extractRelevantFieldsFromText(text) {
  if (typeof text !== 'string') return null;

  let jsonMatch = text.match(/```json\s*([\s\S]*?)```/i);
  if (!jsonMatch) {
    const startIndex = text.indexOf('{');
    if (startIndex === -1) return null;
    
    let braceCount = 0;
    let endIndex = startIndex;
    
    for (let i = startIndex; i < text.length; i++) {
      if (text[i] === '{') braceCount++;
      if (text[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIndex = i;
        break;
      }
    }
    
    if (braceCount !== 0) return null;
    
    const jsonString = text.substring(startIndex, endIndex + 1);
    jsonMatch = [jsonString, jsonString];
  }

  if (!jsonMatch) return null;
  
  try {
    const obj = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    
    const responseType = obj.responseType || obj.type;
    
    if (responseType === "question") {
      return {
        responseType: "question",
        question: obj.question,
        explanation: obj.explanation,
        options: (obj.options || []).map(opt => ({
          key: opt.key,
          value: opt.value
        }))
      };
    }
    
    if (responseType === "classification" || responseType === "result") {
      return {
        responseType: "classification",
        htsCode: obj.htsCode,
        explanation: obj.explanation,
        confidence: obj.confidence,
        griApplied: obj.griApplied
      };
    }
    
    return null;
  } catch (error) {
    console.error('JSON parsing error:', error);
    return null;
  }
}

/**
 * Start a new classification session
 * Let OpenAI handle all tool calls automatically
 */
async function startClassification(productDescription) {
  try {
    console.log('\n🚀 STARTING CLASSIFICATION');
    console.log(`📝 Product: ${productDescription.substring(0, 100)}...`);

    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: config.systemPrompt
        },
        {
          role: "user", 
          content: productDescription
        }
      ],
      tools: [
        fileSearchTool,
        ...allTools
      ],
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Response created with ID: ${response.id}`);
    console.log(`🔧 Tools available: ${allTools.length + 1} (including file search)`);

    // Log tool usage if any
    const toolCalls = response.output?.filter(item => 
      item.type === 'function_call' || 
      item.type === 'file_search_call' ||
      item.type === 'tool_call'
    ) || [];
    
    if (toolCalls.length > 0) {
      console.log(`🛠️ Tools used: ${toolCalls.length}`);
      toolCalls.forEach((call, i) => {
        console.log(`   ${i + 1}. ${call.type}: ${call.name || 'file_search'}`);
      });
    }

    // Extract the response
    const extractedResponse = extractStructuredResponse(response);
    
    console.log(`📤 Response type: ${extractedResponse?.responseType || 'unknown'}`);

    return {
      response_id: response.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('❌ Error starting classification:', error);
    throw error;
  }
}

/**
 * Continue an existing classification session
 * Maintains conversation context via previous_response_id
 */
async function continueClassification(previousResponseId, userSelection) {
  try {
    console.log('\n🔄 CONTINUING CLASSIFICATION');
    console.log(`🔗 Previous Response ID: ${previousResponseId}`);
    console.log(`💬 User Selection: ${userSelection}`);

    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "user",
          content: userSelection
        }
      ],
      previous_response_id: previousResponseId, // This maintains full conversation context
      tools: [
        fileSearchTool,
        ...allTools
      ],
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Continuation response created with ID: ${response.id}`);

    // Log tool usage if any
    const toolCalls = response.output?.filter(item => 
      item.type === 'function_call' || 
      item.type === 'file_search_call' ||
      item.type === 'tool_call'
    ) || [];
    
    if (toolCalls.length > 0) {
      console.log(`🛠️ Tools used in continuation: ${toolCalls.length}`);
      toolCalls.forEach((call, i) => {
        console.log(`   ${i + 1}. ${call.type}: ${call.name || 'file_search'}`);
      });
    }

    // Extract the response
    const extractedResponse = extractStructuredResponse(response);
    
    console.log(`📤 Continuation response type: ${extractedResponse?.responseType || 'unknown'}`);
    
    return {
      response_id: response.id, // Always return the latest response ID
      response: extractedResponse
    };

  } catch (error) {
    console.error('❌ Error continuing classification:', error);
    throw error;
  }
}

/**
 * Optional: Retrieve a previous response (for debugging/inspection)
 */
async function retrieveResponse(responseId) {
  try {
    console.log(`🔍 RETRIEVING RESPONSE: ${responseId}`);
    
    const response = await openai.responses.retrieve(responseId);
    
    console.log(`✅ Retrieved response with ${response.output?.length || 0} output items`);
    
    return {
      response_id: response.id,
      response: extractStructuredResponse(response),
      raw_response: response
    };
    
  } catch (error) {
    console.error('❌ Error retrieving response:', error);
    throw error;
  }
}

module.exports = {
  startClassification,
  continueClassification,
  retrieveResponse // Optional utility function
};