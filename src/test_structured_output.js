// test_structured_output.js
// Test the structured output approach

const OpenAI = require('openai');

// Mock config
const config = {
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4o-mini"
  }
};

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// Response schema (same as main implementation)
const responseSchema = {
  type: "object",
  properties: {
    responseType: {
      type: "string",
      enum: ["question", "classification"],
      description: "Type of response - either a question for user or final classification"
    },
    question: {
      type: "string",
      description: "The question to ask the user"
    },
    explanation: {
      type: "string", 
      description: "Explanation of why this question is important for classification"
    },
    options: {
      type: "array",
      description: "Multiple choice options for the user",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "Option identifier (A, B, C, etc.)" },
          value: { type: "string", description: "Option description" }
        },
        required: ["key", "value"],
        additionalProperties: false
      }
    },
    htsCode: {
      type: "string",
      description: "The final HTS code (e.g., '6302.60.0020')"
    },
    explanation: {
      type: "string",
      description: "Explanation of the classification reasoning"
    },
    confidence: {
      type: "string",
      description: "Confidence level (e.g., '95% - High')"
    },
    griApplied: {
      type: "string",
      description: "GRI rules applied (e.g., 'GRI 1')"
    }
  },
  required: ["responseType"],
  additionalProperties: false,
  if: {
    properties: { responseType: { const: "question" } }
  },
  then: {
    required: ["question", "explanation", "options"]
  },
  else: {
    if: {
      properties: { responseType: { const: "classification" } }
    },
    then: {
      required: ["htsCode", "explanation", "confidence", "griApplied"]
    }
  }
};

const enhancedSystemPrompt = `You are an expert HTS classification assistant.

CRITICAL: You must ALWAYS respond with structured JSON in one of these formats:

FOR QUESTIONS (when you need more information):
{
  "responseType": "question",
  "question": "What is the state of the mango you wish to import?",
  "explanation": "The classification depends on whether the mango is fresh, dried, or otherwise processed.",
  "options": [
    {"key": "A", "value": "Fresh (whole, unprocessed)"},
    {"key": "B", "value": "Dried (dehydrated, no added sugar)"},
    {"key": "C", "value": "Frozen (not further prepared)"},
    {"key": "D", "value": "Other (please specify processing method)"}
  ]
}

FOR FINAL CLASSIFICATION (when you have enough information):
{
  "responseType": "classification",
  "htsCode": "0804.50.4040",
  "explanation": "Fresh mangoes are classified under HTS code 0804.50.4040",
  "confidence": "95% - High",
  "griApplied": "GRI 1"
}

NEVER return plain text responses. ALWAYS use the structured JSON format above.`;

/**
 * Test structured output with different scenarios
 */
