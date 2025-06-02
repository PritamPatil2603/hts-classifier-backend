// src/services/openaiService.js
// OpenAI service with aggressive latency optimizations

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService');

// ✅ ADD THIS MISSING FUNCTION
function getSystemPrompt() {
  return config.systemPrompt;
}

// ✅ FIXED: Initialize OpenAI client WITHOUT timeout parameter
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2        // Keep retries, remove timeout
});

// File search tool
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 5  // Reduce from 7 to 5 for speed
};

// ✅ ADD THE MISSING OPTIMIZED MONGODB TOOLS
const optimizedMongodbTools = [
  {
    type: "function",
    name: "lookup_by_heading",
    description: "Look up HTS codes by 4-digit heading (e.g., 6403 for footwear)",
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "4-digit HTS heading (e.g., '6403')"
        }
      },
      required: ["heading"]
    }
  },
  {
    type: "function", 
    name: "lookup_by_subheading",
    description: "Look up specific HTS codes by 6-digit subheading",
    parameters: {
      type: "object",
      properties: {
        subheading: {
          type: "string",
          description: "6-digit HTS subheading (e.g., '640359')"
        }
      },
      required: ["subheading"]
    }
  },
  {
    type: "function",
    name: "validate_hts_code", 
    description: "Validate if a 10-digit HTS code exists in the database",
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "10-digit HTS code to validate (e.g., '6403.59.90.00')"
        }
      },
      required: ["hts_code"]
    }
  }
];

// ✅ OPENAI RESPONSE CACHING CLASS
class OpenAIResponseCache {
  constructor() {
    this.responseCache = new Map();
    this.cacheTimeout = 600000; // 10 minutes for OpenAI responses
    this.maxCacheSize = 500;    // Limit cache size
  }

  getCacheKey(input, model) {
    // ✅ INCLUDE PRODUCT DESCRIPTION IN CACHE KEY
    const inputStr = Array.isArray(input) ? 
      input.map(i => {
        if (typeof i === 'object' && i.content) {
          return i.content; // Include the actual content, not just structure
        }
        return typeof i === 'object' ? JSON.stringify(i) : i;
      }).join('|') :
      JSON.stringify(input);
    
    // Create more specific hash
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(inputStr).digest('hex');
    return `${model}:${hash}`;
  }

