const { MongoClient } = require('mongodb');
const config = require('../config/config');

class MongoDBService {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.dbName = process.env.MONGODB_DB_NAME || 'hts_database';
    this.collectionName = process.env.MONGODB_COLLECTION_NAME || 'hts_codes';
  }

  async connect() {
    if (this.client) return; // Already connected
    
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);
      
      console.log('Connected to MongoDB successfully');
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  /**
   * Format HTS code with proper dots (e.g., 0101210000 → 0101.21.0000)
   */
  formatWithDots(htsCode) {
    const clean = htsCode.replace(/\./g, '');
    if (clean.length >= 10) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}.${clean.slice(6)}`;
    } else if (clean.length >= 6) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}`;
    }
    return htsCode;
  }

  /**
   * Format HTS code without dots (e.g., 0101.21.00 → 0101210000)
   */
  formatWithoutDots(htsCode) {
    return htsCode.replace(/\./g, '');
  }

  async lookupBySixDigitBase(sixDigitBase) {
    await this.connect();
    try {
      // Clean up the format by removing dots
      const cleanSixDigitBase = sixDigitBase.replace(/\./g, '');
      
      console.log(`🔍 Looking up HTS codes for base: ${sixDigitBase} (cleaned: ${cleanSixDigitBase})`);
      
      // Try multiple format variations to make lookups more robust
      const results = await this.collection.find({ 
        $or: [
          { six_digit_base: sixDigitBase },
          { six_digit_base: cleanSixDigitBase }
        ] 
      }).toArray();
      
      console.log(`📊 Found ${results.length} HTS codes for base`);
      if (results.length > 0) {
        console.log(`📋 First result: ${results[0].hts_code} - ${results[0].description}`);
      }
      
      return results;
    } catch (error) {
      console.error('Error looking up by six_digit_base:', error);
      return [];
    }
  }

  async validateHtsCode(htsCode) {
    await this.connect();
    try {
      // Clean up format: both 0101.21.00 and 0101210000 formats should work
      const cleanCode = htsCode.replace(/\./g, '');
      let searchCode = htsCode;
      
      // If the code is in numeric format (e.g., 0101210000), convert to dot format (0101.21.00)
      if (cleanCode.length === 10 && !htsCode.includes('.')) {
        searchCode = `${cleanCode.slice(0,4)}.${cleanCode.slice(4,6)}.${cleanCode.slice(6,10)}`;
      }
      
      console.log(`🔍 Validating HTS code: ${htsCode} (searching as: ${searchCode})`);
      
      // Try multiple format variations
      const result = await this.collection.findOne({ 
        $or: [
          { hts_code: searchCode },
          { hts_code: cleanCode }
        ]
      });
      
      console.log(`📊 Validation result: ${result ? '✅ VALID' : '❌ INVALID'}`);
      if (result) {
        console.log(`📋 Valid code details: ${result.hts_code} - ${result.description}`);
      }
      
      return {
        isValid: result !== null,
        details: result
      };
    } catch (error) {
      console.error('Error validating HTS code:', error);
      return { isValid: false, details: null };
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
    } 
  }
}

module.exports = new MongoDBService();