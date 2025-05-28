// test_simplified_approach.js
// Test script to validate the simplified OpenAI service

const mongodbService = require('./mongodbService'); // Your existing MongoDB service
const { startClassification, continueClassification, retrieveResponse } = require('./simplified_openai_service');

/**
 * Mock MongoDB service functions for testing
 * Replace these with your actual MongoDB service implementations
 */
const mockMongoDBService = {
  async lookupBySixDigitBase(sixDigitBase) {
    console.log(`🔍 MongoDB Mock: Looking up six digit base: ${sixDigitBase}`);
    // Return mock data
    return [
      {
        hts_code: `${sixDigitBase}.00`,
        description: "Mock HTS code description",
        statistical_suffix: "00"
      },
      {
        hts_code: `${sixDigitBase}.10`,
        description: "Mock HTS code description 2",
        statistical_suffix: "10"
      }
    ];
  },

  async validateHtsCode(htsCode) {
    console.log(`✅ MongoDB Mock: Validating HTS code: ${htsCode}`);
    return {
      isValid: true,
      details: {
        hts_code: htsCode,
        description: "Mock validated HTS code",
        chapter: htsCode.substring(0, 2)
      }
    };
  }
};

/**
 * Override global functions to intercept MongoDB calls
 * This simulates how OpenAI would call your MongoDB functions
 */
global.lookup_hts_by_six_digit_base = async function(args) {
  console.log(`\n🔧 INTERCEPTED: lookup_hts_by_six_digit_base`);
  console.log(`📥 Args:`, args);
  
  const result = await mockMongoDBService.lookupBySixDigitBase(args.six_digit_base);
  
  console.log(`📤 Returning:`, result);
  return {
    success: true,
    data: result,
    message: `Found ${result.length} codes for six_digit_base: ${args.six_digit_base}`
  };
};

global.validate_hts_code = async function(args) {
  console.log(`\n🔧 INTERCEPTED: validate_hts_code`);
  console.log(`📥 Args:`, args);
  
  const result = await mockMongoDBService.validateHtsCode(args.hts_code);
  
  console.log(`📤 Returning:`, result);
  return {
    success: true,
    data: result,
    message: result.isValid 
      ? `HTS code ${args.hts_code} is valid` 
      : `HTS code ${args.hts_code} is NOT valid`
  };
};

/**
 * Test Cases
 */
async function runTests() {
  console.log('🧪 TESTING SIMPLIFIED OPENAI SERVICE\n');

  try {
    // Test 1: Simple classification that might need tool calls
    console.log('📋 TEST 1: Starting classification with a product that needs HTS lookup');
    const testProduct = "Cotton t-shirt, 100% cotton, made in USA, for men";
    
    const startResult = await startClassification(testProduct);
    console.log('\n✅ START RESULT:');
    console.log(`   Response ID: ${startResult.response_id}`);
    console.log(`   Response Type: ${startResult.response?.responseType}`);
    console.log(`   Content:`, JSON.stringify(startResult.response, null, 2));

    // Test 2: Continue the classification
    if (startResult.response?.responseType === 'question') {
      console.log('\n📋 TEST 2: Continuing with user selection');
      const userAnswer = "A"; // Assuming option A exists
      
      const continueResult = await continueClassification(startResult.response_id, userAnswer);
      console.log('\n✅ CONTINUE RESULT:');
      console.log(`   Response ID: ${continueResult.response_id}`);
      console.log(`   Response Type: ${continueResult.response?.responseType}`);
      console.log(`   Content:`, JSON.stringify(continueResult.response, null, 2));

      // Test 3: Continue again if still a question
      if (continueResult.response?.responseType === 'question') {
        console.log('\n📋 TEST 3: Second continuation');
        const userAnswer2 = "B";
        
        const continueResult2 = await continueClassification(continueResult.response_id, userAnswer2);
        console.log('\n✅ SECOND CONTINUE RESULT:');
        console.log(`   Response ID: ${continueResult2.response_id}`);
        console.log(`   Response Type: ${continueResult2.response?.responseType}`);
        console.log(`   Content:`, JSON.stringify(continueResult2.response, null, 2));
      }
    }

    // Test 4: Test response retrieval
    console.log('\n📋 TEST 4: Testing response retrieval');
    const retrievedResponse = await retrieveResponse(startResult.response_id);
    console.log('\n✅ RETRIEVED RESPONSE:');
    console.log(`   Same ID: ${retrievedResponse.response_id === startResult.response_id}`);
    console.log(`   Has context: ${retrievedResponse.raw_response.output?.length > 0}`);

  } catch (error) {
    console.error('❌ TEST ERROR:', error);
    
    // Log more details about the error
    if (error.response) {
      console.error('📋 Error Response:', error.response.data);
    }
    if (error.code) {
      console.error('📋 Error Code:', error.code);
    }
  }
}

/**
 * Test MongoDB function registration
 * This checks if OpenAI can actually call your MongoDB functions
 */
async function testFunctionCalling() {
  console.log('\n🔧 TESTING FUNCTION CALLING MECHANISM\n');
  
  try {
    // Test if the global functions are accessible
    console.log('📋 Testing lookup function...');
    const lookupResult = await global.lookup_hts_by_six_digit_base({ six_digit_base: "010121" });
    console.log('✅ Lookup function works:', lookupResult.success);

    console.log('\n📋 Testing validation function...');
    const validateResult = await global.validate_hts_code({ hts_code: "0101.21.00" });
    console.log('✅ Validation function works:', validateResult.success);

  } catch (error) {
    console.error('❌ Function calling test failed:', error);
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('🚀 STARTING SIMPLIFIED APPROACH TESTS\n');
  
  // First test the function calling mechanism
  await testFunctionCalling();
  
  // Then test the full classification flow
  await runTests();
  
  console.log('\n🏁 TESTS COMPLETED');
}

// Run tests if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  runTests,
  testFunctionCalling,
  main
};