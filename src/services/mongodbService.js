// src/services/mongodbService.js
// Production-ready MongoDB service with connection pooling, caching, and performance optimization

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
    this.isConnected = false;
    this.indexesOptimized = false;
    
    // ✅ Connection management
    this.connectionPromise = null;
    
    // ✅ Semantic caching layer
    this.queryCache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
    this.maxCacheSize = 1000; // Prevent memory leaks
    
    // ✅ Performance tracking
    this.performanceMetrics = new Map();
  }

  // ✅ OPTIMIZED CONNECTION PATTERN - Connect once, reuse everywhere
  async connect() {
    if (this.connectionPromise) return this.connectionPromise;
    
    this.connectionPromise = this._doConnect();
    return this.connectionPromise;
  }

  async _doConnect() {
    if (this.isConnected && this.client) return;
    
    try {
      console.log('🔌 Establishing MongoDB connection...');
      
      // ✅ PRODUCTION CONNECTION POOLING - Optimized settings
      this.client = new MongoClient(this.uri, {
        maxPoolSize: 10,          // Up to 10 concurrent connections
        minPoolSize: 2,           // Always keep 2 connections ready
        maxIdleTimeMS: 30000,     // Close unused connections after 30s
        serverSelectionTimeoutMS: 5000, // 5s to find MongoDB server
        socketTimeoutMS: 45000,   // 45s socket timeout
        connectTimeoutMS: 10000,  // 10s connection timeout
        retryWrites: true,        // Retry failed writes
        maxConnecting: 2,         // Max 2 connections being established at once
        heartbeatFrequencyMS: 10000, // Check server health every 10s
        // ✅ Additional production settings
        writeConcern: { w: 'majority', j: true, wtimeout: 10000 },
        readConcern: { level: 'majority' },
        compressors: ['zlib'], // Compress network traffic
      });
      
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.collection = this.db.collection(this.collectionName);
      this.isConnected = true;
      
      // ✅ PRE-WARM CONNECTION POOL
      console.log('🔥 Pre-warming connection pool...');
      await this.collection.findOne({ hts_code: { $exists: true } });
      
      // ✅ OPTIMIZE INDEXES ONCE
      if (!this.indexesOptimized) {
        await this.optimizeIndexes();
        this.indexesOptimized = true;
      }
      
      // ✅ Setup connection event listeners
      this.setupConnectionEventListeners();
      
      console.log('✅ MongoDB connected with optimized connection pool and indexes');
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      this.connectionPromise = null; // Reset on error
      throw error;
    }
  }

  // ✅ CONNECTION EVENT MONITORING
  setupConnectionEventListeners() {
    this.client.on('serverOpening', () => {
      console.log('🟢 MongoDB server connection opened');
    });
    
    this.client.on('serverClosed', () => {
      console.log('🔴 MongoDB server connection closed');
    });
    
    this.client.on('connectionPoolCreated', () => {
      console.log('🏊 MongoDB connection pool created');
    });
    
    this.client.on('connectionCheckedOut', () => {
      console.log('📤 Connection checked out from pool');
    });
    
    this.client.on('connectionCheckedIn', () => {
      console.log('📥 Connection returned to pool');
    });
  }

  // ✅ PRODUCTION INDEX OPTIMIZATION
  async optimizeIndexes() {
    try {
      console.log('🔧 Optimizing MongoDB indexes for production...');
      
      // Remove unused indexes that slow down writes
      const unusedIndexes = [
        'chapter_1',
        'full_description_text_description_text', // This was 9.2MB and unused!
        'chapter_1_heading_1_subheading_1',
        'six_digit_base_1'
      ];
      
      for (const indexName of unusedIndexes) {
        try {
          await this.collection.dropIndex(indexName);
          console.log(`🗑️ Removed unused index: ${indexName}`);
        } catch (error) {
          console.log(`⚠️ Index ${indexName} may not exist or already removed`);
        }
      }
      
      // ✅ CREATE HIGH-PERFORMANCE COMPOUND INDEXES
      const performanceIndexes = [
        // For subheading lookups (most common query)
        { 
          spec: { subheading: 1, hts_code: 1 },
          name: 'perf_subheading_hts',
          background: true
        },
        
        // For heading lookups with projection optimization
        { 
          spec: { heading: 1, subheading: 1, description: 1 },
          name: 'perf_heading_lookup',
          background: true
        },
        
        // For HTS code validation (exact match)
        { 
          spec: { hts_code: 1 },
          name: 'perf_hts_validation',
          background: true
        },
        
        // For chapter-based queries
        { 
          spec: { chapter: 1, heading: 1 },
          name: 'perf_chapter_heading',
          background: true
        },
        
        // For text search on descriptions (optimized)
        { 
          spec: { 
            description: "text", 
            heading: "text" 
          },
          name: 'perf_text_search',
          background: true
        }
      ];

      for (const indexConfig of performanceIndexes) {
        try {
          await this.collection.createIndex(indexConfig.spec, {
            name: indexConfig.name,
            background: indexConfig.background
          });
          console.log(`✅ Created performance index: ${indexConfig.name}`);
        } catch (error) {
          if (error.code === 85) { // Index already exists
            console.log(`⚠️ Index ${indexConfig.name} already exists`);
          } else {
            console.error(`❌ Error creating index ${indexConfig.name}:`, error.message);
          }
        }
      }
      
      console.log('✅ Production index optimization complete');
      await this.showActiveIndexes();
      
    } catch (error) {
      console.log('⚠️ Index optimization error:', error.message);
    }
  }

  // ✅ SHOW ACTIVE INDEXES WITH USAGE STATS
  async showActiveIndexes() {
    try {
      const indexes = await this.collection.listIndexes().toArray();
      console.log('📋 Active indexes:');
      indexes.forEach(index => {
        const sizeInfo = index.size ? ` (${Math.round(index.size / 1024)}KB)` : '';
        console.log(`   - ${index.name}: ${JSON.stringify(index.key)}${sizeInfo}`);
      });
    } catch (error) {
      console.log('⚠️ Could not list indexes:', error.message);
    }
  }

  // ✅ SEMANTIC CACHING SYSTEM
  getCacheKey(operation, params) {
    return `${operation}:${JSON.stringify(params)}`;
  }

  async cachedQuery(operation, params, queryFn) {
    const cacheKey = this.getCacheKey(operation, params);
    const cached = this.queryCache.get(cacheKey);
    
    // Check cache hit
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`🚀 Cache HIT for ${operation} (${Date.now() - cached.timestamp}ms old)`);
      this.recordPerformanceMetric(operation, Date.now() - cached.timestamp, true);
      return cached.data;
    }

    // Cache miss - execute query
    const startTime = Date.now();
    const result = await queryFn();
    const duration = Date.now() - startTime;
    
    // Store in cache
    this.queryCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });
    
    // Prevent memory leaks - remove old entries
    if (this.queryCache.size > this.maxCacheSize) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }
    
    console.log(`💾 Cached result for ${operation} (${duration}ms)`);
    this.recordPerformanceMetric(operation, duration, false);
    return result;
  }

  // ✅ PERFORMANCE METRICS TRACKING
  recordPerformanceMetric(operation, duration, fromCache) {
    if (!this.performanceMetrics.has(operation)) {
      this.performanceMetrics.set(operation, {
        totalCalls: 0,
        totalDuration: 0,
        cacheHits: 0,
        slowQueries: 0
      });
    }
    
    const metrics = this.performanceMetrics.get(operation);
    metrics.totalCalls++;
    metrics.totalDuration += duration;
    
    if (fromCache) {
      metrics.cacheHits++;
    }
    
    if (duration > 1000) { // Slow query threshold
      metrics.slowQueries++;
    }
  }

  getPerformanceStats(operation) {
    const metrics = this.performanceMetrics.get(operation);
    if (!metrics) return null;
    
    return {
      avgDuration: Math.round(metrics.totalDuration / metrics.totalCalls),
      cacheHitRate: Math.round((metrics.cacheHits / metrics.totalCalls) * 100),
      totalCalls: metrics.totalCalls,
      slowQueries: metrics.slowQueries
    };
  }

  /**
   * Format HTS code with proper dots (e.g., 0101210000 → 0101.21.0000)
   */
  formatWithDots(htsCode) {
    const clean = htsCode.replace(/\./g, '');
    if (clean.length >= 10) {
      return `${clean.slice(0,4)}.${clean.slice(4,6)}.${clean.slice(6,8)}.${clean.slice(8)}`;
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

  // ✅ OPTIMIZED SUBHEADING LOOKUP WITH CACHING
  async lookupBySubheading(subheading) {
    await this.connect();
    
    return this.cachedQuery('subheading', { subheading }, async () => {
      const cleanSubheading = subheading.replace(/\./g, '');
      
      console.log(`🔍 Looking up HTS codes for subheading: ${subheading} (cleaned: ${cleanSubheading})`);
      
      // ✅ OPTIMIZED QUERY with compound index usage
      const results = await this.collection.find({ 
        subheading: cleanSubheading 
      }, {
        projection: { 
          hts_code: 1, 
          description: 1, 
          subheading: 1, 
          heading: 1,
          chapter: 1,
          _id: 0 
        },
        hint: 'perf_subheading_hts' // Force use of our optimized index
      }).limit(50).toArray();
      
      console.log(`📊 Found ${results.length} HTS codes for subheading`);
      
      if (results.length > 0) {
        console.log(`📋 Sample result: ${results[0].hts_code} - ${results[0].description?.substring(0, 100)}...`);
      }
      
      return results;
    });
  }

  // ✅ OPTIMIZED VALIDATION WITH CACHING
  async validateHtsCode(htsCode) {
    await this.connect();
    
    return this.cachedQuery('validation', { htsCode }, async () => {
      const cleanCode = htsCode.replace(/\./g, '');
      let searchCode = htsCode;
      
      // If the code is in numeric format, convert to dot format
      if (cleanCode.length === 10 && !htsCode.includes('.')) {
        searchCode = this.formatWithDots(cleanCode);
      }
      
      console.log(`🔍 Validating HTS code: ${htsCode} (searching as: ${searchCode})`);
      
      // ✅ OPTIMIZED VALIDATION QUERY
      const result = await this.collection.findOne({ 
        $or: [
          { hts_code: searchCode },
          { hts_code: cleanCode },
          { hts_code: this.formatWithDots(cleanCode) }
        ]
      }, {
        projection: { hts_code: 1, description: 1, _id: 0 },
        hint: 'perf_hts_validation'
      });
      
      console.log(`📊 Validation result: ${result ? '✅ VALID' : '❌ INVALID'}`);
      
      if (result) {
        console.log(`📋 Valid code details: ${result.hts_code} - ${result.description?.substring(0, 100)}...`);
      }
      
      return {
        isValid: result !== null,
        details: result
      };
    });
  }

  // ✅ OPTIMIZED HEADING LOOKUP WITH CACHING
  async lookupByHeading(heading) {
    await this.connect();
    
    return this.cachedQuery('heading', { heading }, async () => {
      const cleanHeading = heading.replace(/\./g, '');
      
      console.log(`🔍 Looking up HTS codes for heading: ${heading} (cleaned: ${cleanHeading})`);
      
      // ✅ OPTIMIZED HEADING QUERY
      const results = await this.collection.find({ 
        $or: [
          { heading: heading },
          { heading: cleanHeading }
        ] 
      }, {
        projection: { 
          hts_code: 1, 
          description: 1, 
          heading: 1, 
          subheading: 1,
          chapter: 1,
          _id: 0 
        },
        hint: 'perf_heading_lookup'
      }).limit(100).toArray();
      
      console.log(`📊 Found ${results.length} HTS codes for heading`);
      
      if (results.length > 0) {
        console.log(`📋 Sample result: ${results[0].hts_code} - ${results[0].description?.substring(0, 100)}...`);
      }
      
      return results;
    });
  }

  // ✅ HEALTH CHECK METHOD
  async healthCheck() {
    try {
      await this.connect();
      const result = await this.collection.findOne({}, { projection: { _id: 1 } });
      return {
        status: 'healthy',
        connected: this.isConnected,
        hasData: !!result,
        cacheSize: this.queryCache.size,
        performanceStats: Object.fromEntries(
          Array.from(this.performanceMetrics.entries()).map(([op, metrics]) => [
            op, 
            this.getPerformanceStats(op)
          ])
        )
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connected: false
      };
    }
  }

  // ✅ GRACEFUL CONNECTION CLEANUP
  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.collection = null;
      this.isConnected = false;
      this.connectionPromise = null;
      
      // Clear cache
      this.queryCache.clear();
      this.performanceMetrics.clear();
      
      console.log('🔌 MongoDB connection closed and cache cleared');
    } 
  }

  // ✅ STATIC INITIALIZATION METHOD
  static async initialize() {
    console.log('🚀 Initializing MongoDB service...');
    await mongodbService.connect();
    
    // Pre-warm with common queries
    try {
      await mongodbService.collection.findOne({ hts_code: { $exists: true } });
      console.log('✅ MongoDB service initialized and ready');
    } catch (error) {
      console.error('❌ MongoDB service initialization failed:', error);
      throw error;
    }
  }
}

// Export singleton instance
const mongodbService = new MongoDBService();
module.exports = mongodbService;