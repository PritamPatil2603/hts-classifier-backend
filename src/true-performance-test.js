const { startClassification } = require('./services/openaiService');
const mongodbService = require('./services/mongodbService');

async function truePerformanceTest() {
  console.log('\n🎯 TRUE PERFORMANCE TEST (Cache Disabled)');
  console.log('=' .repeat(70));
  
  // ✅ UNIQUE PRODUCTS (no cache hits possible)
  const testProducts = [
    "Bluetooth wireless speaker with LED lights and waterproof rating IP67",
    "Professional DSLR camera with 24-70mm lens kit for photography",
    "CNC metal cutting machine with computer numerical control",
    "Organic cotton children's pajama set with flame retardant treatment",
    "Photovoltaic solar panel 300W monocrystalline for home installation"
  ];
  
  console.log(`🧪 Testing ${testProducts.length} unique products to avoid cache pollution`);
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
  
  try {
    await mongodbService.connect();
    console.log('✅ MongoDB connected');
    
    const results = {
      baseline: [],
      optimized: []
    };
    
    for (let i = 0; i < testProducts.length; i++) {
      const product = testProducts[i];
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📦 PRODUCT ${i + 1}/${testProducts.length}: ${product.substring(0, 50)}...`);
      console.log(`${'='.repeat(80)}`);
      
      // ✅ BASELINE TEST (Long Prompt)
      console.log('\n🔍 BASELINE TEST (Long Prompt):');
      console.log('-'.repeat(50));
      const baselineStart = Date.now();
      
      try {
        const baselineResult = await startClassification(product, false); // useOptimizedPrompt = false
        const baselineDuration = Date.now() - baselineStart;
        
        console.log(`⏱️  Duration: ${baselineDuration}ms`);
        console.log(`📊 Response Type: ${baselineResult.response?.responseType || 'failed'}`);
        console.log(`🎯 Success: ${!!baselineResult.response?.responseType ? 'YES' : 'NO'}`);
        
        if (baselineResult.response?.htsCode) {
          console.log(`🏷️  HTS Code: ${baselineResult.response.htsCode}`);
        }
        if (baselineResult.response?.confidence) {
          console.log(`📊 Confidence: ${baselineResult.response.confidence}%`);
        }
        
        results.baseline.push({
          product: product.substring(0, 40) + '...',
          duration: baselineDuration,
          responseType: baselineResult.response?.responseType || 'failed',
          success: !!baselineResult.response?.responseType,
          htsCode: baselineResult.response?.htsCode || null,
          confidence: baselineResult.response?.confidence || null
        });
        
      } catch (error) {
        const duration = Date.now() - baselineStart;
        console.log(`❌ Baseline failed: ${error.message} (${duration}ms)`);
        
        results.baseline.push({
          product: product.substring(0, 40) + '...',
          duration: duration,
          responseType: 'error',
          success: false,
          error: error.message
        });
      }
      
      // Wait to avoid rate limiting and ensure no cache interference
      console.log('\n⏳ Waiting 8 seconds to avoid rate limiting...');
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // ✅ OPTIMIZED TEST (Short Prompt)  
      console.log('\n🚀 OPTIMIZED TEST (Short Prompt):');
      console.log('-'.repeat(50));
      const optimizedStart = Date.now();
      
      try {
        const optimizedResult = await startClassification(product, true); // useOptimizedPrompt = true
        const optimizedDuration = Date.now() - optimizedStart;
        
        console.log(`⏱️  Duration: ${optimizedDuration}ms`);
        console.log(`📊 Response Type: ${optimizedResult.response?.responseType || 'failed'}`);
        console.log(`🎯 Success: ${!!optimizedResult.response?.responseType ? 'YES' : 'NO'}`);
        
        if (optimizedResult.response?.htsCode) {
          console.log(`🏷️  HTS Code: ${optimizedResult.response.htsCode}`);
        }
        if (optimizedResult.response?.confidence) {
          console.log(`📊 Confidence: ${optimizedResult.response.confidence}%`);
        }
        
        results.optimized.push({
          product: product.substring(0, 40) + '...',
          duration: optimizedDuration,
          responseType: optimizedResult.response?.responseType || 'failed',
          success: !!optimizedResult.response?.responseType,
          htsCode: optimizedResult.response?.htsCode || null,
          confidence: optimizedResult.response?.confidence || null
        });
        
      } catch (error) {
        const duration = Date.now() - optimizedStart;
        console.log(`❌ Optimized failed: ${error.message} (${duration}ms)`);
        
        results.optimized.push({
          product: product.substring(0, 40) + '...',
          duration: duration,
          responseType: 'error',
          success: false,
          error: error.message
        });
      }
      
      // Wait between products (longer wait to ensure clean separation)
      if (i < testProducts.length - 1) {
        console.log('\n⏳ Waiting 10 seconds before next product...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }
    
    // ✅ COMPREHENSIVE ANALYSIS
    console.log('\n' + '='.repeat(80));
    console.log('📊 COMPREHENSIVE PERFORMANCE ANALYSIS');
    console.log('='.repeat(80));
    
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
      console.log(`   📊 Performance change: ${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%`);
      
      if (improvement > 0) {
        console.log(`   ✅ Time saved: ${baselineAvg - optimizedAvg}ms per request`);
        console.log(`   🎯 Optimization SUCCESS!`);
      } else {
        console.log(`   ⚠️ Optimized is ${Math.abs(improvement).toFixed(1)}% slower`);
        console.log(`   🔍 Need to investigate optimization strategy`);
      }
      
      // Response type comparison
      console.log(`\n🎯 RESPONSE TYPE ANALYSIS:`);
      const baselineTypes = {};
      const optimizedTypes = {};
      
      baselineSuccessful.forEach(r => {
        baselineTypes[r.responseType] = (baselineTypes[r.responseType] || 0) + 1;
      });
      
      optimizedSuccessful.forEach(r => {
        optimizedTypes[r.responseType] = (optimizedTypes[r.responseType] || 0) + 1;
      });
      
      console.log(`   🔹 Baseline types:`, baselineTypes);
      console.log(`   🚀 Optimized types:`, optimizedTypes);
      
      // HTS Code accuracy
      const baselineWithCodes = baselineSuccessful.filter(r => r.htsCode);
      const optimizedWithCodes = optimizedSuccessful.filter(r => r.htsCode);
      
      console.log(`\n🏷️  HTS CODE RESULTS:`);
      console.log(`   🔹 Baseline with HTS codes: ${baselineWithCodes.length}/${baselineSuccessful.length}`);
      console.log(`   🚀 Optimized with HTS codes: ${optimizedWithCodes.length}/${optimizedSuccessful.length}`);
    }
    
    // ✅ DETAILED BREAKDOWN
    console.log(`\n📋 DETAILED TEST RESULTS:`);
    console.log('-'.repeat(80));
    
    for (let i = 0; i < Math.max(results.baseline.length, results.optimized.length); i++) {
      const baseline = results.baseline[i];
      const optimized = results.optimized[i];
      
      console.log(`\n🔹 Test ${i + 1}: ${baseline?.product || optimized?.product}`);
      
      if (baseline) {
        console.log(`   🔹 Baseline: ${baseline.duration}ms - ${baseline.responseType} ${baseline.success ? '✅' : '❌'}`);
        if (baseline.htsCode) console.log(`      🏷️  HTS: ${baseline.htsCode}`);
        if (baseline.error) console.log(`      ❌ Error: ${baseline.error}`);
      }
      
      if (optimized) {
        console.log(`   🚀 Optimized: ${optimized.duration}ms - ${optimized.responseType} ${optimized.success ? '✅' : '❌'}`);
        if (optimized.htsCode) console.log(`      🏷️  HTS: ${optimized.htsCode}`);
        if (optimized.error) console.log(`      ❌ Error: ${optimized.error}`);
      }
      
      // Compare performance for this specific test
      if (baseline && optimized && baseline.success && optimized.success) {
        const diff = baseline.duration - optimized.duration;
        const pct = (diff / baseline.duration * 100).toFixed(1);
        console.log(`      📊 Performance: ${diff > 0 ? 'Optimized faster' : 'Baseline faster'} by ${Math.abs(diff)}ms (${Math.abs(pct)}%)`);
      }
    }
    
    // ✅ FINAL VERDICT
    console.log(`\n🏆 FINAL PERFORMANCE VERDICT:`);
    console.log('='.repeat(50));
    
    if (baselineSuccessful.length > 0 && optimizedSuccessful.length > 0) {
      const successRateImproved = (optimizedSuccessful.length / results.optimized.length) >= (baselineSuccessful.length / results.baseline.length);
      const baselineAvg = Math.round(baselineSuccessful.reduce((sum, r) => sum + r.duration, 0) / baselineSuccessful.length);
      const optimizedAvg = Math.round(optimizedSuccessful.reduce((sum, r) => sum + r.duration, 0) / optimizedSuccessful.length);
      const timeImproved = optimizedAvg < baselineAvg;
      
      if (successRateImproved && timeImproved) {
        console.log(`🎉 OPTIMIZATION SUCCESS! Both speed and reliability improved`);
      } else if (timeImproved) {
        console.log(`⚡ SPEED IMPROVEMENT! Faster execution achieved`);
      } else if (successRateImproved) {
        console.log(`🎯 RELIABILITY IMPROVEMENT! Better success rate achieved`);
      } else {
        console.log(`🔍 MIXED RESULTS: Need to evaluate optimization strategy`);
      }
    } else {
      console.log(`🚨 INSUFFICIENT DATA: Need more successful tests for comparison`);
    }
    
    console.log(`\n🕐 Test completed at: ${new Date().toLocaleString()}`);
    return results;
    
  } catch (error) {
    console.error('❌ True performance test failed:', error);
    throw error;
  }
}

if (require.main === module) {
  console.log('🚀 Starting True Performance Test...');
  truePerformanceTest()
    .then(() => {
      console.log('\n✅ True performance test completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ True performance test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { truePerformanceTest };