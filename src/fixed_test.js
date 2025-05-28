// fixed_test.js
// Test with only MongoDB functions, use structured output for response formatting

const OpenAI = require('openai');

// Mock config
const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o-mini"
  },
  systemPrompt: `You are an expert HTS (Harmonized Tariff Schedule) classification assistant.

Your job is to help classify products into the correct HTS codes by:
1. Analyzing product descriptions
2. Using HTS database tools when needed to lookup and validate codes
3. Asking clarifying questions if needed
4. Providing final classifications with explanations

IMPORTANT: Use the lookup_hts_by_six_digit_base and validate_hts_code functions to search the HTS database.

For responses, use this format:
- If you need more information, ask a question with multiple choice options
- If you have enough information, provide a final classification

Response format for questions:
{
  "responseType": "question",
  "question": "Your question here",
  "explanation": "Why this question is important",
  "options": [
    {"key": "A", "value": "Option 1"},
    {"key": "B", "value": "Option 2"}
  ]
}

Response format for final classification:
{
  "responseType": "classification", 
  "htsCode": "1234.56.78",
  "explanation": "Detailed explanation",
  "confidence": "95% - High",
  "griApplied": "GRI 1"
}`
};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// ONLY MongoDB function tools (data retrieval functions)
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
 * Setup mock MongoDB functions that RETURN data to OpenAI
 */
function setupMockFunctions() {
  console.log('🔧 Setting up mock MongoDB functions...');
  
  // Mock lookup function - returns data to AI
  global.lookup_hts_by_six_digit_base = async function(args) {
    console.log(`\n📍 MOCK: lookup_hts_by_six_digit_base called`);
    console.log(`📥 Args:`, args);
    
    // Simulate realistic HTS lookup for cotton apparel
    const baseCode = args.six_digit_base;
    let mockResults = [];
    
    if (baseCode.startsWith('61') || baseCode.startsWith('62')) {
      // Cotton apparel codes
      mockResults = [
        {
          hts_code: `${baseCode}.00.00`,
          description: `Men's cotton shirts, not knitted`,
          statistical_suffix: "00"
        },
        {
          hts_code: `${baseCode}.00.10`, 
          description: `Men's cotton shirts, other`,
          statistical_suffix: "10"
        },
        {
          hts_code: `${baseCode}.00.20`,
          description: `Men's cotton t-shirts`,
          statistical_suffix: "20"
        }
      ];
    } else {
      mockResults = [
        {
          hts_code: `${baseCode}.00`,
          description: `Generic description for ${baseCode}`,
          statistical_suffix: "00"
        }
      ];
    }
    
    console.log(`📤 MOCK: Returning ${mockResults.length} results`);
    
    // Return the data that AI can use
    return JSON.stringify({
      success: true,
      data: mockResults,
      message: `Found ${mockResults.length} HTS codes for base ${baseCode}`
    });
  };

  // Mock validation function - returns validation result to AI
  global.validate_hts_code = async function(args) {
    console.log(`\n✅ MOCK: validate_hts_code called`);
    console.log(`📥 Args:`, args);
    
    const htsCode = args.hts_code;
    const isValid = htsCode.match(/^\d{4}\.\d{2}\.\d{2}$/) ? true : false;
    
    const mockResult = {
      isValid: isValid,
      details: isValid ? {
        hts_code: htsCode,
        description: `Validated description for ${htsCode}`,
        chapter: htsCode.substring(0, 2),
        tariff_rate: "Free"
      } : null
    };
    
    console.log(`📤 MOCK: Code is ${isValid ? 'valid' : 'invalid'}`);
    
    // Return validation result to AI
    return JSON.stringify({
      success: true,
      data: mockResult,
      message: isValid ? `HTS code ${htsCode} is valid` : `HTS code ${htsCode} is invalid`
    });
  };
  
  console.log('✅ Mock functions setup complete');
}

/**
 * Extract JSON response from AI text
 */
function extractResponseFromText(text) {
  if (!text) return null;
  
  // Look for JSON in the text
  const jsonMatch = text.match(/\{[\s\S]*\}/);
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
    content: text
  };
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

  // Look for the final message content (after any function calls)
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found final text response`);
        return extractResponseFromText(content.text);
      }
    }
  }

  console.log('❌ No extractable response found');
  return { type: 'error', message: 'Could not extract response' };
}

/**
 * Test the fixed approach
 */
async function testFixedApproach() {
  console.log('🚀 TESTING FIXED APPROACH (MongoDB tools only)\n');

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
          content: `Please classify this product: ${testProduct}

Look up the appropriate HTS codes and provide either:
1. A question if you need more information
2. A final classification with the validated HTS code

Use the lookup and validation tools as needed.`
        }
      ],
      tools: [
        fileSearchTool,
        ...mongodbTools // Only MongoDB tools, no structured output functions
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

    // Test continuation
    console.log('\n📋 TEST 2: Continuing conversation');
    
    let continueMessage = "Please provide the final HTS classification.";
    if (startResult.responseType === 'question') {
      continueMessage = "A"; // Answer the question
    }
    
    const continueResponse = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "user",
          content: continueMessage
        }
      ],
      previous_response_id: startResponse.id, // This should work now!
      tools: [
        fileSearchTool,
        ...mongodbTools
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

    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY');
    console.log(`🔗 Conversation chain: ${startResponse.id} → ${continueResponse.id}`);

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    
    if (error.response) {
      console.error('📋 Error Response:', error.response.data);
    }
    
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
  
  await testFixedApproach();
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testFixedApproach,
  main
};