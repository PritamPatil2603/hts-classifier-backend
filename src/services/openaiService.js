// services/openaiService.js
// Final optimized OpenAI service - Clean version focused on prompt caching

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService');

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

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

// File search tool
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 10
};

// Consistent tool array for caching
const ALL_TOOLS = [fileSearchTool, ...mongodbTools];

/**
 * 🔍 SIMPLE: Check if prompt caching is working
 */
function checkCaching(response) {
  console.log(`\n🔍 CACHE CHECK:`);
  console.log(`   Model: ${response.model}`);
  console.log(`   Prompt Tokens: ${response.usage?.prompt_tokens || 'N/A'}`);
  
  // Check if caching is supported by looking at actual API response
  const cacheData = response.usage?.prompt_tokens_details;
  if (!cacheData) {
    console.log(`❌ NO CACHE DATA FOUND`);
    console.log(`   This means either:`);
    console.log(`   - Model doesn't support caching`);
    console.log(`   - Prompt is under 1024 tokens`);
    console.log(`   - API version/configuration issue`);
    console.log(`   Let's check the raw usage data...`);
    console.log(`   Raw usage:`, JSON.stringify(response.usage, null, 2));
    return { supported: false, working: false };
  }
  
  // Check cache performance
  const cached = cacheData.cached_tokens || 0;
  const total = response.usage.prompt_tokens || 0;
  const hitRate = total > 0 ? (cached / total * 100) : 0;
  
  console.log(`✅ CACHING IS SUPPORTED!`);
  console.log(`   Cached Tokens: ${cached}/${total}`);
  console.log(`   Hit Rate: ${hitRate.toFixed(1)}%`);
  
  if (cached === 0) {
    console.log(`🔄 Status: Building cache (first request with this prompt)`);
    return { supported: true, working: false, building: true };
  } else {
    console.log(`🎉 Status: Cache working! Saving ${(hitRate * 0.5).toFixed(1)}% cost`);
    return { supported: true, working: true, hitRate, cached };
  }
}

/**
 * 🛠️ SIMPLE: Verify setup before making requests
 */
function verifySetup() {
  console.log(`\n🔧 SETUP CHECK:`);
  
  // Check token count (rough estimate)
  const systemTokens = Math.ceil(config.systemPrompt.length / 4);
  console.log(`   System prompt: ${systemTokens} tokens (need 1024+)`);
  console.log(`   Model: ${config.openai.model}`);
  
  // Don't hardcode model support - let OpenAI API tell us
  console.log(`   Note: Caching support will be tested with actual API call`);
  
  if (systemTokens >= 1024) {
    console.log(`✅ Setup ready - will test caching with API`);
  } else {
    console.log(`⚠️ System prompt may be too short for caching`);
  }
  
  return { systemTokens, ready: systemTokens >= 1024 };
}

/**
 * 🔧 Create optimized input for caching
 */
function createOptimizedInput(productDescription) {
  return [
    {
      role: "system",
      content: config.systemPrompt // This will be cached
    },
    {
      role: "user", 
      content: productDescription // This varies per request
    }
  ];
}

/**
 * 🚀 Execute MongoDB functions in parallel
 */
async function executeMongoDBFunctionsInParallel(functionCalls) {
  console.log(`\n🚀 Executing ${functionCalls.length} database functions in parallel...`);
  
  const functionPromises = functionCalls.map(async (functionCall) => {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments);
    const callId = functionCall.call_id;
    
    try {
      let result;
      const startTime = Date.now();
      
      switch (functionName) {
        case 'lookup_by_subheading':
          const subResults = await mongodbService.lookupBySubheading(functionArgs.subheading);
          result = {
            success: true,
            data: subResults,
            message: `Found ${subResults.length} codes for subheading: ${functionArgs.subheading}`
          };
          break;

        case 'lookup_by_heading':
          const headResults = await mongodbService.lookupByHeading(functionArgs.heading);
          result = {
            success: true,
            data: headResults,
            message: `Found ${headResults.length} codes for heading: ${functionArgs.heading}`
          };
          break;

        case 'validate_hts_code':
          const validation = await mongodbService.validateHtsCode(functionArgs.hts_code);
          result = {
            success: true,
            data: validation,
            message: validation.isValid 
              ? `HTS code ${functionArgs.hts_code} is valid` 
              : `HTS code ${functionArgs.hts_code} is NOT valid`
          };
          break;

        default:
          throw new Error(`Unknown function: ${functionName}`);
      }
      
      console.log(`✅ ${functionName} completed (${Date.now() - startTime}ms)`);
      
      return {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(result)
      };
      
    } catch (error) {
      console.error(`❌ ${functionName} error:`, error.message);
      return {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          success: false,
          message: `Error: ${error.message}`
        })
      };
    }
  });
  
  const results = await Promise.all(functionPromises);
  console.log(`✅ All database functions completed`);
  return results;
}