async function testStructuredOutput() {
  console.log('🧪 TESTING STRUCTURED OUTPUT\n');

  const testCases = [
    {
      name: "Ambiguous Product (should ask question)",
      input: "mango",
      expectedType: "question"
    },
    {
      name: "Specific Product (should classify directly)",
      input: "Fresh mango, whole, unprocessed, imported from Mexico",
      expectedType: "classification"
    },
    {
      name: "Cotton T-shirt (should classify directly)",
      input: "Cotton t-shirt, 100% cotton, short sleeve, for men",
      expectedType: "classification"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n📋 TEST: ${testCase.name}`);
    console.log(`📝 Input: ${testCase.input}`);
    
    try {
      const response = await openai.responses.create({
        model: config.openai.model,
        input: [
          {
            role: "system",
            content: enhancedSystemPrompt
          },
          {
            role: "user", 
            content: `Please classify this product: ${testCase.input}`
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "hts_response",
            schema: responseSchema
          }
        },
        temperature: 0.3,
        max_output_tokens: 1024,
        top_p: 1,
        store: true
      });

      console.log(`✅ Response created: ${response.id}`);
      
      // Extract the response
      const messages = response.output.filter(item => item.type === 'message');
      const lastMessage = messages[messages.length - 1];
      
      if (lastMessage && lastMessage.content) {
        const textContent = lastMessage.content.find(c => c.type === 'output_text');
        if (textContent) {
          try {
            const parsed = JSON.parse(textContent.text);
            
            console.log(`📤 Response Type: ${parsed.responseType}`);
            console.log(`🎯 Expected Type: ${testCase.expectedType}`);
            console.log(`✅ Type Match: ${parsed.responseType === testCase.expectedType ? 'YES' : 'NO'}`);
            
            if (parsed.responseType === 'question') {
              console.log(`❓ Question: ${parsed.question}`);
              console.log(`📖 Explanation: ${parsed.explanation}`);
              console.log(`🔢 Options: ${parsed.options?.length || 0}`);
              parsed.options?.forEach((opt, i) => {
                console.log(`   ${opt.key}. ${opt.value}`);
              });
            } else if (parsed.responseType === 'classification') {
              console.log(`🏷️ HTS Code: ${parsed.htsCode}`);
              console.log(`📊 Confidence: ${parsed.confidence}`);
              console.log(`📋 GRI Applied: ${parsed.griApplied}`);
            }
            
            console.log(`\n📋 Full Response:`);
            console.log(JSON.stringify(parsed, null, 2));
            
          } catch (error) {
            console.error(`❌ JSON parsing failed:`, error);
            console.log(`Raw response:`, textContent.text);
          }
        }
      }
      
    } catch (error) {
      console.error(`❌ Test failed:`, error.message);
    }
    
    console.log('\n' + '='.repeat(80));
  }
}

/**
 * Test conversation flow with structured output
 */
async function testConversationFlow() {
  console.log('\n🔄 TESTING CONVERSATION FLOW WITH STRUCTURED OUTPUT\n');
  
  try {
    // First request - should ask a question
    console.log('📋 STEP 1: Initial request');
    const response1 = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "system",
          content: enhancedSystemPrompt
        },
        {
          role: "user", 
          content: "Please classify this product: mango"
        }
      ],
      // FIXED: Use text format instead of response_format
      text: {
        format: {
          type: "json_schema",
          name: "hts_response",
          schema: responseSchema
        }
      },
      temperature: 0.3,
      max_output_tokens: 1024,
      top_p: 1,
      store: true
    });

    const messages1 = response1.output.filter(item => item.type === 'message');
    const parsed1 = JSON.parse(messages1[0].content[0].text);
    
    console.log(`✅ Step 1 Response: ${parsed1.responseType}`);
    if (parsed1.responseType === 'question') {
      console.log(`❓ Question: ${parsed1.question}`);
    }
    
    // Second request - answer the question
    console.log('\n📋 STEP 2: Answer the question');
    const response2 = await openai.responses.create({
      model: config.openai.model,
      input: [
        {
          role: "user",
          content: "A" // Answer with option A
        }
      ],
      previous_response_id: response1.id,
      // FIXED: Use text format instead of response_format
      text: {
        format: {
          type: "json_schema",
          name: "hts_response",
          schema: responseSchema
        }
      },
      temperature: 0.3,
      max_output_tokens: 1024,
      top_p: 1,
      store: true
    });

    const messages2 = response2.output.filter(item => item.type === 'message');
    const parsed2 = JSON.parse(messages2[0].content[0].text);
    
    console.log(`✅ Step 2 Response: ${parsed2.responseType}`);
    if (parsed2.responseType === 'classification') {
      console.log(`🏷️ HTS Code: ${parsed2.htsCode}`);
      console.log(`📊 Confidence: ${parsed2.confidence}`);
    }
    
    console.log('\n🎉 CONVERSATION FLOW TEST COMPLETED');
    console.log(`🔗 Response chain: ${response1.id} → ${response2.id}`);
    
  } catch (error) {
    console.error('❌ Conversation flow test failed:', error);
  }
}

/**
 * Main test function
 */
async function main() {
  if (!config.openai.apiKey) {
    console.error('❌ OPENAI_API_KEY environment variable not set');
    return;
  }

  console.log('🔑 OpenAI API Key found');
  console.log(`🤖 Using model: ${config.openai.model}`);
  
  await testStructuredOutput();
  await testConversationFlow();
  
  console.log('\n🏁 ALL TESTS COMPLETED');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testStructuredOutput, testConversationFlow, main };