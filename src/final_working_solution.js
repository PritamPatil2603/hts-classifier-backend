// final_working_solution.js
// Based on debug findings: use call_id and only send outputs, not original function calls

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
 * Mock MongoDB service for testing
 */
const mockMongoDBService = {
  async lookupBySixDigitBase(sixDigitBase) {
    console.log(`📍 MOCK: Looking up six digit base: ${sixDigitBase}`);
    
    // Simulate realistic HTS lookup for cotton apparel
    let mockResults = [];
    
    if (sixDigitBase.startsWith('61') || sixDigitBase.startsWith('62')) {
      // Cotton apparel codes
      mockResults = [
        {
          hts_code: `${sixDigitBase}.10.00`,
          description: `Men's cotton shirts, not knitted`,
          statistical_suffix: "00"
        },
        {
          hts_code: `${sixDigitBase}.10.10`, 
          description: `Men's cotton shirts, other`,
          statistical_suffix: "10"
        },
        {
          hts_code: `${sixDigitBase}.10.20`,
          description: `Men's cotton t-shirts`,
          statistical_suffix: "20"
        }
      ];
    } else {
      mockResults = [
        {
          hts_code: `${sixDigitBase}.00`,
          description: `Generic description for ${sixDigitBase}`,
          statistical_suffix: "00"
        }
      ];
    }
    
    return {
      success: true,
      data: mockResults,
      message: `Found ${mockResults.length} HTS codes for base ${sixDigitBase}`
    };
  },

  async validateHtsCode(htsCode) {
    console.log(`✅ MOCK: Validating HTS code: ${htsCode}`);
    
    const isValid = htsCode.match(/^\d{4}\.\d{2}\.\d{2}$/) ? true : false;
    
    return {
      success: true,
      data: {
        isValid: isValid,
        details: isValid ? {
          hts_code: htsCode,
          description: `Validated description for ${htsCode}`,
          chapter: htsCode.substring(0, 2),
          tariff_rate: "Free"
        } : null
      },
      message: isValid ? `HTS code ${htsCode} is valid` : `HTS code ${htsCode} is invalid`
    };
  }
};

/**
 * Execute a function call
 */
