// services/openaiService.js
// Complete optimized OpenAI service with single API call processing and prompt caching

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Cache for system prompt to ensure consistency across requests
const CACHED_SYSTEM_PROMPT = config.systemPrompt;

// MongoDB function tools - keep consistent for caching
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
          description: "6-digit subheading code without periods, e.g., '080430' for Pineapples"
        }
      },
      required: ["subheading"]
    }
  },
  {
    type: "function",
    name: "lookup_by_heading", 
    description: "Get all subheadings and codes under a 4-digit heading. Use when you have MEDIUM CONFIDENCE (70-84%) in general category.",
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "4-digit heading code, e.g., '0804' for dates, figs, pineapples, etc."
        }
      },
      required: ["heading"]
    }
  },
  {
    type: "function", 
    name: "validate_hts_code",
    description: "Validate if a complete HTS code exists in the official MongoDB database. ALWAYS use before final classification.",
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "The complete HTS code with periods, e.g., '0804.30.20.00'"
        }
      },
      required: ["hts_code"]
    }
  }
];

// File search tool - keep consistent for caching
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 10
};

// Consistent tool array for caching - NEVER change this order or structure
const ALL_TOOLS = [fileSearchTool, ...mongodbTools];

/**
 * 🔧 UTILITY: Count tokens approximately for debugging
 */
function countTokensApproximate(text) {
  // More accurate approximation: 1 token ≈ 3.5-4 characters for English text
  return Math.ceil(text.length / 3.7);
}

/**
 * 🔧 UTILITY: Verify caching setup before making requests
 */
function verifyCachingSetup() {
  console.log('\n🔍 VERIFYING CACHING SETUP:');
  
  // Check system prompt length
  const systemPromptTokens = countTokensApproximate(CACHED_SYSTEM_PROMPT);
  console.log(`📏 System prompt estimated tokens: ${systemPromptTokens}`);
  
  if (systemPromptTokens < 1024) {
    console.log(`🚨 WARNING: System prompt too short for caching (needs 1024+ tokens)`);
    console.log(`   Current: ${systemPromptTokens}, Required: 1024+`);
  } else {
    console.log(`✅ System prompt long enough for caching (${systemPromptTokens} tokens)`);
  }
  
  // Check model support
  console.log(`🤖 Model: ${config.openai.model}`);
  const cachingSupportedModels = [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-11-20', 'gpt-4o-2024-08-06',
    'o1-2024-12-17', 'o1-preview', 'o1-mini'
  ];
  
  const modelSupported = cachingSupportedModels.some(model => 
    config.openai.model.toLowerCase().includes(model.toLowerCase())
  );
  
  if (modelSupported) {
    console.log(`✅ Model supports prompt caching`);
  } else {
    console.log(`🚨 WARNING: Model may not support prompt caching`);
    console.log(`   Current: ${config.openai.model}`);
    console.log(`   Supported: ${cachingSupportedModels.join(', ')}`);
  }
  
  return { systemPromptTokens, modelSupported };
}

/**
 * 🔧 UTILITY: Create optimized input structure for maximum caching
 */
function createOptimizedInput(productDescription) {
  // Always use the same system prompt structure for caching
  const input = [
    {
      role: "system",
      content: CACHED_SYSTEM_PROMPT // This will be cached after first use
    },
    {
      role: "user", 
      content: productDescription // This varies per request
    }
  ];
  
  // Calculate total estimated tokens for debugging
  const totalText = input.map(msg => msg.content).join(' ');
  const estimatedTokens = countTokensApproximate(totalText);
  console.log(`📏 Total estimated input tokens: ${estimatedTokens}`);
  
  return input;
}

/**
 * 🔧 ENHANCED: Monitor cache performance with detailed debugging
 */