  async getCached(input, model) {
    const cacheKey = this.getCacheKey(input, model);
    const cached = this.responseCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`🚀 OpenAI Cache HIT (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.response;
    }
    return null;
  }

  setCached(input, model, response) {
    const cacheKey = this.getCacheKey(input, model);
    
    // Prevent memory leaks
    if (this.responseCache.size >= this.maxCacheSize) {
      const oldestKey = this.responseCache.keys().next().value;
      this.responseCache.delete(oldestKey);
    }
    
    this.responseCache.set(cacheKey, {
      response: JSON.parse(JSON.stringify(response)), // Deep clone
      timestamp: Date.now()
    });
    
    console.log(`💾 OpenAI response cached (cache size: ${this.responseCache.size})`);
  }

  getStats() {
    return {
      cacheSize: this.responseCache.size,
      totalEntries: this.responseCache.size
    };
  }
}

const openaiCache = new OpenAIResponseCache();

// ✅ PERFORMANCE MONITORING with OpenAI-specific thresholds
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.openaiSlowThreshold = 8000;   // 8 seconds for OpenAI calls
    this.openaiCriticalThreshold = 15000; // 15 seconds critical
  }

  async trackOpenAI(operation, fn) {
    const start = Date.now();
    const startMemory = process.memoryUsage().heapUsed;
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      const endMemory = process.memoryUsage().heapUsed;
      
      this.recordMetric(operation, {
        duration,
        success: true,
        memoryDelta: endMemory - startMemory,
        timestamp: Date.now()
      });
      
      // ✅ OPENAI-SPECIFIC ALERTING
      if (duration > this.openaiCriticalThreshold) {
        console.error(`🚨 CRITICAL OPENAI LATENCY: ${operation} took ${duration}ms - investigate model/prompt!`);
      } else if (duration > this.openaiSlowThreshold) {
        console.warn(`⚠️ SLOW OPENAI: ${operation} took ${duration}ms - monitor closely`);
      } else {
        console.log(`✅ OpenAI ${operation}: ${duration}ms (good performance)`);
      }
      
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.recordMetric(operation, {
        duration,
        success: false,
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }

  recordMetric(operation, data) {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    
    const metrics = this.metrics.get(operation);
    metrics.push(data);
    
    if (metrics.length > 50) {
      metrics.shift(); // Keep only last 50 entries
    }
  }

  getStats(operation) {
    const metrics = this.metrics.get(operation) || [];
    const recent = metrics.filter(m => Date.now() - m.timestamp < 300000);
    
    if (recent.length === 0) return null;
    
    const successful = recent.filter(m => m.success);
    return {
      totalCalls: recent.length,
      successRate: Math.round((successful.length / recent.length) * 100),
      avgDuration: Math.round(successful.reduce((sum, m) => sum + m.duration, 0) / successful.length),
      slowCalls: recent.filter(m => m.duration > this.openaiSlowThreshold).length,
      criticalCalls: recent.filter(m => m.duration > this.openaiCriticalThreshold).length,
      avgMemoryUsage: Math.round(successful.reduce((sum, m) => sum + (m.memoryDelta || 0), 0) / successful.length / 1024)
    };
  }

  getAllStats() {
    const stats = {};
    for (const operation of this.metrics.keys()) {
      stats[operation] = this.getStats(operation);
    }
    return stats;
  }
}

const performanceMonitor = new PerformanceMonitor();

// ✅ OPTIMIZED REQUEST CONFIGURATION
function getOptimizedRequestConfig(input, previousResponseId = null) {
  const baseConfig = {
    model: config.openai.model,
    input: input,
    tools: [fileSearchTool, ...optimizedMongodbTools],  // ✅ Use optimized tools only
    
    // ✅ LATENCY OPTIMIZATIONS
    temperature: 0.00,          // Very low for faster, deterministic responses
    max_output_tokens: 1500,     // Reduced from 2048 (major latency improvement)
    top_p: 0.85,               // Reduced token selection scope
    parallel_tool_calls: true, // Ensure parallel function calling
    
    store: true
  };

  if (previousResponseId) {
    baseConfig.previous_response_id = previousResponseId;
  }

  return baseConfig;
}

// ✅ AGGRESSIVE RETRY LOGIC with exponential backoff
async function executeWithOptimizedRetry(operation, fn, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      // Check if it's a timeout or rate limit error
      const isRetryable = error.code === 'timeout' || 
                         error.status === 429 || 
                         error.status >= 500;
      
      if (!isRetryable || attempt === maxRetries) {
        console.error(`🚨 Final OpenAI error for ${operation}:`, error.message);
        throw error;
      }
      
      // Shorter backoff for speed
      const delay = Math.min(1000 * Math.pow(1.5, attempt), 3000); // Max 3s delay
      console.log(`⏳ OpenAI retry ${attempt}/${maxRetries} for ${operation} in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// ✅ ENHANCED MONGODB FUNCTION CALL TRACKING
class MongoDBFunctionTracker {
  constructor() {
    this.callHistory = [];
    this.sessionStats = new Map();
  }

  trackCall(functionName, args, sessionId = null) {
    const callRecord = {
      timestamp: new Date().toISOString(),
      functionName,
      arguments: args,
      sessionId,
      callId: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    
    this.callHistory.push(callRecord);
    
    // Session-specific tracking
    if (sessionId) {
      if (!this.sessionStats.has(sessionId)) {
        this.sessionStats.set(sessionId, {
          totalCalls: 0,
          functionBreakdown: {},
          firstCall: Date.now(),
          lastCall: Date.now()
        });
      }
      
      const sessionData = this.sessionStats.get(sessionId);
      sessionData.totalCalls++;
      sessionData.functionBreakdown[functionName] = (sessionData.functionBreakdown[functionName] || 0) + 1;
      sessionData.lastCall = Date.now();
    }

    console.log(`🎯 MONGODB FUNCTION CALLED: ${functionName}`);
    console.log(`📋 Call ID: ${callRecord.callId}`);
    console.log(`📊 Arguments:`, args);
    if (sessionId) {
      console.log(`🔗 Session: ${sessionId}`);
      const sessionData = this.sessionStats.get(sessionId);
      console.log(`📈 Session Stats: ${sessionData.totalCalls} total calls, Functions: ${JSON.stringify(sessionData.functionBreakdown)}`);
    }
    
    return callRecord.callId;
  }

  getRecentCalls(limit = 10) {
    return this.callHistory.slice(-limit);
  }

  getSessionStats(sessionId) {
    return this.sessionStats.get(sessionId) || null;
  }

  getAllSessionStats() {
    return Object.fromEntries(this.sessionStats);
  }
}

const mongoFunctionTracker = new MongoDBFunctionTracker();

// ✅ ENHANCED REQUEST CONFIGURATION FOR MONGODB FUNCTIONS
function getMongoDBRequestConfig(functionName, functionArgs, previousResponseId = null) {
  const baseConfig = {
    model: config.openai.model,
    input: [
      {
        role: "user",
        content: `Execute the following MongoDB function: ${functionName} with arguments ${JSON.stringify(functionArgs)}`
      }
    ],
    tools: [fileSearchTool, ...optimizedMongodbTools],
    temperature: 0.00,
    max_output_tokens: 1500,
    top_p: 0.85,
    store: true
  };

  if (previousResponseId) {
    baseConfig.previous_response_id = previousResponseId;
  }

  return baseConfig;
}

// ✅ ENHANCED MONGODB FUNCTION EXECUTION (from previous version)
async function executeMongoDBFunction(functionName, functionArgs, sessionId = null) {
  
  // ✅ TRACK THE CALL
  const callId = mongoFunctionTracker.trackCall(functionName, functionArgs, sessionId);
  
  console.log(`🔧 EXECUTING MONGODB FUNCTION: ${functionName}`);
  console.log(`📥 Arguments:`, functionArgs);
  console.log(`🆔 Call ID: ${callId}`);
  
  return performanceMonitor.trackOpenAI(`mongodb_${functionName}`, async () => {
    try {
      let result;
      
      switch (functionName) {
        case 'lookup_by_subheading':
          console.log(`📊 LOOKUP BY SUBHEADING: ${functionArgs.subheading}`);
          const subheadingResults = await mongodbService.lookupBySubheading(functionArgs.subheading);
          console.log(`📤 Subheading lookup result: ${subheadingResults.length} codes found`);
          result = {
            success: true,
            data: subheadingResults,
            message: `Found ${subheadingResults.length} codes for subheading: ${functionArgs.subheading}`,
            callId
          };
          break;

        case 'lookup_by_heading':
          console.log(`📊 LOOKUP BY HEADING: ${functionArgs.heading}`);
          const headingResults = await mongodbService.lookupByHeading(functionArgs.heading);
          console.log(`📤 Heading lookup result: ${headingResults.length} codes found`);
          result = {
            success: true,
            data: headingResults,
            message: `Found ${headingResults.length} codes for heading: ${functionArgs.heading}`,
            callId
          };
          break;

        case 'validate_hts_code':
          console.log(`🔍 VALIDATING HTS CODE: ${functionArgs.hts_code}`);
          const validationResult = await mongodbService.validateHtsCode(functionArgs.hts_code);
          console.log(`📤 Validation result: ${validationResult.isValid ? '✅ VALID' : '❌ INVALID'}`);
          if (validationResult.isValid) {
            console.log(`📋 Valid code details: ${validationResult.details?.hts_code} - ${validationResult.details?.description?.substring(0, 100)}...`);
          }
          result = {
            success: true,
            data: validationResult,
            message: validationResult.isValid 
              ? `✅ HTS code ${functionArgs.hts_code} is VALID in database` 
              : `❌ HTS code ${functionArgs.hts_code} is NOT VALID in database`,
            callId
          };
          break;

        default:
          throw new Error(`Unknown MongoDB function: ${functionName}`);
      }
      
      console.log(`✅ MONGODB FUNCTION COMPLETED: ${functionName} (Call: ${callId})`);
      return result;
      
    } catch (error) {
      console.error(`❌ MONGODB FUNCTION ERROR: ${functionName} (Call: ${callId})`, error);
      return {
        success: false,
        message: `Error executing ${functionName}: ${error.message}`,
        error: error.message,
        callId
      };
    }
  });
}

// ✅ SUPER-OPTIMIZED PARALLEL FUNCTION CALLING
async function processFunctionCalls(response, sessionId = null) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS');
  if (sessionId) {
    console.log(`🔗 Session ID: ${sessionId}`);
  }
  
  return performanceMonitor.trackOpenAI('process_function_calls', async () => {
    const fileSearchCalls = response.output.filter(output => 
      output.type === 'function_call' && output.name === 'file_search'
    );
    
    const functionCalls = response.output.filter(output => 
      output.type === 'function_call' && 
      optimizedMongodbTools.some(tool => tool.name === output.name)  // ✅ Use optimized tools
    );
    
    console.log(`📁 File search calls: ${fileSearchCalls.length}`);
    console.log(`📊 MongoDB function calls: ${functionCalls.length}`);
    
    if (fileSearchCalls.length > 0) {
      console.log('🔍 AI performing semantic research on HTS database...');
    }
    
    if (functionCalls.length === 0) {
      return response;
    }
    
    // ✅ SUPER-FAST PARALLEL EXECUTION
    const startTime = Date.now();
    
    const functionPromises = functionCalls.map(async (functionCall) => {
      const functionName = functionCall.name;
      const functionArgs = JSON.parse(functionCall.arguments);
      const callId = functionCall.call_id;
      
      console.log(`🎯 Processing: ${functionName} (${callId}) for session: ${sessionId || 'unknown'}`);
      
      try {
        // ✅ PASS SESSION ID TO TRACKING
        const result = await executeMongoDBFunction(functionName, functionArgs, sessionId);
        return {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result)
        };
      } catch (error) {
        console.error(`❌ Function ${functionName} failed:`, error);
        return {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            success: false,
            error: `Function failed: ${error.message}`
          })
        };
      }
    });

    const input = await Promise.all(functionPromises);
    const parallelDuration = Date.now() - startTime;
    
    console.log(`🚀 Completed ${input.length} functions in ${parallelDuration}ms (parallel)`);
    
    // ✅ OPTIMIZED FOLLOW-UP REQUEST
    const followUpResponse = await executeWithOptimizedRetry('openai_follow_up', async () => {
      const requestConfig = getOptimizedRequestConfig(input, response.id);
      
      return await openai.responses.create(requestConfig);
    });
    
    console.log(`✅ Follow-up response: ${followUpResponse.id}`);
    
    // ✅ CHECK FOR RECURSIVE CALLS (with limit)
    const hasMoreFunctionCalls = followUpResponse.output.some(output => 
      output.type === 'function_call' && 
      optimizedMongodbTools.some(tool => tool.name === output.name)
    );
    
    if (hasMoreFunctionCalls) {
      console.log('🔄 Recursive function calls detected...');
      return await processFunctionCalls(followUpResponse);
    }
    
    return followUpResponse;
  });
}