async function executeFunction(functionName, functionArgs) {
  console.log(`\n🔧 EXECUTING: ${functionName}`);
  console.log(`📥 Arguments:`, functionArgs);
  
  try {
    switch (functionName) {
      case 'lookup_hts_by_six_digit_base':
        const lookupResult = await mockMongoDBService.lookupBySixDigitBase(functionArgs.six_digit_base);
        console.log(`📤 Lookup result: ${lookupResult.data.length} codes found`);
        return lookupResult;

      case 'validate_hts_code':
        const validateResult = await mockMongoDBService.validateHtsCode(functionArgs.hts_code);
        console.log(`📤 Validation result: ${validateResult.data.isValid ? 'Valid' : 'Invalid'}`);
        return validateResult;

      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  } catch (error) {
    console.error(`❌ Error in function ${functionName}:`, error);
    return {
      success: false,
      message: `Error executing ${functionName}: ${error.message}`
    };
  }
}

/**
 * Process function calls - CORRECTED based on debug findings
 */
async function processFunctionCalls(response) {
  console.log('\n🔧 PROCESSING FUNCTION CALLS (CORRECTED)');
  
  const functionCalls = response.output.filter(output => output.type === 'function_call');
  
  console.log(`📊 Found ${functionCalls.length} function calls`);
  
  if (functionCalls.length === 0) {
    return response; // No function calls to process
  }
  
  // Build input array with ONLY function outputs (not original calls)
  const input = [];
  
  // Execute each function and add ONLY the results to input
  for (const functionCall of functionCalls) {
    const functionName = functionCall.name;
    const functionArgs = JSON.parse(functionCall.arguments);
    const callId = functionCall.call_id; // ✅ Use call_id, not id
    
    console.log(`🎯 Processing: ${functionName}`);
    console.log(`🔑 Using call_id: ${callId}`); // ✅ This should be call_xxx format
    
    const result = await executeFunction(functionName, functionArgs);
    
    // Add ONLY function result to input array (NOT the original function call)
    input.push({
      type: "function_call_output",
      call_id: callId, // ✅ Use the correct call_id
      output: JSON.stringify(result)
    });
  }
  
  console.log(`📤 Prepared ${input.length} function outputs (no duplicates)`);
  console.log(`🔍 Input structure:`, JSON.stringify(input, null, 2));
  
  // Create next response with ONLY function results
  const followUpResponse = await openai.responses.create({
    model: config.openai.model,
    input: input, // ✅ Only function outputs, no original function calls
    previous_response_id: response.id, // ✅ Maintain conversation context
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
  
  // Check if follow-up response also has function calls (recursive)
  const hasMoreFunctionCalls = followUpResponse.output.some(output => output.type === 'function_call');
  
  if (hasMoreFunctionCalls) {
    console.log('🔄 Follow-up response also has function calls, processing recursively...');
    return await processFunctionCalls(followUpResponse);
  }
  
  return followUpResponse;
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
    } else if (item.type === 'function_call_output') {
      console.log(`      Function Output: ${item.call_id}`);
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
 * Start classification
 */
async function startClassification(productDescription) {
  try {
    console.log('\n🚀 STARTING CLASSIFICATION (FINAL SOLUTION)');
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

Look up the appropriate HTS codes and provide either:
1. A question if you need more information  
2. A final classification with the validated HTS code

Use the lookup and validation tools as needed.`
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
    
    // Process any function calls using the corrected approach
    const finalResponse = await processFunctionCalls(response);

    const extractedResponse = extractResponse(finalResponse);
    
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
 * Continue classification
 */
async function continueClassification(previousResponseId, userSelection) {
  try {
    console.log('\n🔄 CONTINUING CLASSIFICATION (FINAL SOLUTION)');
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
    
    // Process any function calls using the corrected approach
    const finalResponse = await processFunctionCalls(response);

    const extractedResponse = extractResponse(finalResponse);
    
    return {
      response_id: finalResponse.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('❌ Error continuing classification:', error);
    throw error;
  }
}

/**
 * Test the final solution
 */
async function testFinalSolution() {
  console.log('🚀 TESTING FINAL SOLUTION\n');

  try {
    console.log('📋 TEST 1: Starting classification with function calls');
    const testProduct = "Cotton t-shirt, 100% cotton, short sleeve, for men, made in USA";

    const startResult = await startClassification(testProduct);
    console.log('\n📤 START RESULT:');
    console.log(`   Response ID: ${startResult.response_id}`);
    console.log(`   Response Type: ${startResult.response?.responseType}`);
    console.log(`   Content:`, JSON.stringify(startResult.response, null, 2));

    // Test continuation
    console.log('\n📋 TEST 2: Continuing conversation');
    
    let continueMessage = "Please provide the final HTS classification with validation.";
    if (startResult.response?.responseType === 'question') {
      continueMessage = "A"; // Answer the question
    }
    
    const continueResult = await continueClassification(startResult.response_id, continueMessage);
    console.log('\n📤 CONTINUE RESULT:');
    console.log(`   Response ID: ${continueResult.response_id}`);
    console.log(`   Response Type: ${continueResult.response?.responseType}`);
    console.log(`   Content:`, JSON.stringify(continueResult.response, null, 2));

    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY');
    console.log(`🔗 Conversation chain: ${startResult.response_id} → ${continueResult.response_id}`);

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
  if (!config.openai.apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable not set');
    return;
  }

  console.log('🔑 OpenAI API Key found');
  console.log(`🤖 Using model: ${config.openai.model}`);
  
  await testFinalSolution();
}

// Export functions for production use
module.exports = {
  startClassification,
  continueClassification,
  testFinalSolution,
  main
};

// Run test if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}