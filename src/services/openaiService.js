const OpenAI = require('openai');
const config = require('../config/config');

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

function extractResponse(response) {
  if (response.output_text) {
    return parseTextResponse(response.output_text);
  }

  if (response.output && Array.isArray(response.output)) {
    const messages = response.output.filter(item => item.type === 'message');
    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage?.content) {
      for (const content of lastMessage.content) {
        if (content.type === 'output_text' && content.text) {
          return parseTextResponse(content.text);
        }
      }
    }
  }

  return { responseType: 'error', message: 'No response found' };
}

function parseTextResponse(text) {
  if (!text) {
    return { responseType: 'error', message: 'Empty response' };
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.responseType) {
        return parsed;
      }
    } catch (error) {
      console.error('JSON parsing error:', error);
    }
  }

  return {
    responseType: "text",
    content: text
  };
}

async function startClassification(productDescription) {
  try {
    const response = await openai.responses.create({
      model: config.openai.model,
      input: [
        { role: "system", content: config.systemPrompt },
        { role: "user", content: productDescription }
      ],
      temperature: 0,
      max_output_tokens: 2000,
      store: true
    });
    
    const extractedResponse = extractResponse(response);
    
    return {
      response_id: response.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('Classification error:', error);
    throw error;
  }
}

async function continueClassification(previousResponseId, userSelection) {
  try {
    const response = await openai.responses.create({
      model: config.openai.model,
      input: [{ role: "user", content: userSelection }],
      previous_response_id: previousResponseId,
      temperature: 0,
      max_output_tokens: 2000,
      store: true
    });
    
    const extractedResponse = extractResponse(response);
    
    return {
      response_id: response.id,
      response: extractedResponse
    };

  } catch (error) {
    console.error('Continue classification error:', error);
    throw error;
  }
}

module.exports = {
  startClassification,
  continueClassification
};