// ✅ ENHANCED RESPONSE EXTRACTION
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return { type: 'error', message: 'No output found' };
  }

  console.log(`📊 Found ${response.output.length} output items`);

  // ✅ NEW: Check for output_text helper first (fastest path)
  if (response.output_text) {
    console.log('🚀 Using output_text helper');
    try {
      const parsed = JSON.parse(response.output_text);
      if (parsed.responseType) {
        console.log(`✅ Extracted via output_text: ${parsed.responseType}`);
        return parsed;
      }
    } catch (error) {
      console.log('⚠️ output_text JSON parsing failed, trying manual extraction');
    }
  }

  // ✅ ENHANCED: Look for message content with better parsing
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found text response (${content.text.length} chars)`);
        
        // ✅ IMPROVED: Better JSON extraction
        let jsonText = content.text.trim();
        
        // Remove any markdown code blocks
        jsonText = jsonText.replace(/```json\s*|\s*```/g, '');
        
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(jsonText);
          if (parsed.responseType) {
            console.log(`✅ Successfully extracted: ${parsed.responseType}`);
            return parsed;
          }
        } catch (error) {
          console.log(`⚠️ JSON parsing failed: ${error.message}`);
          
          // ✅ FALLBACK: Try to extract JSON from mixed content
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.responseType) {
                console.log(`✅ Extracted via regex: ${parsed.responseType}`);
                return parsed;
              }
            } catch (regexError) {
              console.log(`⚠️ Regex JSON parsing also failed`);
            }
          }
        }
        
        // ✅ FINAL FALLBACK: Return as text response
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

// ✅ SUPER-OPTIMIZED START CLASSIFICATION
async function startClassification(productDescription) {
  return performanceMonitor.trackOpenAI('start_classification', async () => {
    return executeWithOptimizedRetry('start_classification', async () => {
      try {
        console.log('\n🚀 STARTING CLASSIFICATION');
        console.log(`📝 Product: ${productDescription.substring(0, 100)}...`);
        
        // ✅ ALWAYS USE OPTIMIZED PROMPT FROM CONFIG.JS
        const systemPrompt = getSystemPrompt();
        console.log(`📏 System prompt length: ${systemPrompt.length} chars`);

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

        // ✅ USE OPTIMIZED TOOLS
        const requestConfig = {
          model: config.openai.model,
          input: input,
          tools: [fileSearchTool, ...optimizedMongodbTools],  // ✅ Use optimized tools only
          temperature: 0.00,
          max_output_tokens: 2000,
          top_p: 0.85,
          store: true
        };

        // ✅ CHECK CACHE FIRST
        const cachedResponse = await openaiCache.getCached(input, config.openai.model);
        if (cachedResponse) {
          const extractedResponse = extractStructuredResponse(cachedResponse);
          return {
            response_id: cachedResponse.id,
            response: extractedResponse,
            cached: true,
            performance_stats: performanceMonitor.getAllStats()
          };
        }

        // ✅ OPTIMIZED REQUEST
        const response = await openai.responses.create(requestConfig);

        console.log(`✅ Initial response: ${response.id}`);
        
        // ✅ CACHE THE RESPONSE
        openaiCache.setCached(input, config.openai.model, response);
        
        // Process function calls
        const finalResponse = await processFunctionCalls(response);
        const extractedResponse = extractStructuredResponse(finalResponse);
        
        // Cache final response too
        if (finalResponse.id !== response.id) {
          openaiCache.setCached(input, config.openai.model, finalResponse);
        }
        
        return {
          response_id: finalResponse.id,
          response: extractedResponse,
          cached: false,
          performance_stats: performanceMonitor.getAllStats()
        };

      } catch (error) {
        console.error('❌ Start classification error:', error);
        throw error;
      }
    });
  });
}

// ✅ SUPER-OPTIMIZED CONTINUE CLASSIFICATION
async function continueClassification(previousResponseId, userSelection) {
  return performanceMonitor.trackOpenAI('continue_classification', async () => {
    return executeWithOptimizedRetry('continue_classification', async () => {
      try {
        console.log('\n🔄 CONTINUING OPTIMIZED CLASSIFICATION');
        console.log(`🔗 Previous Response ID: ${previousResponseId}`);
        console.log(`💬 User Selection: ${userSelection}`);

        const input = [
          {
            role: "user",
            content: `${userSelection}

