const OpenAI = require('openai');
const config = require('./config/config');
const mongodbService = require('./services/mongodbService');

// ✅ TEST: Initialize OpenAI with optimizations
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2
});

// ✅ TEST: Optimized MongoDB Tools with Strict Mode
const optimizedMongodbTools = [
  {
    type: "function",
    name: "lookup_by_heading",
    description: "Get all subheadings and codes under a 4-digit heading. Use for category exploration when confidence is 70-84%.",
    strict: true, // ✅ STRICT MODE
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "4-digit heading code (e.g., '8504' for electrical transformers)",
          pattern: "^[0-9]{4}$"
        }
      },
      required: ["heading"],
      additionalProperties: false // ✅ REQUIRED FOR STRICT MODE
    }
  },
  {
    type: "function",
    name: "lookup_by_subheading",
    description: "Get complete 10-digit HTS codes under a 6-digit subheading. Use when confident (85%+) about specific subheading.",
    strict: true, // ✅ STRICT MODE
    parameters: {
      type: "object",
      properties: {
        subheading: {
          type: "string",
          description: "6-digit subheading code (e.g., '850440' for static converters)",
          pattern: "^[0-9]{6}$"
        }
      },
      required: ["subheading"],
      additionalProperties: false // ✅ REQUIRED FOR STRICT MODE
    }
  },
  {
    type: "function",
    name: "validate_hts_code",
    description: "MANDATORY: Validate final HTS codes before presenting to user. Always use before giving final answer.",
    strict: true, // ✅ STRICT MODE
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "Complete 10-digit HTS code (e.g., '8504.40.95.10')",
          pattern: "^[0-9]{4}\\.?[0-9]{2}\\.?[0-9]{2}\\.?[0-9]{2}$"
        }
      },
      required: ["hts_code"],
      additionalProperties: false // ✅ REQUIRED FOR STRICT MODE
    }
  }
];

// ✅ TEST: Optimized System Prompt (Compact but functional)
const optimizedSystemPrompt = `# HTS Classification Expert: Alex

You are a seasoned customs broker with 15+ years experience classifying products for imports.

## Core Mission
Classify products using precise 10-digit HTS codes following CBP requirements.

## Your Approach
1. **Product Analysis**: Understand what it is, how it's made, what it does
2. **Classification Logic**: Apply GRI rules, essential character, commercial purpose  
3. **Professional Judgment**: Use experience to identify potential issues
4. **Validation**: Confirm codes exist and are current

## Response Types (JSON only)
**For insufficient detail:**
{
  "responseType": "reasoning_question",
  "reasoning": {
    "initial_assessment": "...",
    "classification_paths": "...", 
    "critical_unknowns": "...",
    "confidence_analysis": {...}
  },
  "question": {
    "question": "...",
    "explanation": "...",
    "options": [...],
    "confidence": number
  }
}

**For sufficient detail:**
{
  "responseType": "classification", 
  "htsCode": "XXXX.XX.XX.XX",
  "confidence": number,
  "expert_analysis": {
    "essential_character": "...",
    "chapter_reasoning": "...",
    "gri_applied": "..."
  },
  "professional_considerations": {
    "audit_risk_level": "...",
    "duty_rate_implications": "..."
  }
}

## Critical Rules
- ALWAYS use 10-digit HTS codes (XXXX.XX.XX.XX format)
- Show professional reasoning like experienced broker
- Include confidence levels (0-100)
- Ask clarifying questions when details missing
- Consider CBP enforcement patterns
- Validate final classifications

## Function Usage Strategy
- **lookup_by_heading**: Explore options when unsure of exact subheading
- **lookup_by_subheading**: Get specific 10-digit codes when confident
- **validate_hts_code**: MANDATORY before final classification
- Use database functions to research and confirm classifications

Think like the expert broker importers pay $300/hour to get it right.`;

// ✅ TEST: Performance Monitor
class TestPerformanceMonitor {
  constructor() {
    this.metrics = [];
    this.startTime = Date.now();
  }

  track(operation, fn) {
    return this.trackAsync(operation, fn);
  }

  async trackAsync(operation, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.metrics.push({
        operation,
        duration,
        success: true,
        timestamp: start
      });
      console.log(`✅ ${operation}: ${duration}ms`);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.push({
        operation,
        duration,
        success: false,
        error: error.message,
        timestamp: start
      });
      console.error(`❌ ${operation}: ${duration}ms - ${error.message}`);
      throw error;
    }
  }

  getStats() {
    return {
      totalOperations: this.metrics.length,
      successfulOperations: this.metrics.filter(m => m.success).length,
      averageDuration: this.metrics.length > 0 ? 
        Math.round(this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length) : 0,
      totalTestTime: Date.now() - this.startTime
    };
  }
}