/**
 * 🎯 Process function calls with single API call (NO RECURSION)
 */
async function processFunctionCallsOptimized(response) {
  console.log('\n🔧 Processing function calls...');
  
  const functionCalls = response.output.filter(output => 
    output.type === 'function_call' && 
    mongodbTools.some(tool => tool.name === output.name)
  );
  
  if (functionCalls.length === 0) {
    console.log('✅ No function calls to process');
    return response;
  }
  
  console.log(`📊 Found ${functionCalls.length} function calls`);
  
  // Execute all functions in parallel
  const functionOutputs = await executeMongoDBFunctionsInParallel(functionCalls);
  
  // Make SINGLE follow-up API call
  console.log(`📤 Making single follow-up API call...`);
  const followUpResponse = await openai.responses.create({
    model: config.openai.model,
    input: functionOutputs,
    previous_response_id: response.id,
    tools: ALL_TOOLS,
    temperature: 0.21,
    max_output_tokens: 2048,
    top_p: 1,
    store: true
  });
  
  console.log(`✅ Follow-up completed: ${followUpResponse.id}`);
  
  // NO RECURSION - return immediately
  return followUpResponse;
}

/**
 * 📄 Extract response content
 */
function extractStructuredResponse(response) {
  console.log(`\n📄 Extracting response...`);
  
  if (!response.output || !Array.isArray(response.output)) {
    return { responseType: 'error', message: 'No output found' };
  }

  // Look for message content
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`✅ Found response text (${content.text.length} chars)`);
        
        // Try to parse JSON
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.responseType) {
              console.log(`✅ Structured response: ${parsed.responseType}`);
              return parsed;
            }
          } catch (error) {
            console.log('⚠️ JSON parsing failed, using plain text');
          }
        }
        
        return {
          responseType: "text",
          content: content.text
        };
      }
    }
  }

  console.log('❌ Could not extract response');
  return { responseType: 'error', message: 'Could not extract response' };
}

/**
 * 🚀 MAIN: Start classification
 */
async function startClassification(productDescription) {
  const startTime = Date.now();
  
  try {
    // Verify setup
    const setup = verifySetup();
    
    console.log('\n🚀 Starting classification...');
    console.log(`📝 Product: ${productDescription.substring(0, 80)}...`);

    // Create input
    const input = createOptimizedInput(productDescription);

    // Make API call
    const response = await openai.responses.create({
      model: config.openai.model,
      input: input,
      tools: ALL_TOOLS,
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Initial response: ${response.id}`);
    
    // Check caching
    const cacheStatus = checkCaching(response);
    
    // Process any function calls
    const finalResponse = await processFunctionCallsOptimized(response);
    
    // Check caching on final response if different
    let finalCacheStatus = cacheStatus;
    if (finalResponse.id !== response.id) {
      finalCacheStatus = checkCaching(finalResponse);
    }

    // Extract response
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Total time: ${totalTime}ms`);
    
    // Summary
    console.log(`\n📊 SUMMARY:`);
    console.log(`   Time: ${totalTime}ms`);
    console.log(`   API calls: ${finalResponse.id !== response.id ? 2 : 1}`);
    console.log(`   Cache: ${finalCacheStatus.working ? '✅ Working' : finalCacheStatus.supported ? '🔄 Building' : '⚠️ Not detected'}`);
    if (!finalCacheStatus.supported) {
      console.log(`   Note: Run identical request again to test if caching activates`);
    }
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime,
        api_calls_made: finalResponse.id !== response.id ? 2 : 1,
        cache_status: finalCacheStatus,
        setup_info: setup
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Classification error (${totalTime}ms):`, error);
    throw error;
  }
}

/**
 * 🔄 MAIN: Continue classification
 */
async function continueClassification(previousResponseId, userSelection) {
  const startTime = Date.now();
  
  try {
    console.log('\n🔄 Continuing classification...');
    console.log(`🔗 Previous: ${previousResponseId}`);
    console.log(`💬 Input: ${userSelection}`);

    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "user",
          content: userSelection
        }
      ],
      previous_response_id: previousResponseId,
      tools: ALL_TOOLS,
      temperature: 0.21,
      max_output_tokens: 2048,
      top_p: 1,
      store: true
    });

    console.log(`✅ Continue response: ${response.id}`);
    
    // Check caching
    const cacheStatus = checkCaching(response);
    
    // Process function calls
    const finalResponse = await processFunctionCallsOptimized(response);
    
    // Check final caching
    let finalCacheStatus = cacheStatus;
    if (finalResponse.id !== response.id) {
      finalCacheStatus = checkCaching(finalResponse);
    }

    const extractedResponse = extractStructuredResponse(finalResponse);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Continue time: ${totalTime}ms`);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance: {
        total_time_ms: totalTime,
        api_calls_made: finalResponse.id !== response.id ? 2 : 1,
        cache_status: finalCacheStatus
      }
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`❌ Continue error (${totalTime}ms):`, error);
    throw error;
  }
}