Please respond with the same JSON format as before:
- Use "reasoning_question" responseType if you need more information
- Use "classification" responseType if ready to provide final HTS classification`
          }
        ];

        const requestConfig = {
          model: config.openai.model,
          input: input,
          previous_response_id: previousResponseId,
          temperature: 0.00,
          max_output_tokens: 1500,
          store: true
          // ✅ No tools to avoid function call conflicts
        };

        const response = await openai.responses.create(requestConfig);
        console.log(`✅ Continue response: ${response.id}`);
        
        const extractedResponse = extractStructuredResponse(response);
        
        return {
          response_id: response.id,
          response: extractedResponse,
          cached: false,
          performance_stats: performanceMonitor.getAllStats()
        };

      } catch (error) {
        console.error('❌ Continue classification error:', error);
        throw error;
      }
    });
  });
}

// ✅ ENHANCED HEALTH CHECK
async function healthCheck() {
  try {
    const mongoHealth = await mongodbService.healthCheck();
    const openaiTest = await testOpenAIConnection();
    
    return {
      status: mongoHealth.status === 'healthy' && openaiTest.status === 'healthy' ? 'healthy' : 'degraded',
      mongodb: mongoHealth,
      openai: openaiTest,
      cache: openaiCache.getStats(),
      performance: performanceMonitor.getAllStats()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

async function testOpenAIConnection() {
  try {
    const testResponse = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 5,
      timeout: 5000
    });
    
    return {
      status: 'healthy',
      model: config.openai.model,
      testResponseTime: 'OK'
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message
    };
  }
}

// ✅ ADD CACHING OPTIMIZATION FUNCTIONS

// ✅ GENERATE CONSISTENT USER ID FOR CACHING
function generateCacheUserID(sessionId) {
  // Use consistent user ID to improve cache hit rates
  // All classification requests share the same "user" for better caching
  return sessionId ? `hts_session_${sessionId}` : 'hts_classifier_user';
}

// ✅ ENHANCED REQUEST CONFIG WITH CACHING OPTIMIZATION
function getOptimizedRequestConfig(input, previousResponseId = null, sessionId = null) {
  const baseConfig = {
    model: config.openai.model, // gpt-4o for caching
    input: input,
    tools: [fileSearchTool, ...optimizedMongodbTools],
    
    // ✅ CACHING OPTIMIZATIONS
    user: generateCacheUserID(sessionId), // ✅ ADDED: Consistent user ID for cache routing
    temperature: 0.00,          // Deterministic responses
    max_output_tokens: 1500,    // Reduced for speed
    top_p: 0.85,
    parallel_tool_calls: true,
    store: true
  };

  if (previousResponseId) {
    baseConfig.previous_response_id = previousResponseId;
  }

  return baseConfig;
}

// ✅ ENHANCED START CLASSIFICATION WITH CACHING
async function startClassification(productDescription, sessionId = null) {
  return performanceMonitor.trackOpenAI('start_classification', async () => {
    return executeWithOptimizedRetry('start_classification', async () => {
      try {
        console.log('\n🚀 STARTING CLASSIFICATION WITH CACHING');
        console.log(`📝 Product: ${productDescription.substring(0, 100)}...`);
        console.log(`🔗 Session ID: ${sessionId || 'none'}`);
        
        // ✅ CACHING-OPTIMIZED MESSAGE STRUCTURE
        // Static content (system prompt) FIRST for caching
        const systemPrompt = getSystemPrompt();
        console.log(`📏 System prompt length: ${systemPrompt.length} chars (~${Math.ceil(systemPrompt.length/4)} tokens)`);

        const input = [
          {
            role: "system", 
            content: systemPrompt  // ✅ STATIC CONTENT FIRST (will be cached)
          },
          {
            role: "user",
            content: productDescription  // ✅ DYNAMIC CONTENT LAST
          }
        ];

        // ✅ CHECK CACHE FIRST (your existing cache)
        const cachedResponse = await openaiCache.getCached(input, config.openai.model);
        if (cachedResponse) {
          const extractedResponse = extractStructuredResponse(cachedResponse);
          return {
            response_id: cachedResponse.id,
            response: extractedResponse,
            cached: true,
            cache_performance: {
              source: 'local_cache',
              hit_rate: 100
            },
            performance_stats: performanceMonitor.getAllStats()
          };
        }

        // ✅ CACHING-OPTIMIZED REQUEST
        const requestConfig = getOptimizedRequestConfig(input, null, sessionId);
        
        console.log(`👤 Cache User ID: ${requestConfig.user}`);
        console.log(`🔄 Making OpenAI request (caching enabled for ${systemPrompt.length > 1024 ? 'YES' : 'NO'})`);

        // ✅ USE RESPONSES API WITH CACHING
        const response = await openai.responses.create(requestConfig);

        console.log(`✅ Response received: ${response.id}`);
        
        // ✅ LOG OPENAI CACHING PERFORMANCE
        if (response.usage && response.usage.prompt_tokens_details) {
          const cachedTokens = response.usage.prompt_tokens_details.cached_tokens || 0;
          const totalPromptTokens = response.usage.prompt_tokens;
          const cacheHitRate = totalPromptTokens > 0 ? Math.round((cachedTokens / totalPromptTokens) * 100) : 0;
          
          console.log(`🚀 OPENAI CACHE PERFORMANCE:`);
          console.log(`   📊 Total prompt tokens: ${totalPromptTokens}`);
          console.log(`   ⚡ Cached tokens: ${cachedTokens}`);
          console.log(`   📈 Cache hit rate: ${cacheHitRate}%`);
          
          if (cacheHitRate > 70) {
            console.log(`   🎯 EXCELLENT CACHING! ${cacheHitRate}% cache hit rate`);
          } else if (cacheHitRate > 30) {
            console.log(`   ✅ Good caching: ${cacheHitRate}% cache hit rate`);
          } else {
            console.log(`   ⚠️ Low cache hit rate: ${cacheHitRate}% - check prompt structure`);
          }
        }
        
        // ✅ CACHE THE RESPONSE (your existing cache)
        openaiCache.setCached(input, config.openai.model, response);
        
        // ✅ PROCESS FUNCTION CALLS IF NEEDED
        let finalResponse = response;
        if (response.output && response.output.some(output => 
          output.type === 'function_call' && 
          optimizedMongodbTools.some(tool => tool.name === output.name)
        )) {
          console.log(`🔧 Processing function calls...`);
          finalResponse = await processFunctionCalls(response, sessionId);
        }

        // ✅ EXTRACT RESPONSE
        const extractedResponse = extractStructuredResponse(finalResponse);
        
        return {
          response_id: finalResponse.id,
          response: extractedResponse,
          cached: false,
          cache_performance: {
            source: 'openai_cache',
            total_prompt_tokens: response.usage?.prompt_tokens || 0,
            cached_tokens: response.usage?.prompt_tokens_details?.cached_tokens || 0,
            cache_hit_rate: response.usage?.prompt_tokens ? Math.round(((response.usage.prompt_tokens_details?.cached_tokens || 0) / response.usage.prompt_tokens) * 100) : 0
          },
          performance_stats: performanceMonitor.getAllStats()
        };

      } catch (error) {
        console.error('❌ Start classification error:', error);
        throw error;
      }
    });
  });
}

// ✅ ENHANCED CONTINUE CLASSIFICATION WITH CACHING
async function continueClassification(previousResponseId, userSelection, sessionId = null) {
  return performanceMonitor.trackOpenAI('continue_classification', async () => {
    return executeWithOptimizedRetry('continue_classification', async () => {
      try {
        console.log('\n🔄 CONTINUING CLASSIFICATION WITH CACHING');
        console.log(`🔗 Previous Response ID: ${previousResponseId}`);
        console.log(`💬 User Selection: ${userSelection}`);
        console.log(`🔗 Session ID: ${sessionId || 'none'}`);

        // ✅ CACHING-OPTIMIZED INPUT STRUCTURE
        // For continuations, we need to maintain the system prompt for caching
        const systemPrompt = getSystemPrompt();
        
        const input = [
          {
            role: "system",
            content: systemPrompt  // ✅ STATIC CONTENT FIRST (cached)
          },
          {
            role: "user",
            content: `Continue the previous classification conversation.

