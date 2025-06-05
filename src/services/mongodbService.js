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
    
    // ✅ Only log this once at startup
    console.log('🔍 MongoDB configured:', this.uri.includes('mongodb.net') ? 'Atlas' : 'Local');
  }

  async connect() {
    // ✅ Return existing connection if already connected
    if (this.isConnected && this.client) {
      return;
    }
    
    // ✅ Return existing promise if connection is in progress
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
        // ✅ Optimized connection pool settings
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000, // Reduced from 10000
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true,
        retryReads: true // ✅ Added retry reads
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

  // ✅ Streamlined validation with less logging
  async validateHtsCode(htsCode) {
    try {
      await this.connect();
      
      const cleanCode = htsCode.replace(/\./g, '');
      const originalCode = htsCode;
      const formattedCode = this.formatWithDots(cleanCode);
      
      console.log(`🔍 Validating HTS code: ${originalCode}`);
      
      // Primary search patterns for exact match
      const searchPatterns = [originalCode, cleanCode, formattedCode];
      
      if (cleanCode.length < 10) {
        const paddedCode = cleanCode.padEnd(10, '0');
        searchPatterns.push(paddedCode);
        searchPatterns.push(this.formatWithDots(paddedCode));
      }
      
      const uniquePatterns = [...new Set(searchPatterns)];
      
      // Try exact match first
      const result = await this.collection.findOne({ 
        $or: uniquePatterns.map(pattern => ({ hts_code: pattern }))
      }, {
        projection: { hts_code: 1, description: 1, full_description: 1, _id: 0 }
      });
      
      if (result) {
        console.log(`✅ Valid: ${result.hts_code}`);
        return {
          isValid: true,
          details: result,
          searchPatterns: uniquePatterns,
          relatedCodes: []
        };
      } else {
        console.log(`❌ Invalid: ${originalCode}`);
        
        // Find related codes under same subheading
        const components = this.extractHtsComponents(cleanCode);
        if (components && components.subheading.length === 6) {
          const relatedCodes = await this.findCodesUnderSubheading(components.subheading);
          
          if (relatedCodes.length > 0) {
            console.log(`💡 Found ${relatedCodes.length} alternatives under ${components.subheading}`);
          }
          
          return {
            isValid: false,
            details: null,
            searchPatterns: uniquePatterns,
            relatedCodes: relatedCodes,
            components: components
          };
        }
        
        return {
          isValid: false,
          details: null,
          searchPatterns: uniquePatterns,
          relatedCodes: []
        };
      }
      
    } catch (error) {
      console.error('❌ HTS validation error:', error);
      return {
        isValid: false,
        details: null,
        error: error.message,
        relatedCodes: []
      };
    }
  }

  // ✅ Streamlined subheading search
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
          _id: 0 
        },
        sort: { hts_code: 1 },
        limit: 15 // ✅ Reduced from 20 for faster response
      }).toArray();
      
      return results.map(code => ({
        hts_code: code.hts_code,
        description: code.description,
        full_description: code.full_description,
        context_path: code.context_path
      }));
      
    } catch (error) {
      console.error('❌ Error finding related codes:', error);
      return [];
    }
  }

  // ✅ Health check method
  async isHealthy() {
    try {
      if (!this.isConnected || !this.client) {
        return false;
      }
      
      // Quick ping to verify connection
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