/**
 * 🧪 TEST: Cache performance test
 */
async function testCachePerformance() {
  console.log('\n🧪 TESTING CACHE PERFORMANCE...');
  console.log(`🤖 Testing with model: ${config.openai.model}`);
  
  const testProduct = "Laptop computer for testing cache performance with consistent input to verify caching";
  
  try {
    // First request
    console.log('📤 First request (testing if caching is supported)...');
    const start1 = Date.now();
    const result1 = await startClassification(testProduct);
    const time1 = Date.now() - start1;
    
    // Wait 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Second identical request
    console.log('\n📤 Second identical request (testing for cache hit)...');
    const start2 = Date.now();
    const result2 = await startClassification(testProduct);
    const time2 = Date.now() - start2;
    
    // Compare results
    console.log('\n🎯 CACHE TEST RESULTS:');
    console.log(`Model tested: ${config.openai.model}`);
    console.log(`First request:  ${time1}ms - Cache: ${result1.performance.cache_status.supported ? (result1.performance.cache_status.working ? 'Working' : 'Building') : 'Not detected'}`);
    console.log(`Second request: ${time2}ms - Cache: ${result2.performance.cache_status.supported ? (result2.performance.cache_status.working ? 'Working' : 'Building') : 'Not detected'}`);
    
    const improvement = time1 > time2 ? `${((time1 - time2) / time1 * 100).toFixed(1)}% faster` : 'No improvement';
    console.log(`Performance: ${improvement}`);
    
    if (result2.performance.cache_status.working) {
      console.log(`🎉 SUCCESS: Cache is working with ${config.openai.model}!`);
      console.log(`💰 Cost savings: ${(result2.performance.cache_status.hitRate * 0.5).toFixed(1)}%`);
    } else if (result1.performance.cache_status.supported || result2.performance.cache_status.supported) {
      console.log(`🔄 PARTIAL: Model supports caching but cache building may need more time`);
    } else {
      console.log(`⚠️ INCONCLUSIVE: No cache data detected`);
      console.log(`   This could mean:`);
      console.log(`   - Model ${config.openai.model} doesn't support caching`);
      console.log(`   - Prompt structure needs adjustment`);
      console.log(`   - API configuration issue`);
    }
    
    return { result1, result2, time1, time2, improvement };
    
  } catch (error) {
    console.error('❌ Cache test failed:', error);
    return null;
  }
}

/**
 * 🔬 SIMPLE: Test if current model supports caching
 */
async function testModelCachingSupport() {
  console.log('\n🔬 TESTING MODEL CACHING SUPPORT...');
  console.log(`🤖 Model: ${config.openai.model}`);
  
  try {
    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: config.systemPrompt
        },
        {
          role: "user",
          content: "Simple test to check if this model supports prompt caching"
        }
      ],
      max_output_tokens: 50
    });
    
    const cacheSupported = !!response.usage?.prompt_tokens_details;
    
    console.log(`📊 Raw usage data:`, JSON.stringify(response.usage, null, 2));
    console.log(`\n🎯 RESULT:`);
    
    if (cacheSupported) {
      const cached = response.usage.prompt_tokens_details.cached_tokens || 0;
      console.log(`✅ Model ${config.openai.model} SUPPORTS caching!`);
      console.log(`   Cached tokens: ${cached} (expected 0 on first request)`);
      console.log(`   Make another identical request to see cache in action`);
    } else {
      console.log(`❌ Model ${config.openai.model} does NOT support caching`);
      console.log(`   No prompt_tokens_details found in response`);
    }
    
    return {
      model: config.openai.model,
      supported: cacheSupported,
      usage: response.usage
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      model: config.openai.model,
      supported: false,
      error: error.message
    };
  }
}

module.exports = {
  startClassification,
  continueClassification,
  testCachePerformance,
  testModelCachingSupport,
  verifySetup,
  checkCaching
};