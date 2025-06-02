const mongodbService = require('./services/mongodbService');

async function realPerformanceTest() {
  console.log('\n🚀 REAL PERFORMANCE TEST (No Cache)');
  console.log('=' .repeat(70));
  
  // ✅ DISABLE CACHE FOR ACCURATE TESTING
  const { startClassification } = require('./services/openaiService');
  
  // Clear any existing cache
  console.log('🧹 Clearing OpenAI cache for accurate testing...');
  
  // ✅ Different products to avoid cache hits
  const testProducts = [
    "Smart television 55 inch LED with 4K resolution and built-in streaming apps",
    "Professional camera lens 85mm f/1.4 for digital photography",
    "Industrial metal cutting machine with laser technology",
    "Organic cotton baby clothing set with safety certifications",
    "Solar panel system for residential roof installation"
  ];
  
  try {
    await mongodbService.connect();
    console.log('✅ MongoDB connected');
    
    const results = {
      baseline: [],
      optimized: []
    };
    
    // Test each product with both baseline and optimized prompts
    for (let i = 0; i < testProducts.length; i++) {
      const product = testProducts[i];
      console.log(`\n📦 Testing Product ${i + 1}: ${product.substring(0, 40)}...`);
      
      // ✅ Test 1: Baseline prompt
      console.log('\n🔍 Testing BASELINE prompt...');
      const baselineStart = Date.now();
      try {
        const baselineResult = await startClassification(product, false); // useOptimizedPrompt = false
        const baselineDuration = Date.now() - baselineStart;
        
        results.baseline.push({
          product: product.substring(0, 30) + '...',
          duration: baselineDuration,
          responseType: baselineResult.response?.responseType || 'failed',
          success: !!baselineResult.response?.responseType,
          htsCode: baselineResult.response?.htsCode || null
        });
        
        console.log(`⏱️  Baseline: ${baselineDuration}ms - ${baselineResult.response?.responseType || 'failed'}`);
        
      } catch (error) {
        results.baseline.push({
          product: product.substring(0, 30) + '...',
          duration: Date.now() - baselineStart,
          responseType: 'error',
          success: false,
          error: error.message
        });
        console.log(`❌ Baseline failed: ${error.message}`);
      }
      
      // Wait to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // ✅ Test 2: Optimized prompt
      console.log('\n🚀 Testing OPTIMIZED prompt...');
      const optimizedStart = Date.now();
      try {
        const optimizedResult = await startClassification(product, true); // useOptimizedPrompt = true
        const optimizedDuration = Date.now() - optimizedStart;
        
        results.optimized.push({
          product: product.substring(0, 30) + '...',
          duration: optimizedDuration,
          responseType: optimizedResult.response?.responseType || 'failed',
          success: !!optimizedResult.response?.responseType,
          htsCode: optimizedResult.response?.htsCode || null
        });
        
        console.log(`⏱️  Optimized: ${optimizedDuration}ms - ${optimizedResult.response?.responseType || 'failed'}`);
        
        // ✅ Test continue classification if we got a reasoning_question
        if (optimizedResult.response?.responseType === 'reasoning_question') {
          console.log('\n🔄 Testing continue classification...');
          const continueStart = Date.now();
          try {
            const continueResult = await continueClassification(
              optimizedResult.response_id,
              "Please provide the final HTS classification based on the product details I've provided."
            );
            const continueDuration = Date.now() - continueStart;
            console.log(`⏱️  Continue: ${continueDuration}ms - ${continueResult.response?.responseType || 'failed'}`);
            
            results.optimized[results.optimized.length - 1].continueDuration = continueDuration;
            results.optimized[results.optimized.length - 1].continueSuccess = !!continueResult.response?.responseType;
            
          } catch (continueError) {
            console.log(`❌ Continue failed: ${continueError.message}`);
            results.optimized[results.optimized.length - 1].continueSuccess = false;
          }
        }
        
      } catch (error) {
        results.optimized.push({
          product: product.substring(0, 30) + '...',
          duration: Date.now() - optimizedStart,
          responseType: 'error',
          success: false,
          error: error.message
        });
        console.log(`❌ Optimized failed: ${error.message}`);
      }
      
      // Wait between products
      if (i < testProducts.length - 1) {
        console.log('⏳ Waiting 5 seconds before next product...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    // ✅ COMPREHENSIVE ANALYSIS
    console.log('\n📊 COMPREHENSIVE PERFORMANCE ANALYSIS');
    console.log('=' .repeat(70));
    
    const baselineSuccessful = results.baseline.filter(r => r.success);
    const optimizedSuccessful = results.optimized.filter(r => r.success);
    
    console.log(`\n📈 SUCCESS RATES:`);
    console.log(`   🔹 Baseline: ${baselineSuccessful.length}/${results.baseline.length} (${((baselineSuccessful.length / results.baseline.length) * 100).toFixed(1)}%)`);
    console.log(`   🚀 Optimized: ${optimizedSuccessful.length}/${results.optimized.length} (${((optimizedSuccessful.length / results.optimized.length) * 100).toFixed(1)}%)`);
    
    if (baselineSuccessful.length > 0 && optimizedSuccessful.length > 0) {
      const baselineAvg = Math.round(baselineSuccessful.reduce((sum, r) => sum + r.duration, 0) / baselineSuccessful.length);
      const optimizedAvg = Math.round(optimizedSuccessful.reduce((sum, r) => sum + r.duration, 0) / optimizedSuccessful.length);
      const improvement = ((baselineAvg - optimizedAvg) / baselineAvg * 100);
      
      console.log(`\n⏱️  TIMING COMPARISON:`);
      console.log(`   🔹 Baseline average: ${baselineAvg}ms`);
      console.log(`   🚀 Optimized average: ${optimizedAvg}ms`);
      console.log(`   📊 Performance improvement: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
      
      if (improvement > 0) {
        console.log(`   ✅ Time saved: ${baselineAvg - optimizedAvg}ms per request`);
      } else {
        console.log(`   ⚠️ Optimized is ${Math.abs(improvement).toFixed(1)}% slower`);
      }
    }
    
    // ✅ CONTINUE CLASSIFICATION RESULTS
    const continueTests = results.optimized.filter(r => r.continueDuration !== undefined);
    if (continueTests.length > 0) {
      console.log(`\n🔄 CONTINUE CLASSIFICATION RESULTS:`);
      console.log(`   📊 Tests performed: ${continueTests.length}`);
      console.log(`   ✅ Successful: ${continueTests.filter(r => r.continueSuccess).length}`);
      const avgContinue = Math.round(continueTests.reduce((sum, r) => sum + r.continueDuration, 0) / continueTests.length);
      console.log(`   ⏱️  Average duration: ${avgContinue}ms`);
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Real performance test failed:', error);
    throw error;
  }
}

if (require.main === module) {
  console.log('🚀 Starting Real Performance Test...');
  realPerformanceTest()
    .then(() => {
      console.log('\n✅ Real performance test completed!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Real performance test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { realPerformanceTest };