// ✅ TEST: Optimized Request Configuration
function getOptimizedRequestConfig(input, previousResponseId = null, useOptimizations = true) {
  const baseConfig = {
    model: config.openai.model,
    input: input,
    tools: optimizedMongodbTools,
    store: true
  };

  if (useOptimizations) {
    // ✅ ALL OPTIMIZATIONS
    baseConfig.temperature = 0.00;          // Very low for faster responses
    baseConfig.max_output_tokens = 1500;     // Reduced from default
    baseConfig.top_p = 0.85;               // Focused token selection
    baseConfig.parallel_tool_calls = true; // Parallel function calling
  }

  if (previousResponseId) {
    baseConfig.previous_response_id = previousResponseId;
  }

  return baseConfig;
}

// ✅ TEST: Simplified Function Calling (OpenAI docs compliant)
async function processSimplifiedFunctionCalls(response, monitor) {
  return monitor.track('process_simplified_function_calls', async () => {
    const functionCalls = response.output.filter(output => 
      output.type === 'function_call' && 
      optimizedMongodbTools.some(tool => tool.name === output.name)
    );
    
    if (functionCalls.length === 0) {
      console.log('✅ No function calls to process');
      return response;
    }
    
    console.log(`📊 Processing ${functionCalls.length} function calls in parallel...`);
    
    // ✅ PARALLEL EXECUTION (like OpenAI docs example)
    const functionOutputs = await Promise.all(
      functionCalls.map(async (toolCall) => {
        try {
          const args = JSON.parse(toolCall.arguments);
          const result = await executeMongoDBFunction(toolCall.name, args, monitor);
          
          return {
            type: "function_call_output",
            call_id: toolCall.call_id,
            output: JSON.stringify(result)
          };
        } catch (error) {
          console.error(`❌ Function ${toolCall.name} failed:`, error);
          return {
            type: "function_call_output",
            call_id: toolCall.call_id,
            output: JSON.stringify({
              success: false,
              error: `Function failed: ${error.message}`
            })
          };
        }
      })
    );
    
    // ✅ SINGLE FOLLOW-UP REQUEST (not recursive)
    const followUpResponse = await monitor.track('openai_follow_up', async () => {
      const requestConfig = getOptimizedRequestConfig(functionOutputs, response.id, true);
      return await openai.responses.create(requestConfig);
    });
    
    console.log(`✅ Function calls completed: ${followUpResponse.id}`);
    return followUpResponse;
  });
}

// ✅ TEST: MongoDB Function Execution
async function executeMongoDBFunction(functionName, functionArgs, monitor) {
  return monitor.track(`mongodb_${functionName}`, async () => {
    console.log(`🔧 EXECUTING: ${functionName}`);
    console.log(`📥 Arguments:`, functionArgs);
    
    try {
      switch (functionName) {
        case 'lookup_by_subheading':
          const subheadingResults = await mongodbService.lookupBySubheading(functionArgs.subheading);
          console.log(`📤 Subheading lookup: ${subheadingResults.length} codes found`);
          return {
            success: true,
            data: subheadingResults,
            message: `Found ${subheadingResults.length} codes for subheading: ${functionArgs.subheading}`
          };

        case 'lookup_by_heading':
          const headingResults = await mongodbService.lookupByHeading(functionArgs.heading);
          console.log(`📤 Heading lookup: ${headingResults.length} codes found`);
          return {
            success: true,
            data: headingResults,
            message: `Found ${headingResults.length} codes for heading: ${functionArgs.heading}`
          };

        case 'validate_hts_code':
          const validationResult = await mongodbService.validateHtsCode(functionArgs.hts_code);
          console.log(`📤 Validation: ${validationResult.isValid ? 'Valid' : 'Invalid'}`);
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
      console.error(`❌ MongoDB function ${functionName} error:`, error);
      return {
        success: false,
        message: `Error executing ${functionName}: ${error.message}`,
        error: error.message
      };
    }
  });
}

// ✅ TEST: Response Extraction
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return { type: 'error', message: 'No output found' };
  }

  console.log(`📊 Found ${response.output.length} output items`);

  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found text response (${content.text.length} chars)`);
        
        // ✅ ENHANCED JSON EXTRACTION
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.responseType) {
              console.log(`✅ Parsed ${parsed.responseType} response`);
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

  console.log('❌ No extractable response found');
  return { type: 'error', message: 'Could not extract response' };
}

// ✅ TEST: Start Classification with ALL Optimizations
async function testOptimizedStartClassification(productDescription, useOptimizedPrompt = false) {
  const monitor = new TestPerformanceMonitor();
  
  return monitor.track('optimized_start_classification', async () => {
    console.log('\n🚀 TESTING OPTIMIZED START CLASSIFICATION');
    console.log(`📝 Product: ${productDescription}`);
    console.log(`🎯 Using optimized prompt: ${useOptimizedPrompt ? 'YES' : 'NO'}`);

    const systemPrompt = useOptimizedPrompt ? optimizedSystemPrompt : config.systemPrompt;
    
    const input = [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user", 
        content: productDescription
      }
    ];

    console.log(`📏 System prompt length: ${systemPrompt.length} chars`);

    // ✅ OPTIMIZED REQUEST
    const requestConfig = getOptimizedRequestConfig(input, null, true);
    const response = await monitor.track('openai_initial_request', async () => {
      return await openai.responses.create(requestConfig);
    });

    console.log(`✅ Initial response: ${response.id}`);
    
    // ✅ SIMPLIFIED FUNCTION PROCESSING
    const finalResponse = await processSimplifiedFunctionCalls(response, monitor);
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance_stats: monitor.getStats(),
      system_prompt_length: systemPrompt.length
    };
  });
}

// ✅ TEST: Continue Classification with JSON Format Fix
async function testOptimizedContinueClassification(previousResponseId, userSelection) {
  const monitor = new TestPerformanceMonitor();
  
  return monitor.track('optimized_continue_classification', async () => {
    console.log('\n🔄 TESTING OPTIMIZED CONTINUE CLASSIFICATION');
    console.log(`🔗 Previous Response ID: ${previousResponseId}`);
    console.log(`💬 User Selection: ${userSelection}`);

    // ✅ FIX: Add JSON format reminder to maintain structured responses
    const input = [
      {
        role: "user",
        content: `${userSelection}