function monitorCachePerformance(response, operation) {
  if (!response.usage) {
    console.log(`⚠️ No usage data available for ${operation}`);
    return null;
  }
  
  const usage = response.usage;
  console.log(`\n📊 USAGE DATA STRUCTURE (${operation}):`);
  console.log(`   Model: ${response.model}`);
  console.log(`   Total Prompt Tokens: ${usage.prompt_tokens}`);
  console.log(`   Completion Tokens: ${usage.completion_tokens}`);
  console.log(`   Total Tokens: ${usage.total_tokens}`);
  
  // Check for prompt_tokens_details
  if (!usage.prompt_tokens_details) {
    console.log(`⚠️ No prompt_tokens_details available for ${operation}`);
    console.log(`   This could mean:`);
    console.log(`   - Model doesn't support caching`);
    console.log(`   - Prompt is under 1024 tokens`);
    console.log(`   - API version issue`);
    return null;
  }
  
  const cachedTokens = usage.prompt_tokens_details.cached_tokens || 0;
  const totalTokens = usage.prompt_tokens;
  const cacheHitRate = totalTokens > 0 ? (cachedTokens / totalTokens * 100) : 0;
  const costSavings = totalTokens > 0 ? (cachedTokens * 0.5 / totalTokens * 100) : 0;
  
  console.log(`\n📊 CACHE PERFORMANCE (${operation}):`);
  console.log(`   Total Input Tokens: ${totalTokens}`);
  console.log(`   Cached Tokens: ${cachedTokens}`);
  console.log(`   New Tokens Processed: ${totalTokens - cachedTokens}`);
  console.log(`   Cache Hit Rate: ${cacheHitRate.toFixed(1)}%`);
  console.log(`   Cost Savings: ~${costSavings.toFixed(1)}%`);
  console.log(`   Response ID: ${response.id}`);
  
  // Diagnostic warnings
  if (totalTokens >= 1024 && cachedTokens === 0) {
    console.log(`🚨 WARNING: Prompt >1024 tokens but no caching detected!`);
    console.log(`   Check: Model support, prompt structure consistency`);
  } else if (cachedTokens > 0) {
    console.log(`🎉 CACHE WORKING: ${cachedTokens} tokens served from cache!`);
  }
  
  return {
    totalTokens,
    cachedTokens,
    cacheHitRate,
    costSavings
  };
}

/**
 * 🚀 OPTIMIZED: Execute MongoDB functions in parallel
 */
async function executeMongoDBFunctionsInParallel(functionCalls) {
  console.log(`\n🚀 EXECUTING ${functionCalls.length} MONGODB FUNCTIONS IN PARALLEL`);
  
  const functionPromises = functionCalls.map(async (functionCall) => {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments);
    const callId = functionCall.call_id;
    
    console.log(`🎯 Processing: ${functionName} (${callId})`);
    console.log(`   Arguments: ${JSON.stringify(functionArgs)}`);
    
    try {
      let result;
      const startTime = Date.now();
      
      switch (functionName) {
        case 'lookup_by_subheading':
          const lookupSubheadingResults = await mongodbService.lookupBySubheading(functionArgs.subheading);
          result = {
            success: true,
            data: lookupSubheadingResults,
            message: `Found ${lookupSubheadingResults.length} codes for subheading: ${functionArgs.subheading}`,
            executionTime: Date.now() - startTime
          };
          break;

        case 'lookup_by_heading':
          const lookupHeadingResults = await mongodbService.lookupByHeading(functionArgs.heading);
          result = {
            success: true,
            data: lookupHeadingResults,
            message: `Found ${lookupHeadingResults.length} codes for heading: ${functionArgs.heading}`,
            executionTime: Date.now() - startTime
          };
          break;

        case 'validate_hts_code':
          const validationResult = await mongodbService.validateHtsCode(functionArgs.hts_code);
          result = {
            success: true,
            data: validationResult,
            message: validationResult.isValid 
              ? `HTS code ${functionArgs.hts_code} is valid` 
              : `HTS code ${functionArgs.hts_code} is NOT valid`,
            executionTime: Date.now() - startTime
          };
          break;

        default:
          throw new Error(`Unknown function: ${functionName}`);
      }
      
      console.log(`✅ ${functionName} completed in ${result.executionTime}ms`);
      
      return {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result)
      };
      
    } catch (error) {
      console.error(`❌ Error in function ${functionName}:`, error.message);
      return {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          success: false,
          message: `Error executing ${functionName}: ${error.message}`,
          executionTime: Date.now() - Date.now()
        })
      };
    }
  });
  
  // Execute all functions in parallel and wait for completion
  const results = await Promise.all(functionPromises);
  console.log(`✅ All ${results.length} MongoDB functions completed in parallel`);
  
  return results;
}

