const { MongoClient } = require('mongodb');

class MongoDBService {
  constructor() {
    this.client = null;
    this.db = null;
    this.collection = null;
    this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.dbName = process.env.MONGODB_DB_NAME || 'hts_database';
    this.collectionName = process.env.MONGODB_COLLECTION_NAME || 'hts_codes';
    this.isConnected = false;
    this.connectionPromise = null;
  }

  async connect() {
    if (this.connectionPromise) return this.connectionPromise;
    
    this.connectionPromise = this._doConnect();
    return this.connectionPromise;
  }

  async _doConnect() {
    if (this.isConnected && this.client) return;
    
    try {
      console.log('🔌 Establishing MongoDB connection...');
      
      this.client = new MongoClient(this.uri, {
        maxPoolSize: 10,
        minPoolSize: 2,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        retryWrites: true
      });
      
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);
      this.isConnected = true;
      
      console.log('✅ MongoDB connected (simplified service)');
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      this.connectionPromise = null;
      throw error;
    }
  }

  formatWithDots(htsCode) {
    const clean = htsCode.replace(/\./g, '');
    if (clean.length >= 10) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}.${clean.slice(6,8)}.${clean.slice(8)}`;
    } else if (clean.length >= 6) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}`;
    }
    return htsCode;
  }

  // ONLY HTS validation function remains
  async validateHtsCode(htsCode) {
    await this.connect();
    
    const cleanCode = htsCode.replace(/\./g, '');
    let searchCode = htsCode;
    
    if (cleanCode.length === 10 && !htsCode.includes('.')) {
      searchCode = this.formatWithDots(cleanCode);
    }
    
    console.log(`🔍 Validating HTS code: ${htsCode} (searching as: ${searchCode})`);
    
    const result = await this.collection.findOne({ 
      $or: [
        { hts_code: searchCode },
        { hts_code: cleanCode },
        { hts_code: this.formatWithDots(cleanCode) }
      ]
    }, {
      projection: { hts_code: 1, description: 1, _id: 0 }
    });
    
    console.log(`📊 Validation result: ${result ? '✅ VALID' : '❌ INVALID'}`);
    
    if (result) {
      console.log(`📋 Valid code: ${result.hts_code} - ${result.description?.substring(0, 100)}...`);
    }
    
    return {
      isValid: result !== null,
      details: result
    };
  }

  async healthCheck() {
    try {
      await this.connect();
      const result = await this.collection.findOne({}, { projection: { _id: 1 } });
      return {
        status: 'healthy',
        connected: this.isConnected,
        hasData: !!result
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connected: false
      };
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