IMPORTANT: Continue using the same structured JSON response format as established in our conversation. Respond with either:
- "reasoning_question" responseType if you need more information
- "classification" responseType if ready to provide final HTS classification

Maintain the same professional analysis structure and confidence levels.`
      }
    ];

    // ✅ OPTIMIZED CONTINUE REQUEST
    const requestConfig = getOptimizedRequestConfig(input, previousResponseId, true);
    const response = await monitor.track('openai_continue_request', async () => {
      return await openai.responses.create(requestConfig);
    });

    console.log(`✅ Continue response: ${response.id}`);
    
    // ✅ SIMPLIFIED FUNCTION PROCESSING
    const finalResponse = await processSimplifiedFunctionCalls(response, monitor);
    const extractedResponse = extractStructuredResponse(finalResponse);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse,
      performance_stats: monitor.getStats()
    };
  });
}

// ✅ COMPREHENSIVE TEST SUITE
async function runComprehensiveOptimizationTest() {
  console.log('\n🧪 COMPREHENSIVE OPTIMIZATION TEST SUITE');
  console.log('=' .repeat(60));
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
  
  const testProduct = "Laptop computer with Intel i7 processor, 16GB RAM, 512GB SSD, Windows 11 Pro, 15.6 inch display";
  const testResults = [];
  
  try {
    // Connect to MongoDB first
    console.log('\n🔧 Connecting to MongoDB...');
    await mongodbService.connect();
    console.log('✅ MongoDB connected');

    // ✅ TEST 1: Current system (baseline)
    console.log('\n📊 TEST 1: BASELINE (Current System)');
    try {
      const baselineResult = await testOptimizedStartClassification(testProduct, false);
      testResults.push({
        test: 'Baseline (Current Prompt)',
        ...baselineResult.performance_stats,
        promptLength: baselineResult.system_prompt_length,
        responseType: baselineResult.response.responseType,
        success: true
      });
    } catch (error) {
      console.error('❌ Baseline test failed:', error.message);
      testResults.push({
        test: 'Baseline (Current Prompt)',
        success: false,
        error: error.message
      });
    }

    // ✅ TEST 2: Optimized prompt
    console.log('\n📊 TEST 2: OPTIMIZED PROMPT');
    try {
      const optimizedResult = await testOptimizedStartClassification(testProduct, true);
      testResults.push({
        test: 'Optimized Prompt',
        ...optimizedResult.performance_stats,
        promptLength: optimizedResult.system_prompt_length,
        responseType: optimizedResult.response.responseType,
        success: true
      });
      
      // ✅ TEST 3: Continue classification (if we got a response ID)
      if (optimizedResult.response_id) {
        console.log('\n📊 TEST 3: CONTINUE CLASSIFICATION');
        try {
          const continueResult = await testOptimizedContinueClassification(
            optimizedResult.response_id, 
            "I need more specific details about the laptop's classification. It's primarily used for business applications."
          );
          testResults.push({
            test: 'Continue Classification',
            ...continueResult.performance_stats,
            responseType: continueResult.response.responseType,
            success: true
          });
        } catch (error) {
          console.error('❌ Continue classification test failed:', error.message);
          testResults.push({
            test: 'Continue Classification',
            success: false,
            error: error.message
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Optimized prompt test failed:', error.message);
      testResults.push({
        test: 'Optimized Prompt',
        success: false,
        error: error.message
      });
    }

    // ✅ RESULTS ANALYSIS
    console.log('\n📊 COMPREHENSIVE RESULTS ANALYSIS');
    console.log('=' .repeat(60));
    
    testResults.forEach((result, index) => {
      console.log(`\n🔹 ${result.test}:`);
      if (result.success) {
        console.log(`   ✅ Success: ${result.success}`);
        console.log(`   ⏱️  Total Operations: ${result.totalOperations}`);
        console.log(`   📊 Successful Ops: ${result.successfulOperations}`);
        console.log(`   🕐 Average Duration: ${result.averageDuration}ms`);
        console.log(`   🕐 Total Test Time: ${result.totalTestTime}ms`);
        if (result.promptLength) {
          console.log(`   📏 Prompt Length: ${result.promptLength.toLocaleString()} chars`);
        }
        if (result.responseType) {
          console.log(`   📄 Response Type: ${result.responseType}`);
        }
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
      }
    });

    // ✅ PERFORMANCE COMPARISON
    const successfulTests = testResults.filter(r => r.success);
    if (successfulTests.length >= 2) {
      console.log('\n🔍 PERFORMANCE COMPARISON');
      console.log('=' .repeat(60));
      
      const baseline = successfulTests.find(r => r.test.includes('Baseline'));
      const optimized = successfulTests.find(r => r.test.includes('Optimized'));
      
      if (baseline && optimized) {
        const timeSaved = baseline.totalTestTime - optimized.totalTestTime;
        const percentImprovement = ((timeSaved / baseline.totalTestTime) * 100).toFixed(1);
        
        console.log(`⚡ Time saved: ${timeSaved}ms (${percentImprovement}% improvement)`);
        console.log(`📏 Prompt size reduction: ${baseline.promptLength - optimized.promptLength} chars`);
        console.log(`🎯 Both returned: ${baseline.responseType} vs ${optimized.responseType}`);
        
        if (timeSaved > 1000) {
          console.log(`🚀 SIGNIFICANT IMPROVEMENT! Optimizations are working!`);
        } else if (timeSaved > 0) {
          console.log(`✅ MODEST IMPROVEMENT. Optimizations are helping.`);
        } else {
          console.log(`⚠️ NO IMPROVEMENT. May need different optimization strategy.`);
        }
      }
    }

    // ✅ RECOMMENDATIONS
    console.log('\n💡 OPTIMIZATION RECOMMENDATIONS');
    console.log('=' .repeat(60));
    
    const avgDuration = successfulTests.reduce((sum, r) => sum + (r.totalTestTime || 0), 0) / successfulTests.length;
    
    if (avgDuration > 15000) {
      console.log(`🚨 HIGH LATENCY (${(avgDuration/1000).toFixed(1)}s average)`);
      console.log(`   - Consider more aggressive prompt optimization`);
      console.log(`   - Implement request-level caching`);
      console.log(`   - Consider switching models if possible`);
    } else if (avgDuration > 8000) {
      console.log(`⚠️ MODERATE LATENCY (${(avgDuration/1000).toFixed(1)}s average)`);
      console.log(`   - Current optimizations are helping`);
      console.log(`   - Continue with implemented changes`);
    } else {
      console.log(`✅ GOOD PERFORMANCE (${(avgDuration/1000).toFixed(1)}s average)`);
      console.log(`   - Optimizations are working well`);
      console.log(`   - Ready for production use`);
    }

    return testResults;

  } catch (error) {
    console.error('❌ Test suite failed:', error);
    throw error;
  }
}

// ✅ RUN TEST IF CALLED DIRECTLY
if (require.main === module) {
  console.log('🚀 Starting Comprehensive Optimization Test...');
  runComprehensiveOptimizationTest()
    .then(results => {
      console.log('\n✅ All tests completed successfully!');
      console.log(`🕐 Completed at: ${new Date().toLocaleString()}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test suite failed:', error.message);
      console.error('Stack:', error.stack);
      process.exit(1);
    });
}

module.exports = { 
  runComprehensiveOptimizationTest,
  testOptimizedStartClassification,
  testOptimizedContinueClassification,
  optimizedSystemPrompt,
  optimizedMongodbTools
};