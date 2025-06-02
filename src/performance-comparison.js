const { startClassification, continueClassification } = require('./services/openaiService');
const mongodbService = require('./services/mongodbService');

async function performanceComparison() {
  console.log('\n🏁 BEFORE/AFTER PERFORMANCE COMPARISON');
  console.log('=' .repeat(70));
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
  
  const testProducts = [
    "Laptop computer with Intel i7 processor, 16GB RAM, 512GB SSD, Windows 11 Pro",
    "Wireless bluetooth headphones with noise cancellation",
    "Electric guitar with amplifier and accessories"
  ];
  
  try {
    // Connect to MongoDB
    await mongodbService.connect();
    console.log('✅ MongoDB connected');
    
    const results = [];
    
    for (let i = 0; i < testProducts.length; i++) {
      const product = testProducts[i];
      console.log(`\n📦 Testing Product ${i + 1}: ${product.substring(0, 50)}...`);
      
      const startTime = Date.now();
      
      try {
        // Test the startClassification function
        const result = await startClassification(product);
        const duration = Date.now() - startTime;
        
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log(`📊 Response Type: ${result.response?.responseType || 'undefined'}`);
        console.log(`🎯 Success: ${result.response?.responseType ? 'YES' : 'NO'}`);
        
        results.push({
          product: product.substring(0, 30) + '...',
          duration,
          responseType: result.response?.responseType || 'failed',
          success: !!result.response?.responseType,
          responseId: result.response_id
        });
        
        // If we got a response ID, test continue classification
        if (result.response_id && result.response?.responseType === 'reasoning_question') {
          console.log('\n🔄 Testing continue classification...');
          const continueStart = Date.now();
          
          try {
            const continueResult = await continueClassification(
              result.response_id, 
              "Please provide the final HTS classification for this product."
            );
            const continueDuration = Date.now() - continueStart;
            
            console.log(`⏱️  Continue Duration: ${continueDuration}ms`);
            console.log(`📊 Continue Response: ${continueResult.response?.responseType || 'undefined'}`);
            
            results[results.length - 1].continueDuration = continueDuration;
            results[results.length - 1].continueSuccess = !!continueResult.response?.responseType;
            
          } catch (continueError) {
            console.log(`❌ Continue failed: ${continueError.message}`);
            results[results.length - 1].continueSuccess = false;
          }
        }
        
      } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`❌ Failed: ${error.message} (${duration}ms)`);
        
        results.push({
          product: product.substring(0, 30) + '...',
          duration,
          responseType: 'error',
          success: false,
          error: error.message
        });
      }
      
      // Wait between tests to avoid rate limiting
      if (i < testProducts.length - 1) {
        console.log('⏳ Waiting 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // ✅ PERFORMANCE ANALYSIS
    console.log('\n📊 PERFORMANCE RESULTS ANALYSIS');
    console.log('=' .repeat(70));
    
    const successfulTests = results.filter(r => r.success);
    const failedTests = results.filter(r => !r.success);
    
    console.log(`\n📈 OVERALL METRICS:`);
    console.log(`   ✅ Successful tests: ${successfulTests.length}/${results.length}`);
    console.log(`   ❌ Failed tests: ${failedTests.length}/${results.length}`);
    console.log(`   📊 Success rate: ${((successfulTests.length / results.length) * 100).toFixed(1)}%`);
    
    if (successfulTests.length > 0) {
      const avgDuration = Math.round(successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length);
      const minDuration = Math.min(...successfulTests.map(r => r.duration));
      const maxDuration = Math.max(...successfulTests.map(r => r.duration));
      
      console.log(`\n⏱️  TIMING ANALYSIS:`);
      console.log(`   📊 Average duration: ${avgDuration}ms`);
      console.log(`   🚀 Fastest test: ${minDuration}ms`);
      console.log(`   🐌 Slowest test: ${maxDuration}ms`);
      
      // Response type analysis
      const responseTypes = {};
      successfulTests.forEach(r => {
        responseTypes[r.responseType] = (responseTypes[r.responseType] || 0) + 1;
      });
      
      console.log(`\n🎯 RESPONSE TYPE DISTRIBUTION:`);
      Object.entries(responseTypes).forEach(([type, count]) => {
        console.log(`   📄 ${type}: ${count} times (${((count / successfulTests.length) * 100).toFixed(1)}%)`);
      });
      
      // Continue classification analysis
      const continueTests = successfulTests.filter(r => r.continueDuration !== undefined);
      if (continueTests.length > 0) {
        const avgContinue = Math.round(continueTests.reduce((sum, r) => sum + r.continueDuration, 0) / continueTests.length);
        const continueSuccessRate = (continueTests.filter(r => r.continueSuccess).length / continueTests.length) * 100;
        
        console.log(`\n🔄 CONTINUE CLASSIFICATION ANALYSIS:`);
        console.log(`   📊 Continue tests: ${continueTests.length}`);
        console.log(`   ⏱️  Average continue duration: ${avgContinue}ms`);
        console.log(`   ✅ Continue success rate: ${continueSuccessRate.toFixed(1)}%`);
      }
    }
    
    // ✅ INDIVIDUAL TEST RESULTS
    console.log(`\n📋 DETAILED RESULTS:`);
    results.forEach((result, index) => {
      console.log(`\n🔹 Test ${index + 1}: ${result.product}`);
      console.log(`   ⏱️  Duration: ${result.duration}ms`);
      console.log(`   📊 Response: ${result.responseType}`);
      console.log(`   🎯 Success: ${result.success ? 'YES' : 'NO'}`);
      if (result.continueDuration) {
        console.log(`   🔄 Continue: ${result.continueDuration}ms (${result.continueSuccess ? 'SUCCESS' : 'FAILED'})`);
      }
      if (result.error) {
        console.log(`   ❌ Error: ${result.error}`);
      }
    });
    
    // ✅ PERFORMANCE VERDICT
    console.log(`\n🏆 PERFORMANCE VERDICT:`);
    if (successfulTests.length === results.length) {
      console.log(`🎉 PERFECT! All tests successful`);
      const avgTime = Math.round(successfulTests.reduce((sum, r) => sum + r.duration, 0) / successfulTests.length);
      if (avgTime < 3000) {
        console.log(`🚀 EXCELLENT performance: ${avgTime}ms average`);
      } else if (avgTime < 5000) {
        console.log(`✅ GOOD performance: ${avgTime}ms average`);
      } else {
        console.log(`⚠️ ACCEPTABLE performance: ${avgTime}ms average`);
      }
    } else if (successfulTests.length > failedTests.length) {
      console.log(`👍 MOSTLY WORKING: ${successfulTests.length}/${results.length} tests passed`);
      console.log(`🔧 Minor issues to address`);
    } else {
      console.log(`🚨 NEEDS ATTENTION: Only ${successfulTests.length}/${results.length} tests passed`);
      console.log(`🛠️ Major fixes required`);
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Performance test failed:', error);
    throw error;
  }
}

if (require.main === module) {
  console.log('🚀 Starting Performance Comparison...');
  performanceComparison()
    .then(() => {
      console.log('\n✅ Performance comparison completed!');
      console.log(`🕐 Completed at: ${new Date().toLocaleString()}`);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Performance comparison failed:', error.message);
      process.exit(1);
    });
}

module.exports = { performanceComparison };