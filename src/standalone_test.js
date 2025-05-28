// standalone_test.js
// Standalone test without external dependencies

const OpenAI = require('openai');

// Mock config - replace with your actual values
const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY, // Make sure this env var is set
    model: "gpt-4o-mini" // or whatever model you're using
  },
  systemPrompt: `You are an expert HTS (Harmonized Tariff Schedule) classification assistant. 

Your job is to help classify products into the correct HTS codes by:
1. Analyzing product descriptions
2. Using HTS database tools when needed
3. Asking clarifying questions if needed
4. Providing final classifications with explanations

Use the available tools to lookup and validate HTS codes. Always validate final codes before providing them.`
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// MongoDB function tools
const mongodbTools = [
  {
    type: "function",
    name: "lookup_hts_by_six_digit_base",
    description: "Lookup all HTS codes and statistical suffixes for a given 6-digit base code from the official MongoDB database.",
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
    description: "Validate if a complete HTS code exists in the official MongoDB database.",
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

// Structured output tools
const structuredOutputTools = [
  {
    type: "function",
    name: "generate_classification_question",
    description: "Generate a structured question to help classify an HTS product.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string" },
        explanation: { type: "string" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              value: { type: "string" }
            },
            required: ["key", "value"]
          }
        },
        reasoning: { type: "string" }
      },
      required: ["question", "explanation", "options", "reasoning"]
    }
  },
  {
    type: "function",
    name: "generate_final_classification",
    description: "Generate the final HTS classification for a product.",
    parameters: {
      type: "object",
      properties: {
        htsCode: { type: "string" },
        explanation: { type: "string" },
        confidence: { type: "string" },
        griApplied: { type: "string" },
        reasoning: { type: "string" }
      },
      required: ["htsCode", "explanation", "confidence", "griApplied", "reasoning"]
    }
  }
];

const allTools = [...mongodbTools, ...structuredOutputTools];

// File search tool
const fileSearchTool = {
  type: "file_search",
  vector_store_ids: ["vs_68360919dc948191acabda3d3d33abdf"],
  max_num_results: 10
};

/**
 * Mock MongoDB functions for testing
 * These simulate what OpenAI would call
 */
function setupMockFunctions() {
  console.log('🔧 Setting up mock MongoDB functions...');
  
  // Mock lookup function
  global.lookup_hts_by_six_digit_base = async function(args) {
    console.log(`\n📍 MOCK: lookup_hts_by_six_digit_base called`);
    console.log(`📥 Args:`, args);
    
    // Simulate database lookup
    const mockResults = [
      {
        hts_code: `${args.six_digit_base}.00`,
        description: `Mock description for ${args.six_digit_base}.00`,
        statistical_suffix: "00"
      },
      {
        hts_code: `${args.six_digit_base}.10`, 
        description: `Mock description for ${args.six_digit_base}.10`,
        statistical_suffix: "10"
      }
    ];
    
    console.log(`📤 MOCK: Returning ${mockResults.length} results`);
    return {
      success: true,
      data: mockResults,
      message: `Found ${mockResults.length} codes for ${args.six_digit_base}`
    };
  };

  // Mock validation function
  global.validate_hts_code = async function(args) {
    console.log(`\n✅ MOCK: validate_hts_code called`);
    console.log(`📥 Args:`, args);
    
    const mockResult = {
      isValid: true,
      details: {
        hts_code: args.hts_code,
        description: `Mock validated description for ${args.hts_code}`,
        chapter: args.hts_code.substring(0, 2)
      }
    };
    
    console.log(`📤 MOCK: Code is valid`);
    return {
      success: true,
      data: mockResult,
      message: `HTS code ${args.hts_code} is valid`
    };
  };
  
  console.log('✅ Mock functions setup complete');
}

/**
 * Extract response from OpenAI output
 */
function extractResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return { type: 'error', message: 'No output found' };
  }

  console.log(`📊 Found ${response.output.length} output items`);

  // Log all output items for debugging
  response.output.forEach((item, index) => {
    console.log(`   ${index + 1}. Type: ${item.type}`);
    if (item.type === 'function_call') {
      console.log(`      Function: ${item.name}`);
    } else if (item.type === 'message' && item.content) {
      const textContent = item.content.find(c => c.type === 'output_text');
      if (textContent) {
        console.log(`      Text: ${textContent.text.substring(0, 100)}...`);
      }
    }
  });

  // Look for function calls first
  for (const item of response.output) {
    if (item.type === 'function_call') {
      const args = JSON.parse(item.arguments);
      console.log(`🎯 Found function call: ${item.name}`);
      
      if (item.name === 'generate_classification_question') {
        return {
          responseType: "question",
          question: args.question,
          explanation: args.explanation,
          options: args.options,
          _reasoning: args.reasoning
        };
      }
      
      if (item.name === 'generate_final_classification') {
        return {
          responseType: "classification",
          htsCode: args.htsCode,
          explanation: args.explanation,
          confidence: args.confidence,
          griApplied: args.griApplied,
          _reasoning: args.reasoning
        };
      }
    }
  }

  // Look for text content
  for (const item of response.output) {
    if (item.type === 'message' && item.content) {
      for (const content of item.content) {
        if (content.type === 'output_text' && content.text) {
          console.log(`📄 Found text response`);
          return {
            responseType: "text",
            content: content.text
          };
        }
      }
    }
  }

  console.log('❌ No extractable response found');
  return { type: 'error', message: 'Could not extract response' };
}

/**
 * Test the simplified approach
 */
async function testSimplifiedApproach() {
  console.log('🚀 TESTING SIMPLIFIED OPENAI APPROACH\n');

  try {
    // Setup mock functions
    setupMockFunctions();

    console.log('\n📋 TEST 1: Starting classification');
    const testProduct = "Cotton t-shirt, 100% cotton, short sleeve, for men, made in USA";

    const startResponse = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: config.systemPrompt
        },
        {
          role: "user",
          content: `Please classify this product: ${testProduct}`
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

    console.log(`✅ Start response created: ${startResponse.id}`);
    
    // Check for tool calls
    const toolCalls = startResponse.output?.filter(item => 
      item.type === 'function_call' ||
      item.type === 'file_search_call' ||
      item.type === 'tool_call'
    ) || [];
    
    console.log(`🛠️ Tool calls detected: ${toolCalls.length}`);
    toolCalls.forEach((call, i) => {
      console.log(`   ${i + 1}. ${call.type}: ${call.name || 'file_search'}`);
    });

    const startResult = extractResponse(startResponse);
    console.log('\n📤 START RESULT:');
    console.log(`   Response Type: ${startResult.responseType}`);
    console.log(`   Content:`, JSON.stringify(startResult, null, 2));

    // Test continuation if we got a question
    if (startResult.responseType === 'question') {
      console.log('\n📋 TEST 2: Continuing with user answer');
      
      const continueResponse = await openai.responses.create({
        model: config.openai.model,
        input: [
          {
            role: "user",
            content: "A" // Pick first option
          }
        ],
        previous_response_id: startResponse.id, // This is the key!
        tools: [
          fileSearchTool,
          ...allTools
        ],
        temperature: 0.21,
        max_output_tokens: 2048,
        top_p: 1,
        store: true
      });

      console.log(`✅ Continue response created: ${continueResponse.id}`);
      
      const continueResult = extractResponse(continueResponse);
      console.log('\n📤 CONTINUE RESULT:');
      console.log(`   Response Type: ${continueResult.responseType}`);
      console.log(`   Content:`, JSON.stringify(continueResult, null, 2));
    }

    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    
    if (error.response) {
      console.error('📋 Error Response:', error.response.data);
    }
    
    // Log the full error for debugging
    console.error('📋 Full Error:', error);
  }
}

/**
 * Main function
 */
async function main() {
  // Check if API key is available
  if (!config.openai.apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable not set');
    console.log('💡 Set it with: export OPENAI_API_KEY=your_api_key_here');
    return;
  }

  console.log('🔑 OpenAI API Key found');
  console.log(`🤖 Using model: ${config.openai.model}`);
  
  await testSimplifiedApproach();
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testSimplifiedApproach,
  main
};