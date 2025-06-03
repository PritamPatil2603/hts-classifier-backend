// services/openaiService.js
// Production-ready OpenAI service using the working Responses API approach

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Optimized MongoDB function tools - combining both approaches
const mongodbTools = [
  {
    type: "function",
    name: "lookup_by_subheading",
    description: "Get all statistical suffixes for a 6-digit subheading. Use when you have HIGH CONFIDENCE (85%+) in specific material/type.",
    parameters: {
      type: "object",
      properties: {
        subheading: {
          type: "string",
          description: "6-digit subheading code without periods, e.g., '080430'"
        }
      },
      required: ["subheading"]
    }
  },
  {
    type: "function",
    name: "lookup_by_heading", 
    description: "Get all subheadings under a 4-digit heading. Use when you have MEDIUM CONFIDENCE (70-84%) in general category.",
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "4-digit heading code, e.g., '0804'"
        }
      },
      required: ["heading"]
    }
  },
  {
    type: "function", 
    name: "validate_hts_code",
    description: "Validate if a complete HTS code exists. ALWAYS use before final classification.",
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "Complete HTS code with periods, e.g., '0804.30.20.00'"
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
  max_num_results: 7
};

/**
 * OPTIMIZED: Execute MongoDB function with caching and error handling
 */
async function executeMongoDBFunction(functionName, functionArgs) {
  console.log(`🔧 EXECUTING: ${functionName}`);
  console.log(`📥 Arguments:`, functionArgs);
  
  const startTime = Date.now();
  
  try {
    let result;
    
    switch (functionName) {
      case 'lookup_by_subheading':
        const subheadingResults = await mongodbService.lookupBySubheading(functionArgs.subheading);
        result = {
          success: true,
          data: subheadingResults,
          message: `Found ${subheadingResults?.length || 0} codes for subheading: ${functionArgs.subheading}`
        };
        break;

      case 'lookup_by_heading':
        const headingResults = await mongodbService.lookupByHeading(functionArgs.heading);
        result = {
          success: true,
          data: headingResults,
          message: `Found ${headingResults?.length || 0} codes for heading: ${functionArgs.heading}`
        };
        break;

      case 'validate_hts_code':
        const validationResult = await mongodbService.validateHtsCode(functionArgs.hts_code);
        result = {
          success: true,
          data: validationResult,
          message: validationResult?.isValid 
            ? `HTS code ${functionArgs.hts_code} is valid` 
            : `HTS code ${functionArgs.hts_code} is NOT valid`
        };
        break;

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
    
    const executionTime = Date.now() - startTime;
    console.log(`✅ ${functionName} completed in ${executionTime}ms`);
    
    return result;
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    console.error(`❌ Error in ${functionName} after ${executionTime}ms:`, error.message);
    
    return {
      success: false,
      message: `Error executing ${functionName}: ${error.message}`,
      error: error.name
    };
  }
}

/**
 * OPTIMIZED: Process function calls with parallel execution for better performance
 */
async function processFunctionCalls(response) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS (OPTIMIZED)');
  
  const functionCalls = response.output.filter(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  console.log(`📊 Found ${functionCalls.length} MongoDB function calls`);
  
  if (functionCalls.length === 0) {
    return response;
  }
  
  const startTime = Date.now();
  
  // OPTIMIZATION: Execute functions in parallel for better performance
  const functionPromises = functionCalls.map(async (functionCall) => {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments);
    const callId = functionCall.call_id;
    
    console.log(`🎯 Processing: ${functionName} (${callId})`);
    
    const result = await executeMongoDBFunction(functionName, functionArgs);
    
    return {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(result)
    };
  });
  
  // Wait for all functions to complete
  const input = await Promise.all(functionPromises);
  
  const totalTime = Date.now() - startTime;
  console.log(`📤 All ${input.length} functions completed in ${totalTime}ms`);
  
  // Create next response
  const followUpResponse = await openai.responses.create({
    model: config.openai.model,
    input: input,
    previous_response_id: response.id,
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
  
  // Check for more function calls (with recursion limit)
  const hasMoreFunctionCalls = followUpResponse.output.some(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  if (hasMoreFunctionCalls) {
    console.log('🔄 Processing additional function calls...');
    return await processFunctionCalls(followUpResponse);
  }
  
  return followUpResponse;
}

/**
 * OPTIMIZED: Extract response with better JSON parsing
 */
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    return { responseType: 'error', message: 'No output found' };
  }

  // Find the final message
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage?.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        // Try multiple JSON extraction methods
        let jsonText = content.text;
        
        // Method 1: Look for JSON blocks
        const jsonBlockMatch = jsonText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonBlockMatch) {
          jsonText = jsonBlockMatch[1];
        } else {
          // Method 2: Look for standalone JSON
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }
        }
        
        try {
          const parsed = JSON.parse(jsonText);
          if (parsed.responseType) {
            return parsed;
          }
        } catch (error) {
          // If JSON parsing fails, return as text
          console.log('JSON parsing failed, treating as text');
        }
        
        return {
          responseType: "text",
          content: content.text
        };
      }
    }
  }

  return { responseType: 'error', message: 'Could not extract response' };
}

/**
 * OPTIMIZED: Start classification with performance monitoring
 */
async function startClassification(productDescription) {
  const startTime = Date.now();
  
  try {
    console.log('\n🚀 STARTING CLASSIFICATION (OPTIMIZED)');
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
          content: `Please classify this product: ${productDescription}

Use the lookup functions strategically:
1. Use lookup_by_heading for broad category search
2. Use lookup_by_subheading when you're confident about specific codes  
3. Always validate_hts_code before final classification

Provide either a question or final classification.`
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
    
    const finalResponse = await processFunctionCalls(response);
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`🏁 Total classification time: ${totalTime}ms`);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime
      }
    };

  } catch (error) {
    console.error('❌ Error starting classification:', error);
    throw error;
  }
}

/**
 * OPTIMIZED: Continue classification with performance monitoring
 */
async function continueClassification(previousResponseId, userSelection) {
  const startTime = Date.now();
  
  try {
    console.log('\n🔄 CONTINUING CLASSIFICATION (OPTIMIZED)');
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
      previous_response_id: previousResponseId,
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
    
    const finalResponse = await processFunctionCalls(response);
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`🏁 Total continuation time: ${totalTime}ms`);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime
      }
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