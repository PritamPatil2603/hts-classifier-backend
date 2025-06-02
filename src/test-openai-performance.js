const OpenAI = require('openai');
const config = require('./config/config');

// Initialize OpenAI client (same as your service)
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2
});

async function testBasicOpenAIResponse() {
  console.log('\n🧪 TESTING BASIC OPENAI RESPONSE API');
  console.log('=' .repeat(50));
  
  const productDescription = "Laptop computer with Intel processor, 16GB RAM, 512GB SSD, Windows 11";
  
  const input = [
    {
      role: "system",
      content: config.systemPrompt
    },
    {
      role: "user", 
      content: productDescription
    }
  ];

  console.log(`📝 Product: ${productDescription}`);
  console.log(`🤖 Model: ${config.openai.model}`);
  console.log(`📏 System prompt length: ${config.systemPrompt.length} chars`);
  
  const startTime = Date.now();
  
  try {
    // Test 1: Minimal configuration (no tools, no optimizations)
    console.log('\n🔬 TEST 1: Minimal Configuration');
    const minimalConfig = {
      model: config.openai.model,
      input: input,
      store: true
    };
    
    console.log('⏱️ Starting minimal API call...');
    const minimalStart = Date.now();
    const minimalResponse = await openai.responses.create(minimalConfig);
    const minimalDuration = Date.now() - minimalStart;
    
    console.log(`✅ Minimal response: ${minimalResponse.id}`);
    console.log(`⏱️ Minimal duration: ${minimalDuration}ms`);
    console.log(`📊 Output items: ${minimalResponse.output?.length || 0}`);
    
    // Test 2: With your optimizations (but no tools)
    console.log('\n🔬 TEST 2: With Optimizations (No Tools)');
    const optimizedConfig = {
      model: config.openai.model,
      input: input,
      temperature: 0.00,
      max_output_tokens: 1500,
      top_p: 0.85,
      parallel_tool_calls: true,
      store: true
    };
    
    console.log('⏱️ Starting optimized API call...');
    const optimizedStart = Date.now();
    const optimizedResponse = await openai.responses.create(optimizedConfig);
    const optimizedDuration = Date.now() - optimizedStart;
    
    console.log(`✅ Optimized response: ${optimizedResponse.id}`);
    console.log(`⏱️ Optimized duration: ${optimizedDuration}ms`);
    console.log(`📊 Output items: ${optimizedResponse.output?.length || 0}`);
    
    // Test 3: Chat completion for comparison
    console.log('\n🔬 TEST 3: Chat Completion (Baseline)');
    const chatConfig = {
      model: config.openai.model,
      messages: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: productDescription }
      ],
      temperature: 0.00,
      max_tokens: 1500,
      top_p: 0.85
    };
    
    console.log('⏱️ Starting chat completion...');
    const chatStart = Date.now();
    const chatResponse = await openai.chat.completions.create(chatConfig);
    const chatDuration = Date.now() - chatStart;
    
    console.log(`✅ Chat completion: ${chatResponse.id}`);
    console.log(`⏱️ Chat duration: ${chatDuration}ms`);
    console.log(`📊 Response length: ${chatResponse.choices[0]?.message?.content?.length || 0} chars`);
    
    // Summary
    const totalDuration = Date.now() - startTime;
    console.log('\n📊 PERFORMANCE SUMMARY');
    console.log('=' .repeat(50));
    console.log(`🔹 Minimal Responses API: ${minimalDuration}ms`);
    console.log(`🔹 Optimized Responses API: ${optimizedDuration}ms`);
    console.log(`🔹 Chat Completions API: ${chatDuration}ms`);
    console.log(`🔹 Total test time: ${totalDuration}ms`);
    
    // Analysis
    console.log('\n🔍 ANALYSIS');
    console.log('=' .repeat(50));
    if (minimalDuration > 8000) {
      console.log(`🚨 SLOW: Minimal Responses API took ${minimalDuration}ms - this suggests model/prompt issues`);
    }
    if (optimizedDuration > minimalDuration + 1000) {
      console.log(`⚠️ WARNING: Optimizations added ${optimizedDuration - minimalDuration}ms overhead`);
    }
    if (chatDuration < minimalDuration) {
      console.log(`💡 INSIGHT: Chat API is ${minimalDuration - chatDuration}ms faster than Responses API`);
    }
    
    return {
      minimal: { duration: minimalDuration, responseId: minimalResponse.id },
      optimized: { duration: optimizedDuration, responseId: optimizedResponse.id },
      chat: { duration: chatDuration, responseId: chatResponse.id }
    };
    
  } catch (error) {
    const errorDuration = Date.now() - startTime;
    console.error(`❌ Error after ${errorDuration}ms:`, error.message);
    console.error(`🔍 Error type: ${error.constructor.name}`);
    console.error(`🔍 Error code: ${error.code || 'N/A'}`);
    console.error(`🔍 Error status: ${error.status || 'N/A'}`);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  console.log('🚀 Starting OpenAI Performance Test...');
  testBasicOpenAIResponse()
    .then(results => {
      console.log('\n✅ Test completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testBasicOpenAIResponse };