// test_optimal_system.js
// Test the optimal HTS classification system

const mongodbService = require('./services/mongodbService');
const { startClassification, continueClassification } = require('./services/openaiService');

/**
 * Test MongoDB functions with real data structure
 */
async function testMongoDBFunctions() {
  console.log('🧪 TESTING MONGODB FUNCTIONS WITH REAL DATA\n');
  
  try {
    // Test the cotton t-shirt example that should work with your data
    const testResult = await mongodbService.testWithCottonTShirt();
    
    if (testResult && testResult.headingResults > 0) {
      console.log('✅ MongoDB functions are working with your data structure');
      return true;
    } else {
      console.log('❌ MongoDB functions need adjustment for your data structure');
      return false;
    }
    
  } catch (error) {
    console.error('❌ MongoDB test failed:', error);
    return false;
  }
}

/**
 * Test the complete system with realistic examples
 */
async function testCompleteSystem() {
  console.log('\n🧪 TESTING COMPLETE OPTIMAL SYSTEM\n');
  
  const testCases = [
    {
      name: "Cotton T-shirt (your UI example)",
      description: "100% cotton t-shirt, short sleeve, for men, made in USA",
      expectedHeading: "6109",
      expectedSubheading: "610910"
    },
    {
      name: "Fresh Mango (your UI example)", 
      description: "Fresh mango fruit, whole, unprocessed",
      expectedHeading: "0804",
      expectedSubheading: "080450"
    },
    {
      name: "Complex Product",
      description: "Wireless bluetooth headphones with noise cancellation, for consumer use",
      expectedHeading: "8518", // Likely heading for audio equipment
      expectedSubheading: null // Will depend on database
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`\n📋 TESTING: ${testCase.name}`);
    console.log(`📝 Description: ${testCase.description}`);
    
    try {
      const startTime = Date.now();
      const result = await startClassification(testCase.description);
      const endTime = Date.now();
      
      console.log(`⏱️ Response Time: ${endTime - startTime}ms`);
      console.log(`📤 Response ID: ${result.response_id}`);
      console.log(`📊 Response Type: ${result.response?.responseType}`);
      
      if (result.response?.responseType === 'classification') {
        console.log(`✅ CLASSIFICATION RESULT:`);
        console.log(`   HTS Code: ${result.response.htsCode}`);
        console.log(`   Confidence: ${result.response.confidence}`);
        console.log(`   Explanation: ${result.response.explanation}`);
        
        // Validate the result matches expectations
        const htsCode = result.response.htsCode;
        const heading = htsCode.substring(0, 4);
        
        if (testCase.expectedHeading && heading === testCase.expectedHeading) {
          console.log(`✅ Correct heading identified: ${heading}`);
        } else if (testCase.expectedHeading) {
          console.log(`⚠️ Different heading: expected ${testCase.expectedHeading}, got ${heading}`);
        }
        
      } else if (result.response?.responseType === 'question') {
        console.log(`❓ FOLLOW-UP QUESTION:`);
        console.log(`   Question: ${result.response.question}`);
        console.log(`   Options: ${result.response.options?.length || 0}`);
        
        // Test continuation with first option
        if (result.response.options && result.response.options.length > 0) {
          console.log(`\n🔄 Testing continuation with option A...`);
          
          const continueResult = await continueClassification(result.response_id, "A");
          console.log(`📤 Continue Response Type: ${continueResult.response?.responseType}`);
          
          if (continueResult.response?.responseType === 'classification') {
            console.log(`✅ FINAL CLASSIFICATION:`);
            console.log(`   HTS Code: ${continueResult.response.htsCode}`);
            console.log(`   Confidence: ${continueResult.response.confidence}`);
          }
        }
        
      } else {
        console.log(`📄 TEXT RESPONSE: ${result.response?.content?.substring(0, 200)}...`);
      }
      
    } catch (error) {
      console.error(`❌ Test failed for ${testCase.name}:`, error.message);
    }
    
    console.log(`\n${'='.repeat(60)}`);
  }
}

/**
 * Performance and accuracy analysis
 */
async function analyzeSystemPerformance() {
  console.log('\n📊 SYSTEM PERFORMANCE ANALYSIS\n');
  
  const simpleTests = [
    "Cotton t-shirt",
    "Fresh mango", 
    "iPhone charger",
    "Leather shoes",
    "Coffee beans"
  ];
  
  let totalTime = 0;
  let successCount = 0;
  let questionCount = 0;
  let classificationCount = 0;
  
  for (const description of simpleTests) {
    try {
      const startTime = Date.now();
      const result = await startClassification(description);
      const endTime = Date.now();
      
      const responseTime = endTime - startTime;
      totalTime += responseTime;
      
      if (result.response) {
        successCount++;
        
        if (result.response.responseType === 'question') {
          questionCount++;
        } else if (result.response.responseType === 'classification') {
          classificationCount++;
        }
      }
      
      console.log(`✅ "${description}": ${responseTime}ms - ${result.response?.responseType}`);
      
    } catch (error) {
      console.log(`❌ "${description}": Failed - ${error.message}`);
    }
  }
  
  console.log('\n📈 PERFORMANCE SUMMARY:');
  console.log(`   Tests Run: ${simpleTests.length}`);
  console.log(`   Successful: ${successCount}/${simpleTests.length} (${Math.round(successCount/simpleTests.length*100)}%)`);
  console.log(`   Direct Classifications: ${classificationCount}`);
  console.log(`   Follow-up Questions: ${questionCount}`);
  console.log(`   Average Response Time: ${Math.round(totalTime/simpleTests.length)}ms`);
  
  // Recommendations
  console.log('\n💡 RECOMMENDATIONS:');
  if (successCount === simpleTests.length) {
    console.log('✅ System is working optimally');
  } else {
    console.log('⚠️ System needs tuning - check failed cases');
  }
  
  if (totalTime/simpleTests.length > 10000) {
    console.log('⚠️ Response times are slow - consider optimization');
  } else {
    console.log('✅ Response times are acceptable');
  }
  
  const questionRate = questionCount / successCount;
  if (questionRate > 0.7) {
    console.log('⚠️ High question rate - consider improving initial classification accuracy');
  } else {
    console.log('✅ Good balance between direct classification and clarifying questions');
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('🚀 COMPREHENSIVE OPTIMAL SYSTEM TESTING\n');
  console.log('This will test the complete optimal HTS classification system');
  console.log('including MongoDB functions, OpenAI integration, and performance.\n');
  
  try {
    // Phase 1: MongoDB Functions
    console.log('📋 PHASE 1: MongoDB Function Testing');
    const mongoWorking = await testMongoDBFunctions();
    
    if (!mongoWorking) {
      console.log('\n❌ MongoDB functions are not working properly.');
      console.log('💡 Please check your database connection and data structure.');
      console.log('💡 Run the MongoDB debug script first to understand your data structure.');
      return;
    }
    
    // Phase 2: Complete System Testing
    console.log('\n📋 PHASE 2: Complete System Testing');
    await testCompleteSystem();
    
    // Phase 3: Performance Analysis
    console.log('\n📋 PHASE 3: Performance Analysis');
    await analyzeSystemPerformance();
    
    console.log('\n🎉 ALL TESTS COMPLETED');
    console.log('\nIf all tests passed, your optimal HTS classification system is ready for production!');
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
  } finally {
    await mongodbService.close();
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testMongoDBFunctions,
  testCompleteSystem,
  analyzeSystemPerformance,
  runAllTests
};