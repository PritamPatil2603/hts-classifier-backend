const { MongoClient } = require('mongodb');
require('dotenv').config();

class MongoDBService {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    
    this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.dbName = process.env.MONGODB_DB_NAME || 'hts_classification';
    this.collectionName = process.env.MONGODB_COLLECTION_NAME || 'hts_codes';
    this.isConnected = false;
    this.connectionPromise = null;
    
    console.log('🔍 MongoDB configured:', this.uri.includes('mongodb.net') ? 'Atlas' : 'Local');
  }

  async connect() {
    if (this.isConnected && this.client) {
      return;
    }
    
    if (this.connectionPromise) {
      return this.connectionPromise;
    }
    
    this.connectionPromise = this._doConnect();
    return this.connectionPromise;
  }

  async _doConnect() {
    try {
      console.log('🔌 Connecting to MongoDB...');
      
      this.client = new MongoClient(this.uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true
      });
      
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);
      this.isConnected = true;
      
      console.log('✅ MongoDB connected');
      
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      this.connectionPromise = null;
      this.isConnected = false;
      throw error;
    }
  }

  formatWithDots(htsCode) {
    const clean = htsCode.replace(/\./g, '');
    
    if (clean.length >= 10) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}.${clean.slice(6,8)}.${clean.slice(8,10)}`;
    } else if (clean.length >= 8) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}.${clean.slice(6,8)}`;
    } else if (clean.length >= 6) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}`;
    } else if (clean.length >= 4) {
      return clean.slice(0,4);
    }
    
    return htsCode;
  }

  extractHtsComponents(htsCode) {
    const clean = htsCode.replace(/\./g, '');
    
    if (clean.length >= 6) {
      return {
        chapter: clean.slice(0, 2),
        heading: clean.slice(0, 4),
        subheading: clean.slice(0, 6),
        fullCode: clean
      };
    }
    
    return null;
  }

  // ✅ IMPROVED: Better validation response structure
  async validateHtsCode(htsCode) {
    try {
      await this.connect();
      
      const cleanCode = htsCode.replace(/\./g, '');
      const originalCode = htsCode;
      
      console.log(`🔍 Validating HTS code: ${originalCode}`);
      
      // ✅ FORMAT VALIDATION
      if (cleanCode.length !== 10 || !/^\d{10}$/.test(cleanCode)) {
        return {
          valid: false,
          error: "HTS code must be exactly 10 digits",
          provided_code: htsCode,
          format_valid: false,
          details: null,
          relatedCodes: [],
          subheading_analysis: null
        };
      }
      
      // ✅ EXACT MATCH CHECK
      const result = await this.collection.findOne({ 
        hts_code: originalCode
      }, {
        projection: { hts_code: 1, description: 1, full_description: 1, context_path: 1, _id: 0 }
      });
      
      if (result) {
        console.log(`✅ Valid: ${result.hts_code}`);
        return {
          valid: true,
          details: {
            code: result.hts_code,
            description: result.description,
            full_description: result.full_description,
            context_path: result.context_path
          },
          provided_code: htsCode,
          format_valid: true,
          relatedCodes: []
        };
      } else {
        console.log(`❌ Invalid: ${originalCode}`);
        
        // ✅ FIND RELATED CODES
        const components = this.extractHtsComponents(cleanCode);
        if (components && components.subheading.length === 6) {
          const relatedCodes = await this.findCodesUnderSubheading(components.subheading);
          
          return {
            valid: false,
            error: "HTS code not found in official US HTS database",
            provided_code: htsCode,
            format_valid: true,
            details: null,
            subheading_analysis: {
              subheading: components.subheading,
              subheading_appears_correct: relatedCodes.length > 0
            },
            relatedCodes: relatedCodes,
            components: components,
            suggestion_context: relatedCodes.length > 0 ? 
              `Found ${relatedCodes.length} valid HTS codes under subheading ${components.subheading}. Please select the most appropriate one.` :
              `No valid codes found under subheading ${components.subheading}.`
          };
        }
        
        return {
          valid: false,
          error: "Invalid HTS code format or structure",
          provided_code: htsCode,
          format_valid: true,
          details: null,
          relatedCodes: [],
          subheading_analysis: null
        };
      }
      
    } catch (error) {
      console.error('❌ HTS validation error:', error);
      return {
        valid: false,
        error: "Database validation failed",
        details: error.message,
        provided_code: htsCode,
        format_valid: false,
        relatedCodes: []
      };
    }
  }

  async findCodesUnderSubheading(subheading) {
    try {
      await this.connect();
      
      const formattedSubheading = this.formatWithDots(subheading);
      
      const results = await this.collection.find({
        $or: [
          { hts_code: { $regex: `^${formattedSubheading}` } },
          { subheading: subheading }
        ]
      }, {
        projection: { 
          hts_code: 1, 
          description: 1, 
          full_description: 1,
          context_path: 1,
          units: 1,
          _id: 0 
        },
        sort: { hts_code: 1 },
        limit: 15
      }).toArray();
      
      return results.map(code => ({
        hts_code: code.hts_code,
        description: code.description,
        full_description: code.full_description,
        context_path: code.context_path,
        units: code.units
      }));
      
    } catch (error) {
      console.error('❌ Error finding related codes:', error);
      return [];
    }
  }

  async isHealthy() {
    try {
      if (!this.isConnected || !this.client) {
        return false;
      }
      
      await this.db.admin().ping();
      return true;
    } catch (error) {
      console.error('❌ MongoDB health check failed:', error);
      return false;
    }
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
      this.isConnected = false;
      this.connectionPromise = null;
      console.log('🔌 MongoDB connection closed');
    }
  }
}

const mongodbService = new MongoDBService();
module.exports = mongodbService;