/**
 * 🚨 CRITICAL FIX: Single API call processing (NO RECURSION)
 */
async function processFunctionCallsOptimized(response) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS (SINGLE CALL OPTIMIZATION)');
  
  const functionCalls = response.output.filter(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  console.log(`📊 Found ${functionCalls.length} MongoDB function calls`);
  
  if (functionCalls.length === 0) {
    console.log(`✅ No MongoDB function calls to process`);
    return response;
  }
  
  // 🚀 Execute ALL MongoDB functions in parallel
  const functionOutputs = await executeMongoDBFunctionsInParallel(functionCalls);
  
  console.log(`📤 Making SINGLE follow-up API call with ${functionOutputs.length} function results`);
  
  // 🚨 CRITICAL: Make ONLY ONE follow-up API call with ALL function results
  const followUpResponse = await openai.responses.create({
    model: config.openai.model,
    input: functionOutputs, // All function outputs in one call
    previous_response_id: response.id, // Maintain conversation context
    tools: ALL_TOOLS, // Use consistent tool array for caching
    temperature: 0.21,
    max_output_tokens: 2048,
    top_p: 1,
    store: true
  });
  
  console.log(`✅ Single follow-up response created: ${followUpResponse.id}`);
  
  // 🚨 CRITICAL: NO MORE RECURSIVE CALLS - Return immediately
  // This eliminates the multiple API calls that were causing high latency
  console.log(`🛑 Returning final response (no recursion) - latency optimization complete`);
  
  return followUpResponse;
}

/**
 * 🔧 ENHANCED: Extract structured response with better error handling
 */
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found in response');
    return { responseType: 'error', message: 'No output found in response' };
  }

  console.log(`📊 Found ${response.output.length} output items`);
  
  // Log output structure for debugging
  response.output.forEach((item, index) => {
    console.log(`   Item ${index}: type=${item.type}`);
  });

  // Look for the final message content
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found final text response (${content.text.length} chars)`);
        
        // Try to extract JSON from text
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.responseType) {
              console.log(`✅ Extracted structured response: ${parsed.responseType}`);
              return parsed;
            }
          } catch (error) {
            console.log('⚠️ JSON parsing failed, treating as plain text');
          }
        }
        
        return {
          responseType: "text",
          content: content.text
        };
      }
    }
  }

  console.log('❌ No extractable response found in output');
  return { responseType: 'error', message: 'Could not extract response from output' };
}

/**
 * 🚀 MAIN: Start classification with full optimization
 */
async function startClassification(productDescription) {
  const startTime = Date.now();
  
  try {
    // 🔍 Verify caching setup
    const setupInfo = verifyCachingSetup();
    
    console.log('\n🚀 STARTING CLASSIFICATION (FULLY OPTIMIZED)');
    console.log(`📝 Product: ${productDescription.substring(0, 100)}...`);

    // Create optimized input for maximum caching
    const optimizedInput = createOptimizedInput(productDescription);

    // Make initial API call
    console.log(`📤 Making initial API call to ${config.openai.model}`);
    const response = await openai.responses.create({
      model: config.openai.model,
      input: optimizedInput,
      tools: ALL_TOOLS, // Consistent tool array for caching
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Initial response created: ${response.id}`);
    const initialCachePerf = monitorCachePerformance(response, 'INITIAL_CLASSIFICATION');
    
    // 🚨 CRITICAL: Single function processing call (no recursion)
    const finalResponse = await processFunctionCallsOptimized(response);
    
    // Monitor cache performance for follow-up call if it was made
    let finalCachePerf = null;
    if (finalResponse.id !== response.id) {
      finalCachePerf = monitorCachePerformance(finalResponse, 'FUNCTION_PROCESSING');
    }

    // Extract the final structured response
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ TOTAL CLASSIFICATION TIME: ${totalTime}ms`);
    
    // Performance summary
    console.log(`\n📈 PERFORMANCE SUMMARY:`);
    console.log(`   Total Time: ${totalTime}ms`);
    console.log(`   API Calls Made: ${finalResponse.id !== response.id ? 2 : 1}`);
    console.log(`   Caching Status: ${initialCachePerf ? 'Available' : 'Not Available'}`);
    if (initialCachePerf && initialCachePerf.cachedTokens > 0) {
      console.log(`   Cache Savings: ${initialCachePerf.costSavings.toFixed(1)}%`);
    }
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime,
        cache_performance: finalResponse.usage?.prompt_tokens_details || null,
        setup_info: setupInfo,
        api_calls_made: finalResponse.id !== response.id ? 2 : 1
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Error starting classification (${totalTime}ms):`, error);
    throw error;
  }
}