User Selection: ${userSelection}

Please respond with the same JSON format as before:
- Use "reasoning_question" responseType if you need more information
- Use "classification" responseType if ready to provide final HTS classification`
          }
        ];

        const requestConfig = getOptimizedRequestConfig(input, previousResponseId, sessionId);
        
        console.log(`👤 Cache User ID: ${requestConfig.user}`);

        const response = await openai.responses.create(requestConfig);
        
        console.log(`✅ Continue response: ${response.id}`);
        
        // ✅ LOG CACHING PERFORMANCE FOR CONTINUE
        if (response.usage && response.usage.prompt_tokens_details) {
          const cachedTokens = response.usage.prompt_tokens_details.cached_tokens || 0;
          const totalPromptTokens = response.usage.prompt_tokens;
          const cacheHitRate = totalPromptTokens > 0 ? Math.round((cachedTokens / totalPromptTokens) * 100) : 0;
          
          console.log(`🚀 CONTINUE CACHE PERFORMANCE: ${cacheHitRate}% hit rate (${cachedTokens}/${totalPromptTokens} tokens)`);
        }

        // ✅ PROCESS FUNCTION CALLS IF NEEDED
        let finalResponse = response;
        if (response.output && response.output.some(output => 
          output.type === 'function_call' && 
          optimizedMongodbTools.some(tool => tool.name === output.name)
        )) {
          finalResponse = await processFunctionCalls(response, sessionId);
        }

        const extractedResponse = extractStructuredResponse(finalResponse);
        
        return {
          response_id: finalResponse.id,
          response: extractedResponse,
          cached: false,
          cache_performance: {
            source: 'openai_cache',
            total_prompt_tokens: response.usage?.prompt_tokens || 0,
            cached_tokens: response.usage?.prompt_tokens_details?.cached_tokens || 0,
            cache_hit_rate: response.usage?.prompt_tokens ? Math.round(((response.usage.prompt_tokens_details?.cached_tokens || 0) / response.usage.prompt_tokens) * 100) : 0
          },
          performance_stats: performanceMonitor.getAllStats()
        };

      } catch (error) {
        console.error('❌ Continue classification error:', error);
        throw error;
      }
    });
  });
}

// ✅ ENHANCED FUNCTION CALL PROCESSING WITH CACHING
async function processFunctionCalls(response, sessionId = null) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS WITH CACHING');
  if (sessionId) {
    console.log(`🔗 Session ID: ${sessionId}`);
  }
  
  return performanceMonitor.trackOpenAI('process_function_calls', async () => {
    const fileSearchCalls = response.output.filter(output => 
      output.type === 'function_call' && output.name === 'file_search'
    );
    
    const functionCalls = response.output.filter(output => 
      output.type === 'function_call' && 
      optimizedMongodbTools.some(tool => tool.name === output.name)
    );
    
    console.log(`📁 File search calls: ${fileSearchCalls.length}`);
    console.log(`📊 MongoDB function calls: ${functionCalls.length}`);
    
    if (fileSearchCalls.length > 0) {
      console.log('🔍 AI performing semantic research on HTS database...');
    }
    
    if (functionCalls.length === 0) {
      return response;
    }
    
    // ✅ SUPER-FAST PARALLEL EXECUTION
    const startTime = Date.now();
    
    const functionPromises = functionCalls.map(async (functionCall) => {
      const functionName = functionCall.name;
      const functionArgs = JSON.parse(functionCall.arguments);
      const callId = functionCall.call_id;
      
      console.log(`🎯 Processing: ${functionName} (${callId}) for session: ${sessionId || 'unknown'}`);
      
      try {
        // ✅ PASS SESSION ID TO TRACKING
        const result = await executeMongoDBFunction(functionName, functionArgs, sessionId);
        return {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(result)
        };
      } catch (error) {
        console.error(`❌ Function ${functionName} failed:`, error);
        return {
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            success: false,
            error: `Function failed: ${error.message}`
          })
        };
      }
    });

    const input = await Promise.all(functionPromises);
    const parallelDuration = Date.now() - startTime;
    
    console.log(`🚀 Completed ${input.length} functions in ${parallelDuration}ms (parallel)`);
    
    // ✅ OPTIMIZED FOLLOW-UP REQUEST WITH CACHING
    const followUpResponse = await executeWithOptimizedRetry('openai_follow_up', async () => {
      const requestConfig = getOptimizedRequestConfig(input, response.id, sessionId);
      
      console.log(`🔄 Follow-up request with cache user: ${requestConfig.user}`);
      
      const followUp = await openai.responses.create(requestConfig);
      
      // ✅ LOG FOLLOW-UP CACHING
      if (followUp.usage && followUp.usage.prompt_tokens_details) {
        const cachedTokens = followUp.usage.prompt_tokens_details.cached_tokens || 0;
        const totalPromptTokens = followUp.usage.prompt_tokens;
        const cacheHitRate = totalPromptTokens > 0 ? Math.round((cachedTokens / totalPromptTokens) * 100) : 0;
        
        console.log(`🚀 FOLLOW-UP CACHE: ${cacheHitRate}% hit rate`);
      }
      
      return followUp;
    });
    
    console.log(`✅ Follow-up response: ${followUpResponse.id}`);
    
    // ✅ CHECK FOR RECURSIVE CALLS (with limit)
    const hasMoreFunctionCalls = followUpResponse.output.some(output => 
      output.type === 'function_call' && 
      optimizedMongodbTools.some(tool => tool.name === output.name)
    );
    
    if (hasMoreFunctionCalls) {
      console.log('🔄 Recursive function calls detected...');
      return await processFunctionCalls(followUpResponse, sessionId);
    }
    
    return followUpResponse;
  });
}

// ✅ OPENAI PROMPT CACHING MONITOR CLASS
class OpenAIPromptCacheMonitor {
  constructor() {
    this.cacheStats = {
      totalRequests: 0,
      totalInputTokens: 0,
      totalCachedTokens: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }

  analyzeResponse(response) {
    this.cacheStats.totalRequests++;
    
    if (response.usage) {
      this.cacheStats.totalInputTokens += response.usage.prompt_tokens;
      
      // Check for cached tokens in the response
      const cachedTokens = response.usage.prompt_tokens_details?.cached_tokens || 0;
      this.cacheStats.totalCachedTokens += cachedTokens;
      
      if (cachedTokens > 0) {
        this.cacheStats.cacheHits++;
        console.log(`🎯 OpenAI Prompt Cache HIT: ${cachedTokens}/${response.usage.prompt_tokens} tokens cached (${((cachedTokens / response.usage.prompt_tokens) * 100).toFixed(1)}%)`);
      } else {
        this.cacheStats.cacheMisses++;
        console.log(`❌ OpenAI Prompt Cache MISS: 0 cached tokens`);
      }
      
      return {
        cacheHit: cachedTokens > 0,
        cachedTokens,
        totalTokens: response.usage.prompt_tokens,
        cacheRate: (cachedTokens / response.usage.prompt_tokens) * 100
      };
    }
    
    return null;
  }

  getStats() {
    const overallCacheRate = this.cacheStats.totalInputTokens > 0 
      ? (this.cacheStats.totalCachedTokens / this.cacheStats.totalInputTokens) * 100 
      : 0;
    
    return {
      ...this.cacheStats,
      overallCacheRate: overallCacheRate.toFixed(1)
    };
  }

  logPerformanceReport() {
    const stats = this.getStats();
    console.log(`
