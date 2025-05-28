// services/openaiService.js
// Production-ready OpenAI service using the working Responses API approach

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService'); // Your existing MongoDB service

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// MongoDB function tools
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

// File search tool
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 10
};

/**
 * Execute a MongoDB function call using your existing service
 */
async function executeMongoDBFunction(functionName, functionArgs) {
  console.log(`\n🔧 EXECUTING: ${functionName}`);
  console.log(`📥 Arguments:`, functionArgs);
  
  try {
    switch (functionName) {
      case 'lookup_hts_by_six_digit_base':
        const lookupResults = await mongodbService.lookupBySixDigitBase(functionArgs.six_digit_base);
        
        console.log(`📤 Lookup result: ${lookupResults.length} codes found`);
        
        return {
          success: true,
          data: lookupResults,
          message: `Found ${lookupResults.length} codes for six_digit_base: ${functionArgs.six_digit_base}`
        };

      case 'validate_hts_code':
        const validationResult = await mongodbService.validateHtsCode(functionArgs.hts_code);
        
        console.log(`📤 Validation result: ${validationResult.isValid ? 'Valid' : 'Invalid'}`);
        
        return {
          success: true,
          data: validationResult,
          message: validationResult.isValid 
            ? `HTS code ${functionArgs.hts_code} is valid` 
            : `HTS code ${functionArgs.hts_code} is NOT valid`
        };

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  } catch (error) {
    console.error(`❌ Error in MongoDB function ${functionName}:`, error);
    return {
      success: false,
      message: `Error executing ${functionName}: ${error.message}`
    };
  }
}

/**
 * Process function calls in response - PRODUCTION VERSION
 */
async function processFunctionCalls(response) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS');
  
  const functionCalls = response.output.filter(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  console.log(`📊 Found ${functionCalls.length} MongoDB function calls`);
  
  if (functionCalls.length === 0) {
    return response; // No MongoDB function calls to process
  }
  
  // Build input array with ONLY function outputs
  const input = [];
  
  // Execute each MongoDB function and add results
  for (const functionCall of functionCalls) {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments);
    const callId = functionCall.call_id; // Use the correct call_id
    
    console.log(`🎯 Processing: ${functionName} (${callId})`);
    
    const result = await executeMongoDBFunction(functionName, functionArgs);
    
    // Add ONLY function result to input array
    input.push({
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(result)
    });
  }
  
  console.log(`📤 Prepared ${input.length} function outputs`);
  
  // Create next response with function results
  const followUpResponse = await openai.responses.create({
    model: config.openai.model,
    input: input,
    previous_response_id: response.id, // Maintain conversation context
    tools: [
      fileSearchTool,
      ...mongodbTools
    ],
    temperature: 0.21,
    max_output_tokens: 2048,
    top_p: 1,
    store: true
  });
  
  console.log(`✅ Follow-up response created: ${followUpResponse.id}`);
  
  // Check if follow-up response also has MongoDB function calls (recursive)
  const hasMoreFunctionCalls = followUpResponse.output.some(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  if (hasMoreFunctionCalls) {
    console.log('🔄 Follow-up response also has function calls, processing recursively...');
    return await processFunctionCalls(followUpResponse);
  }
  
  return followUpResponse;
}

/**
 * Extract structured response from OpenAI output
 */
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return { type: 'error', message: 'No output found' };
  }

  console.log(`📊 Found ${response.output.length} output items`);

  // Look for the final message content (after any function calls)
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found final text response`);
        
        // Try to extract JSON from text
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.responseType) {
              return parsed;
            }
          } catch (error) {
            console.log('JSON parsing failed, treating as plain text');
          }
        }
        
        return {
          responseType: "text",
          content: content.text
        };
      }
    }
  }

  console.log('❌ No extractable response found');
  return { type: 'error', message: 'Could not extract response' };
}

/**
 * Start a new classification session
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
        ...mongodbTools
      ],
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Initial response created: ${response.id}`);
    
    // Process any MongoDB function calls
    const finalResponse = await processFunctionCalls(response);

    const extractedResponse = extractStructuredResponse(finalResponse);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('❌ Error starting classification:', error);
    throw error;
  }
}

/**
 * Continue an existing classification session
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
      previous_response_id: previousResponseId, // This maintains conversation context
      tools: [
        fileSearchTool,
        ...mongodbTools
      ],
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Continue response created: ${response.id}`);
    
    // Process any MongoDB function calls
    const finalResponse = await processFunctionCalls(response);

    const extractedResponse = extractStructuredResponse(finalResponse);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('❌ Error continuing classification:', error);
    throw error;
  }
}

module.exports = {
  startClassification,
  continueClassification
};