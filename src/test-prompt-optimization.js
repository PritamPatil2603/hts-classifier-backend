const OpenAI = require('openai');
const config = require('./config/config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2
});

async function testPromptOptimization() {
  console.log('\n🧪 TESTING PROMPT OPTIMIZATION FOR RESPONSES API');
  console.log('=' .repeat(60));
  
  const productDescription = "Laptop computer with Intel processor, 16GB RAM, 512GB SSD, Windows 11";
  
  // Create a minimal system prompt for comparison
  const minimalSystemPrompt = `You are Alex, an expert HTS customs broker. Classify products using 10-digit HTS codes.

For the given product, provide either:
1. A classification with reasoning if you have enough detail
2. Ask specific questions if you need more information

Always respond in valid JSON format.`;

  // Create a compact but functional prompt
  const compactSystemPrompt = `# HTS Classification Expert: Alex

You are a seasoned customs broker with 15+ years experience. Classify products using 10-digit HTS codes.

## Your Approach:
1. Analyze the product description
2. Determine the most likely HTS chapter/heading
3. Ask clarifying questions if needed OR provide classification if confident

## Response Format:
Respond in JSON with either:
- "reasoning_question" type for questions
- "classification" type for final codes

## Key Rules:
- Always use 10-digit HTS codes
- Show your professional reasoning
- Include confidence level (0-100)
- Validate codes when classifying

Respond professionally as an expert consultant.`;

  const tests = [
    {
      name: "Minimal System Prompt",
      systemPrompt: minimalSystemPrompt,
      expectedTime: "3-5 seconds"
    },
    {
      name: "Compact System Prompt (1KB)",
      systemPrompt: compactSystemPrompt,
      expectedTime: "4-6 seconds"
    },
    {
      name: "Medium System Prompt (4KB)",
      systemPrompt: config.systemPrompt.substring(0, 4000) + "\n\nAlways respond in valid JSON format.",
      expectedTime: "5-8 seconds"
    },
    {
      name: "Large System Prompt (8KB)",
      systemPrompt: config.systemPrompt.substring(0, 8000) + "\n\nAlways respond in valid JSON format.",
      expectedTime: "6-10 seconds"
    },
    {
      name: "Current Full System Prompt (14KB)",
      systemPrompt: config.systemPrompt,
      expectedTime: "8-12 seconds"
    }
  ];

  const results = [];
  let testNumber = 1;

  console.log(`📝 Test Product: ${productDescription}`);
  console.log(`🤖 Model: ${config.openai.model}`);
  console.log(`🧪 Running ${tests.length} tests...\n`);

  for (const test of tests) {
    console.log(`\n🔬 Test ${testNumber}/${tests.length}: ${test.name}`);
    console.log(`📏 Prompt length: ${test.systemPrompt.length.toLocaleString()} characters`);
    console.log(`⏰ Expected time: ${test.expectedTime}`);
    console.log('─'.repeat(50));
    
    const input = [
      {
        role: "system",
        content: test.systemPrompt
      },
      {
        role: "user", 
        content: productDescription
      }
    ];

    const requestConfig = {
      model: config.openai.model,
      input: input,
      temperature: 0.00,
      max_output_tokens: 1500,
      top_p: 0.85,
      store: true
    };

    try {
      console.log('⏱️ Starting API call...');
      const startTime = Date.now();
      
      const response = await openai.responses.create(requestConfig);
      
      const duration = Date.now() - startTime;
      
      console.log(`✅ Response ID: ${response.id}`);
      console.log(`⏱️ Duration: ${duration.toLocaleString()}ms (${(duration/1000).toFixed(1)}s)`);
      console.log(`📊 Output items: ${response.output?.length || 0}`);
      
      // Check if response contains actual content
      const hasContent = response.output && response.output.length > 0;
      const contentLength = hasContent ? JSON.stringify(response.output).length : 0;
      console.log(`📄 Content length: ${contentLength.toLocaleString()} characters`);
      
      results.push({
        name: test.name,
        promptLength: test.systemPrompt.length,
        duration: duration,
        responseId: response.id,
        contentLength: contentLength,
        success: true
      });
      
    } catch (error) {
      console.error(`❌ Error in ${test.name}:`, error.message);
      console.error(`🔍 Error type: ${error.constructor.name}`);
      console.error(`🔍 Error status: ${error.status || 'N/A'}`);
      
      results.push({
        name: test.name,
        promptLength: test.systemPrompt.length,
        duration: null,
        error: error.message,
        success: false
      });
    }
    
    testNumber++;
    
    // Add a small delay between tests to avoid rate limiting
    if (testNumber <= tests.length) {
      console.log('⏳ Waiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Comprehensive Analysis
  console.log('\n📊 COMPREHENSIVE RESULTS ANALYSIS');
  console.log('=' .repeat(60));
  
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  
  if (failedResults.length > 0) {
    console.log(`❌ Failed tests: ${failedResults.length}`);
    failedResults.forEach(result => {
      console.log(`   - ${result.name}: ${result.error}`);
    });
  }
  
  if (successfulResults.length > 0) {
    console.log(`✅ Successful tests: ${successfulResults.length}`);
    console.log('\nPerformance by prompt size:');
    
    successfulResults.forEach(result => {
      const sizeCategory = result.promptLength < 1000 ? 'Small' : 
                          result.promptLength < 5000 ? 'Medium' : 'Large';
      console.log(`🔹 ${result.name}:`);
      console.log(`   📏 Size: ${result.promptLength.toLocaleString()} chars (${sizeCategory})`);
      console.log(`   ⏱️  Time: ${result.duration.toLocaleString()}ms (${(result.duration/1000).toFixed(1)}s)`);
      console.log(`   📄 Output: ${result.contentLength.toLocaleString()} chars`);
    });

    // Performance analysis
    const durations = successfulResults.map(r => r.duration);
    const promptSizes = successfulResults.map(r => r.promptLength);
    
    const fastestTime = Math.min(...durations);
    const slowestTime = Math.max(...durations);
    const averageTime = durations.reduce((a, b) => a + b, 0) / durations.length;
    
    const smallestPrompt = Math.min(...promptSizes);
    const largestPrompt = Math.max(...promptSizes);
    
    console.log('\n🔍 PERFORMANCE INSIGHTS');
    console.log('=' .repeat(60));
    console.log(`⚡ Fastest response: ${fastestTime.toLocaleString()}ms`);
    console.log(`🐌 Slowest response: ${slowestTime.toLocaleString()}ms`);
    console.log(`📊 Average response: ${averageTime.toFixed(0).toLocaleString()}ms`);
    console.log(`📈 Performance range: ${(slowestTime - fastestTime).toLocaleString()}ms`);
    
    console.log(`\n📏 Prompt size range: ${smallestPrompt.toLocaleString()} - ${largestPrompt.toLocaleString()} chars`);
    
    // Calculate correlation
    if (successfulResults.length >= 3) {
      const correlation = calculateCorrelation(promptSizes, durations);
      console.log(`\n🔗 Prompt size vs. Performance correlation: ${(correlation * 100).toFixed(1)}%`);
      
      if (correlation > 0.7) {
        console.log(`🚨 STRONG CORRELATION: Larger prompts significantly slow down responses!`);
        console.log(`💡 RECOMMENDATION: Optimize your system prompt for better performance`);
      } else if (correlation > 0.3) {
        console.log(`⚠️ MODERATE CORRELATION: Prompt size has some impact on performance`);
        console.log(`💡 RECOMMENDATION: Consider prompt optimization for marginal gains`);
      } else {
        console.log(`✅ WEAK CORRELATION: Prompt size has minimal impact on performance`);
        console.log(`💡 RECOMMENDATION: Issue is likely model/API overhead, not prompt size`);
      }
    }
    
    // Recommendations based on results
    console.log('\n💡 OPTIMIZATION RECOMMENDATIONS');
    console.log('=' .repeat(60));
    
    if (averageTime > 10000) {
      console.log(`🚨 HIGH LATENCY DETECTED (${(averageTime/1000).toFixed(1)}s average)`);
      console.log(`   - Consider implementing aggressive caching`);
      console.log(`   - Pre-warm frequently used classifications`);
      console.log(`   - Use background processing for non-urgent requests`);
    } else if (averageTime > 7000) {
      console.log(`⚠️ MODERATE LATENCY (${(averageTime/1000).toFixed(1)}s average)`);
      console.log(`   - Implement smart caching strategies`);
      console.log(`   - Consider prompt optimization`);
    } else {
      console.log(`✅ ACCEPTABLE LATENCY (${(averageTime/1000).toFixed(1)}s average)`);
      console.log(`   - Current performance is reasonable for complex AI tasks`);
    }
    
    if (slowestTime - fastestTime > 5000) {
      console.log(`\n📈 HIGH VARIABILITY in response times detected`);
      console.log(`   - Implement timeout handling`);
      console.log(`   - Consider retry strategies with backoff`);
    }
  }

  return results;
}

// Helper function to calculate correlation coefficient
function calculateCorrelation(x, y) {
  const n = x.length;
  if (n !== y.length || n < 2) return 0;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);
  
  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  
  return denominator === 0 ? 0 : numerator / denominator;
}

// Test runner with enhanced error handling
async function runTest() {
  console.log('🚀 Starting Comprehensive Prompt Optimization Test...');
  console.log(`🕐 Started at: ${new Date().toLocaleString()}`);
  
  try {
    const results = await testPromptOptimization();
    
    console.log('\n✅ Test completed successfully!');
    console.log(`🕐 Completed at: ${new Date().toLocaleString()}`);
    
    // Export results for further analysis
    const summary = {
      timestamp: new Date().toISOString(),
      totalTests: results.length,
      successfulTests: results.filter(r => r.success).length,
      failedTests: results.filter(r => !r.success).length,
      results: results
    };
    
    console.log('\n📋 Test Summary:');
    console.log(`   Total tests: ${summary.totalTests}`);
    console.log(`   Successful: ${summary.successfulTests}`);
    console.log(`   Failed: ${summary.failedTests}`);
    
    return summary;
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  }
}

// Run the test if called directly
if (require.main === module) {
  runTest()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Fatal error:', error.message);
      process.exit(1);
    });
}

module.exports = { 
  testPromptOptimization, 
  runTest,
  calculateCorrelation 
};