/**
 * 🔄 MAIN: Continue classification with optimization
 */
async function continueClassification(previousResponseId, userSelection) {
  const startTime = Date.now();
  
  try {
    console.log('\n🔄 CONTINUING CLASSIFICATION (OPTIMIZED)');
    console.log(`🔗 Previous Response ID: ${previousResponseId}`);
    console.log(`💬 User Selection: ${userSelection}`);

    // Estimate tokens for the user input
    const userInputTokens = countTokensApproximate(userSelection);
    console.log(`📏 User input estimated tokens: ${userInputTokens}`);

    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "user",
          content: userSelection
        }
      ],
      previous_response_id: previousResponseId, // Maintains conversation context and caching
      tools: ALL_TOOLS, // Consistent tool array for caching
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Continue response created: ${response.id}`);
    const continueCachePerf = monitorCachePerformance(response, 'CONTINUE_CLASSIFICATION');
    
    // 🚨 CRITICAL: Single function processing call (no recursion)
    const finalResponse = await processFunctionCallsOptimized(response);
    
    // Monitor cache performance for follow-up call if it was made
    let finalCachePerf = null;
    if (finalResponse.id !== response.id) {
      finalCachePerf = monitorCachePerformance(finalResponse, 'CONTINUE_FUNCTION_PROCESSING');
    }

    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ TOTAL CONTINUE TIME: ${totalTime}ms`);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime,
        cache_performance: finalResponse.usage?.prompt_tokens_details || null,
        api_calls_made: finalResponse.id !== response.id ? 2 : 1
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Error continuing classification (${totalTime}ms):`, error);
    throw error;
  }
}

/**
 * 🔥 UTILITY: Warm up the cache for better performance
 */
async function warmUpCache() {
  try {
    console.log('\n🔥 WARMING UP PROMPT CACHE...');
    
    const dummyInput = createOptimizedInput("Cache warming request - this builds the system prompt cache");
    
    const response = await openai.responses.create({
      model: config.openai.model,
      input: dummyInput,
      tools: ALL_TOOLS,
      temperature: 0.21,
      max_output_tokens: 50, // Minimal output for warmup
      top_p: 1,
      store: true
    });
    
    console.log(`✅ Cache warmed up with response: ${response.id}`);
    monitorCachePerformance(response, 'CACHE_WARMUP');
    
    return response.id;
  } catch (error) {
    console.error('❌ Error warming up cache:', error);
    return null;
  }
}

/**
 * 🔍 UTILITY: Health check for the OpenAI service
 */
async function healthCheck() {
  try {
    const setupInfo = verifyCachingSetup();
    
    // Test basic API connectivity
    const testResponse = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: "You are a test assistant."
        },
        {
          role: "user",
          content: "Respond with 'Health check successful'"
        }
      ],
      max_output_tokens: 20,
      temperature: 0
    });
    
    return {
      status: 'healthy',
      model: config.openai.model,
      setup_info: setupInfo,
      test_response_id: testResponse.id,
      cache_supported: !!testResponse.usage?.prompt_tokens_details
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      model: config.openai.model
    };
  }
}

module.exports = {
  startClassification,
  continueClassification,
  warmUpCache,
  healthCheck,
  // Utility functions for testing
  verifyCachingSetup,
  countTokensApproximate
};