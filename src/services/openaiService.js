// src/services/openaiService.js
// OpenAI service with aggressive latency optimizations

const OpenAI = require('openai');
const config = require('../config/config');
const mongodbService = require('./mongodbService');

// ✅ FIXED: Initialize OpenAI client WITHOUT timeout parameter
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2        // Keep retries, remove timeout
});

// ✅ ENHANCED MONGODB FUNCTION TOOLS - Optimized for speed
const mongodbTools = [
  {
    type: "function",
    name: "lookup_by_heading",
    description: "Get all subheadings and codes under a 4-digit heading. Use for category exploration when confidence is 70-84%.",
    parameters: {
      type: "object",
      properties: {
        heading: {
          type: "string",
          description: "4-digit heading code (e.g., '8504' for electrical transformers)",
          pattern: "^[0-9]{4}$"
        }
      },
      required: ["heading"]
    }
  },
  {
    type: "function",
    name: "lookup_by_subheading",
    description: "Get complete 10-digit HTS codes under a 6-digit subheading. Use when confident (85%+) about specific subheading.",
    parameters: {
      type: "object",
      properties: {
        subheading: {
          type: "string",
          description: "6-digit subheading code (e.g., '850440' for static converters)",
          pattern: "^[0-9]{6}$"
        }
      },
      required: ["subheading"]
    }
  },
  {
    type: "function",
    name: "validate_hts_code",
    description: "MANDATORY: Validate final HTS codes before presenting to user. Always use before giving final answer.",
    parameters: {
      type: "object",
      properties: {
        hts_code: {
          type: "string",
          description: "Complete 10-digit HTS code (e.g., '8504.40.95.10')",
          pattern: "^[0-9]{4}\\.?[0-9]{2}\\.?[0-9]{2}\\.?[0-9]{2}$"
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
  max_num_results: 5  // Reduce from 7 to 5 for speed
};

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
    tools: [fileSearchTool, ...mongodbTools],
    
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

// ✅ ENHANCED MONGODB FUNCTION EXECUTION (from previous version)
async function executeMongoDBFunction(functionName, functionArgs) {
  console.log(`🔧 EXECUTING: ${functionName}`);
  console.log(`📥 Arguments:`, functionArgs);
  
  return performanceMonitor.trackOpenAI(`mongodb_${functionName}`, async () => {
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

// ✅ SUPER-OPTIMIZED PARALLEL FUNCTION CALLING
async function processFunctionCalls(response) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS');
  
  return performanceMonitor.trackOpenAI('process_function_calls', async () => {
    const fileSearchCalls = response.output.filter(output => 
      output.type === 'function_call' && output.name === 'file_search'
    );
    
    const functionCalls = response.output.filter(output => 
      output.type === 'function_call' && 
      mongodbTools.some(tool => tool.name === output.name)
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
      
      console.log(`🎯 Processing: ${functionName} (${callId})`);
      
      try {
        const result = await executeMongoDBFunction(functionName, functionArgs);
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
      mongodbTools.some(tool => tool.name === output.name)
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
async function startClassification(productDescription, useOptimizedPrompt = true) {
  return performanceMonitor.trackOpenAI('start_classification', async () => {
    return executeWithOptimizedRetry('start_classification', async () => {
      try {
        console.log('\n🚀 STARTING OPTIMIZED CLASSIFICATION');
        console.log(`📝 Product: ${productDescription.substring(0, 100)}...`);
        console.log(`🎯 Using optimized prompt: ${useOptimizedPrompt ? 'YES' : 'NO'}`);
        
        // ✅ CHOOSE PROMPT BASED ON PARAMETER
        const systemPrompt = useOptimizedPrompt ? getOptimizedSystemPrompt() : getSystemPrompt();
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

        // ✅ CHOOSE TOOLS BASED ON PROMPT TYPE
        const tools = useOptimizedPrompt ? optimizedMongodbTools : mongodbTools;

        const requestConfig = {
          model: config.openai.model,
          input: input,
          tools: tools,
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
      model: "gpt-4o-mini",
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

function getPerformanceStats() {
  return {
    ...performanceMonitor.getAllStats(),
    cache: openaiCache.getStats()
  };
}

// ✅ MISSING PROMPT FUNCTIONS - Add these before module.exports
const optimizedMongodbTools = [
  {
    type: "function",
    name: "lookup_by_heading",
    description: "Get all subheadings and codes under a 4-digit heading. Use for category exploration when confidence is 70-84%.",
    strict: true,
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
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "lookup_by_subheading",
    description: "Get complete 10-digit HTS codes under a 6-digit subheading. Use when confident (85%+) about specific subheading.",
    strict: true,
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
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "validate_hts_code",
    description: "MANDATORY: Validate final HTS codes before presenting to user. Always use before giving final answer.",
    strict: true,
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
      additionalProperties: false
    }
  }
];

// ✅ ORIGINAL SYSTEM PROMPT (Baseline)
function getSystemPrompt() {
  return `You are an HTS classification expert. You MUST respond in valid JSON format only.

CRITICAL: Always respond with valid JSON using this exact structure:

For gathering more information:
{
  "responseType": "reasoning_question",
  "question": {
    "question": "What specific details would help with classification?",
    "confidence": 75
  }
}

For providing classification:
{
  "responseType": "classification", 
  "htsCode": "1234.56.78.90",
  "confidence": 90,
  "reasoning": "Brief explanation"
}

## Tools Available:
- lookup_by_heading: Research 4-digit headings (70-84% confidence)
- lookup_by_subheading: Get 10-digit codes (85%+ confidence)
- validate_hts_code: Verify final codes

## Key Categories:
- Chapter 84: Machinery and mechanical appliances
- Chapter 85: Electrical machinery and equipment
- Chapter 90: Optical, photographic instruments

Product to classify:`;
}

// ✅ OPTIMIZED SYSTEM PROMPT (Short & Fast)
function getOptimizedSystemPrompt() {
  const config = require('../config/config');
  return config.systemPrompt; // ✅ Use the big prompt from config.js
}

module.exports = {
  startClassification,
  continueClassification,
  healthCheck,
  getPerformanceStats
};