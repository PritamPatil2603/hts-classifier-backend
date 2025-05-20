# HTS Classification API

A Node.js backend service that provides automated Harmonized Tariff Schedule (HTS) code classification using OpenAI's Responses API.

## Overview

This backend service assists users in determining the correct 10-digit Harmonized Tariff Schedule (HTS) code for products being imported into the United States. The service leverages OpenAI's Responses API with a structured output format to provide a consistent conversational flow:

1. User submits a product description
2. System analyzes the product and asks targeted questions when needed
3. User selects from provided options
4. System narrows down to the correct classification based on user inputs
5. Final HTS code is provided with confidence level and explanation

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [API Endpoints](#api-endpoints)
- [Request/Response Formats](#requestresponse-formats)
- [Integration with Next.js](#integration-with-nextjs)
- [Error Handling](#error-handling)
- [Testing](#testing)
- [Contributing](#contributing)

## Installation

### Prerequisites

- Node.js 16.x or higher
- npm 8.x or higher

### Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd hts-classifier-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the root directory with the following variables:
   ```
   PORT=3001
   OPENAI_API_KEY=your_openai_api_key_here
   NODE_ENV=development
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## Configuration

The application configuration is stored in `src/config/config.js`. Key configuration options:

- `port`: The port on which the API server will run (default: 3001)
- `openai.apiKey`: Your OpenAI API key (loaded from environment variables)
- `openai.model`: The OpenAI model to use (default: "gpt-4.1")
- `systemPrompt`: The system prompt that guides the OpenAI model in HTS classification

## API Endpoints

### Start a New Classification

- **URL**: `/api/classify`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "productDescription": "string"
  }
  ```
- **Response**: Question with options or final classification result
- **Example Request**:
  ```json
  {
    "productDescription": "Banana"
  }
  ```
- **Example Response** (Question):
  ```json
  {
    "sessionId": "1747765695670",
    "type": "question",
    "question": "What is the state of the banana you wish to import?",
    "explanation": "The classification of bananas depends on whether they are fresh or dried, as each state falls into different HTS headings.",
    "options": [
      {
        "key": "A",
        "value": "Fresh"
      },
      {
        "key": "B",
        "value": "Dried"
      }
    ]
  }
  ```

### Continue Classification

- **URL**: `/api/classify/continue`
- **Method**: `POST`
- **Request Body**:
  ```json
  {
    "sessionId": "string",
    "selection": "string"
  }
  ```
- **Response**: Next question with options or final classification result
- **Example Request**:
  ```json
  {
    "sessionId": "1747765695670",
    "selection": "Fresh"
  }
  ```
- **Example Response** (Final Result):
  ```json
  {
    "sessionId": "1747765695670",
    "type": "result",
    "htsCode": "0803.90.0010",
    "griApplied": "GRI 1",
    "explanation": "Fresh bananas are classified under heading 0803 which covers 'Bananas, including plantains, fresh or dried.' As they are fresh, they fall specifically under subheading 0803.90.0010 which covers fresh bananas.",
    "confidence": "100% (High)"
  }
  ```

### Get Session Status

- **URL**: `/api/classify/session/:sessionId`
- **Method**: `GET`
- **Response**: Session status information
- **Example Response**:
  ```json
  {
    "sessionId": "1747765695670",
    "productDescription": "Banana",
    "hasActiveConversation": true
  }
  ```

## Request/Response Formats

### Response Types

The API returns two main types of responses:

1. **Question Response**:
   ```json
   {
     "sessionId": "string",
     "type": "question",
     "question": "string",
     "explanation": "string",
     "options": [
       {
         "key": "string",
         "value": "string"
       }
     ]
   }
   ```

2. **Result Response**:
   ```json
   {
     "sessionId": "string",
     "type": "result",
     "htsCode": "string",
     "griApplied": "string",
     "explanation": "string",
     "confidence": "string"
   }
   ```

## Integration with Next.js

### API Client

Create an API client in your Next.js application:

```javascript
// api/htsClassifier.js
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_HTS_API_URL || 'http://localhost:3001/api';

export const startClassification = async (productDescription) => {
  try {
    const response = await axios.post(`${API_URL}/classify`, {
      productDescription
    });
    return response.data;
  } catch (error) {
    console.error('Error starting classification:', error);
    throw error;
  }
};

export const continueClassification = async (sessionId, selection) => {
  try {
    const response = await axios.post(`${API_URL}/classify/continue`, {
      sessionId,
      selection
    });
    return response.data;
  } catch (error) {
    console.error('Error continuing classification:', error);
    throw error;
  }
};

export const getSessionStatus = async (sessionId) => {
  try {
    const response = await axios.get(`${API_URL}/classify/session/${sessionId}`);
    return response.data;
  } catch (error) {
    console.error('Error getting session status:', error);
    throw error;
  }
};
```

### Example Component

Here's a simple example of how to use the API in a Next.js component:

```javascript
// components/HTSClassifier.js
import { useState } from 'react';
import { startClassification, continueClassification } from '../api/htsClassifier';

export default function HTSClassifier() {
  const [productDescription, setProductDescription] = useState('');
  const [sessionId, setSessionId] = useState(null);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    try {
      const result = await startClassification(productDescription);
      setSessionId(result.sessionId);
      setCurrent(result);
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSelection = async (selection) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    
    try {
      const result = await continueClassification(sessionId, selection);
      setCurrent(result);
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const renderQuestion = () => (
    <div className="question">
      <h3>{current.question}</h3>
      <p>{current.explanation}</p>
      <div className="options">
        {current.options.map(option => (
          <button 
            key={option.key} 
            onClick={() => handleSelection(option.value)}
            disabled={loading}
          >
            {option.key}: {option.value}
          </button>
        ))}
      </div>
    </div>
  );

  const renderResult = () => (
    <div className="result">
      <h3>Classification Result</h3>
      <div className="result-item">
        <strong>HTS Code:</strong> {current.htsCode}
      </div>
      <div className="result-item">
        <strong>GRI Applied:</strong> {current.griApplied}
      </div>
      <div className="result-item">
        <strong>Explanation:</strong> {current.explanation}
      </div>
      <div className="result-item">
        <strong>Confidence:</strong> {current.confidence}
      </div>
    </div>
  );

  return (
    <div className="hts-classifier">
      <h2>HTS Code Classifier</h2>
      
      {!sessionId ? (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="productDescription">Product Description:</label>
            <textarea
              id="productDescription"
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              rows={4}
              required
            />
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Classifying...' : 'Classify Product'}
          </button>
        </form>
      ) : (
        <>
          {current && current.type === 'question' && renderQuestion()}
          {current && current.type === 'result' && renderResult()}
          
          {error && <div className="error">{error}</div>}
          
          <button 
            onClick={() => {
              setSessionId(null);
              setCurrent(null);
              setProductDescription('');
            }}
            className="reset-button"
          >
            Classify Another Product
          </button>
        </>
      )}
    </div>
  );
}
```

## Error Handling

The API returns standard HTTP status codes:

- **200 OK**: Request was successful
- **400 Bad Request**: Missing or invalid parameters
- **404 Not Found**: Session not found
- **500 Internal Server Error**: Server-side error

Error responses have the following format:

```json
{
  "error": "Error message",
  "message": "Detailed error description (in development mode)"
}
```

## Testing

Run the automated tests:

```bash
npm test
```

You can also test the API manually using tools like Postman or curl:

```bash
# Start a classification
curl -X POST http://localhost:3001/api/classify \
  -H "Content-Type: application/json" \
  -d '{"productDescription": "Banana"}'

# Continue a classification
curl -X POST http://localhost:3001/api/classify/continue \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "1747765695670", "selection": "Fresh"}'
```

## Contributing

If you find any issues or have suggestions for improvements, please open an issue or submit a pull request.

---

