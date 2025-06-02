const OpenAI = require('openai');
const config = require('./config/config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
  maxRetries: 2
});

// ✅ DEBUG: Let's see what OpenAI is actually returning
async function debugResponseExtraction() {
  console.log('\n🔍 DEBUG: Response Extraction Analysis');
  console.log('=' .repeat(60));
  
  const productDescription = "Simple laptop computer";
  
  // Minimal system prompt that FORCES JSON
  const forcedJsonPrompt = `You are an HTS classification expert.

CRITICAL: You MUST respond ONLY in valid JSON format. No other text allowed.

Use this exact format:
{
  "responseType": "reasoning_question",
  "question": {
    "question": "What specific details do you need?",
    "confidence": 85
  }
}

OR

{
  "responseType": "classification",
  "htsCode": "1234.56.78.90",
  "confidence": 90
}

Product to classify: ${productDescription}`;

  const input = [
    {
      role: "system",
      content: forcedJsonPrompt
    },
    {
      role: "user", 
      content: productDescription
    }
  ];

  try {
    console.log('🚀 Testing forced JSON response...');
    const response = await openai.responses.create({
      model: config.openai.model,
      input: input,
      temperature: 0.00,
      max_output_tokens: 500,
      store: true
    });

    console.log(`✅ Response ID: ${response.id}`);
    
    // ✅ TEST OUTPUT_TEXT HELPER
    console.log('\n🔍 TESTING OUTPUT_TEXT HELPER:');
    try {
      const outputText = response.output_text;
      console.log(`📄 output_text: ${outputText}`);
      
      // ✅ TEST THE FIXED EXTRACTION
      console.log('\n🧪 TESTING FIXED EXTRACTION:');
      const extractedResponse = extractStructuredResponse(response);
      console.log('📤 EXTRACTION RESULT:');
      console.log('Type:', extractedResponse.responseType);
      console.log('Content:', JSON.stringify(extractedResponse, null, 2));
      
      if (extractedResponse.responseType) {
        console.log('✅ Extraction working correctly!');
      } else {
        console.log('❌ Extraction still failing');
      }
      
    } catch (error) {
      console.log(`❌ output_text error: ${error.message}`);
    }

    return response;

  } catch (error) {
    console.error('❌ Debug failed:', error);
    throw error;
  }
}

// ✅ DEBUG: Test continue classification properly
async function debugContinueClassification() {
  console.log('\n🔍 DEBUG: Continue Classification');
  console.log('=' .repeat(60));
  
  try {
    // First, get an initial response
    console.log('🚀 Step 1: Getting initial response...');
    const initialResponse = await debugResponseExtraction();
    
    console.log('\n🚀 Step 2: Testing continue classification...');
    
    const continueInput = [
      {
        role: "user",
        content: "I need more details. Please classify this laptop."
      }
    ];

    const continueResponse = await openai.responses.create({
      model: config.openai.model,
      input: continueInput,
      previous_response_id: initialResponse.id,
      temperature: 0.00,
      max_output_tokens: 500,
      store: true
    });

    console.log(`✅ Continue response: ${continueResponse.id}`);
    
    // ✅ TEST EXTRACTION ON CONTINUE RESPONSE
    console.log('\n🧪 TESTING CONTINUE EXTRACTION:');
    const continueExtracted = extractStructuredResponse(continueResponse);
    console.log('📤 CONTINUE EXTRACTION RESULT:');
    console.log('Type:', continueExtracted.responseType);
    console.log('Content:', JSON.stringify(continueExtracted, null, 2));

  } catch (error) {
    console.error('❌ Continue debug failed:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code
    });
  }
}

// ✅ FIXED: Enhanced response extraction that handles ALL cases
function extractStructuredResponse(response) {
  console.log(`\n🔍 EXTRACTING RESPONSE (ID: ${response.id})`);
  
  if (!response.output || !Array.isArray(response.output)) {
    console.log('❌ No output array found');
    return { type: 'error', message: 'No output found' };
  }

  console.log(`📊 Found ${response.output.length} output items`);

  // ✅ NEW: Check for output_text helper first (fastest path)
  if (response.output_text) {
    console.log('🚀 Using output_text helper');
    try {
      const parsed = JSON.parse(response.output_text);
      if (parsed.responseType) {
        console.log(`✅ Extracted via output_text: ${parsed.responseType}`);
        return parsed;
      }
    } catch (error) {
      console.log('⚠️ output_text JSON parsing failed, trying manual extraction');
    }
  }

  // ✅ ENHANCED: Look for message content with better parsing
  const messages = response.output.filter(item => item.type === 'message');
  const lastMessage = messages[messages.length - 1];
  
  if (lastMessage && lastMessage.content) {
    for (const content of lastMessage.content) {
      if (content.type === 'output_text' && content.text) {
        console.log(`📄 Found text response (${content.text.length} chars)`);
        
        // ✅ IMPROVED: Better JSON extraction
        let jsonText = content.text.trim();
        
        // Remove any markdown code blocks
        jsonText = jsonText.replace(/```json\s*|\s*```/g, '');
        
        // Try to parse as JSON
        try {
          const parsed = JSON.parse(jsonText);
          if (parsed.responseType) {
            console.log(`✅ Successfully extracted: ${parsed.responseType}`);
            return parsed;
          }
        } catch (error) {
          console.log(`⚠️ JSON parsing failed: ${error.message}`);
          
          // ✅ FALLBACK: Try to extract JSON from mixed content
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.responseType) {
                console.log(`✅ Extracted via regex: ${parsed.responseType}`);
                return parsed;
              }
            } catch (regexError) {
              console.log(`⚠️ Regex JSON parsing also failed`);
            }
          }
        }
        
        // ✅ FINAL FALLBACK: Return as text response
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

// ✅ RUN DEBUG
async function runDebug() {
  console.log('🚀 Starting Response Extraction Debug...');
  
  try {
    await debugResponseExtraction();
    await debugContinueClassification();
    
    console.log('\n✅ Debug completed successfully!');
  } catch (error) {
    console.error('\n❌ Debug failed:', error.message);
  }
}

if (require.main === module) {
  runDebug()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { debugResponseExtraction, debugContinueClassification, extractStructuredResponse };