📊 OpenAI Prompt Caching Performance Report:
   Total Requests: ${stats.totalRequests}
   Cache Hits: ${stats.cacheHits}
   Cache Misses: ${stats.cacheMisses}
   Overall Cache Rate: ${stats.overallCacheRate}%
   Total Input Tokens: ${stats.totalInputTokens}
   Total Cached Tokens: ${stats.totalCachedTokens}
   Estimated Cost Savings: ~${((stats.totalCachedTokens * 0.5) / stats.totalInputTokens * 100).toFixed(1)}%
    `);
  }
}

// ✅ OPTIMIZED PROMPT STRUCTURE FOR CACHING
function createOptimizedPromptStructure(productDescription, tools = []) {
  // Static system prompt (cacheable - should be >1024 tokens for OpenAI caching)
  const staticSystemPrompt = `You are an expert HTS (Harmonized Tariff Schedule) classification assistant specializing in determining the correct tariff classification codes for imported goods into the United States.

Your primary expertise includes:
- Comprehensive knowledge of the Harmonized Tariff Schedule structure and classification rules
- Understanding of General Rules of Interpretation (GRI) for tariff classification
- Knowledge of specific product categories, materials, manufacturing processes, and intended uses
- Ability to distinguish between similar products that may fall under different HTS codes
- Understanding of tariff classification precedents and customs rulings

Classification Process:
1. Analyze the product description thoroughly, identifying key characteristics
2. Determine the primary function and intended use of the product
3. Identify the material composition and manufacturing process
4. Apply the General Rules of Interpretation systematically
5. Search for the most specific applicable HTS code
6. Validate the classification against similar products and precedents
7. Provide detailed reasoning for the classification decision

Key Classification Factors:
- Product function and intended use (primary consideration)
- Material composition and percentage breakdown
- Manufacturing process and assembly methods
- Physical characteristics (size, weight, design features)
- Industry standards and trade practices
- Packaging and presentation methods
- Value-added features and components

HTS Code Structure:
- 4-digit Heading (broad product category)
- 6-digit Subheading (more specific product group)
- 8-digit Statistical Suffix (US-specific classification)
- 10-digit Complete Code (includes duty rate classification)

Available Tools and Functions:
- Heading lookup: Search HTS codes by 4-digit heading
- Subheading lookup: Search by 6-digit subheading  
- Code validation: Verify complete 10-digit HTS codes
- Statistical lookup: Find statistical reporting information
- File search: Access detailed HTS documentation and precedents

Response Requirements:
- Provide the most accurate 10-digit HTS code
- Include detailed reasoning for the classification
- Explain how General Rules of Interpretation were applied
- Note any alternative codes that were considered
- Highlight any uncertainties or need for additional information
- Suggest verification steps or additional research if needed

Quality Standards:
- Accuracy is paramount - incorrect classifications can result in significant penalties
- Provide thorough documentation of the classification reasoning
- Consider multiple classification possibilities before finalizing
- Flag any potential compliance issues or special requirements
- Recommend consulting with customs brokers for complex cases

Remember: HTS classification affects duty rates, trade statistics, and regulatory compliance. Accuracy and thorough analysis are essential for proper customs clearance and trade compliance.`;

  // Dynamic user content (variable part)
  const userMessage = `Please classify the following product and provide the correct 10-digit HTS code:

Product Description: ${productDescription}

Please provide:
1. The recommended 10-digit HTS code
2. Detailed reasoning for this classification
3. Key factors that influenced the decision
4. Any alternative codes considered
5. Confidence level in the classification`;

  // Structure messages for optimal caching (static content first)
  const messages = [
    { role: "system", content: staticSystemPrompt },
    { role: "user", content: userMessage }
  ];

  return {
    messages,
    tools: tools.length > 0 ? tools : optimizedMongodbTools
  };
}

// Create instances of the new classes
const promptCacheMonitor = new OpenAIPromptCacheMonitor();

// ✅ UPDATE getPerformanceStats to include MongoDB function tracking
function getPerformanceStats() {
  return {
    ...performanceMonitor.getAllStats(),
    cache: openaiCache.getStats(),
    mongodbFunctions: {
      recentCalls: mongoFunctionTracker.getRecentCalls(20),
      sessionStats: mongoFunctionTracker.getAllSessionStats()
    }
  };
}

// ✅ KEEP YOUR EXISTING MODULE EXPORTS - NO CHANGES NEEDED
module.exports = {
  startClassification,
  continueClassification,
  healthCheck,
  getPerformanceStats
};