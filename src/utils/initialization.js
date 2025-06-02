// src/utils/initialization.js
// Production application initialization with service health checks and optimization

const mongodbService = require('../services/mongodbService');
const openaiService = require('../services/openaiService');

// ✅ PRODUCTION SERVICE INITIALIZATION
class ApplicationInitializer {
  constructor() {
    this.initializationStartTime = null;
    this.services = new Map();
    this.healthCheckInterval = null;
  }

  async initialize() {
    this.initializationStartTime = Date.now();
    console.log('🚀 Starting production application initialization...');
    
    try {
      // Initialize services in optimal order
      await this.initializeMongoDB();
      await this.validateOpenAI();
      await this.runHealthChecks();
      await this.setupMonitoring();
      
      const totalTime = Date.now() - this.initializationStartTime;
      console.log(`✅ Application initialized successfully in ${totalTime}ms`);
      console.log('🎯 All services ready for production traffic');
      
      return {
        success: true,
        initializationTime: totalTime,
        services: Object.fromEntries(this.services)
      };
      
    } catch (error) {
      console.error('❌ Application initialization failed:', error);
      throw error;
    }
  }

  async initializeMongoDB() {
    console.log('🔧 Initializing MongoDB service...');
    const startTime = Date.now();
    
    try {
      // Connect and optimize
      await mongodbService.connect();
      
      // Pre-warm connection pool with common queries
      console.log('🔥 Pre-warming MongoDB connection pool...');
      const warmupQueries = [
        mongodbService.collection.findOne({ hts_code: { $exists: true } }),
        mongodbService.collection.findOne({ subheading: { $exists: true } }),
        mongodbService.collection.findOne({ heading: { $exists: true } })
      ];
      
      await Promise.all(warmupQueries);
      
      // Test caching system
      await mongodbService.lookupBySubheading('123456'); // This will cache empty result
      
      const duration = Date.now() - startTime;
      console.log(`✅ MongoDB service ready in ${duration}ms`);
      
      this.services.set('mongodb', {
        status: 'ready',
        initTime: duration,
        features: ['connection_pooling', 'caching', 'optimized_indexes']
      });
      
    } catch (error) {
      console.error('❌ MongoDB initialization failed:', error);
      this.services.set('mongodb', { status: 'failed', error: error.message });
      throw error;
    }
  }

  async validateOpenAI() {
    console.log('🔧 Validating OpenAI service...');
    const startTime = Date.now();
    
    try {
      // Test basic OpenAI connectivity
      const health = await openaiService.healthCheck();
      
      if (health.openai.status !== 'healthy') {
        throw new Error(`OpenAI health check failed: ${health.openai.error}`);
      }
      
      const duration = Date.now() - startTime;
      console.log(`✅ OpenAI service validated in ${duration}ms`);
      
      this.services.set('openai', {
        status: 'ready',
        initTime: duration,
        features: ['responses_api', 'parallel_functions', 'retry_logic', 'performance_monitoring']
      });
      
    } catch (error) {
      console.error('❌ OpenAI validation failed:', error);
      this.services.set('openai', { status: 'failed', error: error.message });
      throw error;
    }
  }

  async runHealthChecks() {
    console.log('🏥 Running comprehensive health checks...');
    
    try {
      const mongoHealth = await mongodbService.healthCheck();
      const openaiHealth = await openaiService.healthCheck();
      
      console.log('📊 Health Check Results:');
      console.log(`   MongoDB: ${mongoHealth.status}`);
      console.log(`   OpenAI: ${openaiHealth.status}`);
      console.log(`   Cache Size: ${mongoHealth.cacheSize} entries`);
      
      if (mongoHealth.performanceStats) {
        console.log('   Performance Stats:');
        Object.entries(mongoHealth.performanceStats).forEach(([op, stats]) => {
          if (stats) {
            console.log(`     ${op}: ${stats.avgDuration}ms avg, ${stats.cacheHitRate}% cache hit rate`);
          }
        });
      }
      
      this.services.set('health', {
        mongodb: mongoHealth,
        openai: openaiHealth,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ Health checks failed:', error);
      this.services.set('health', { status: 'failed', error: error.message });
    }
  }

  async setupMonitoring() {
    console.log('📊 Setting up performance monitoring...');
    
    // Set up periodic health checks (every 5 minutes)
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.runHealthChecks();
        console.log(`🔄 Periodic health check completed at ${new Date().toISOString()}`);
      } catch (error) {
        console.error('⚠️ Periodic health check failed:', error);
      }
    }, 300000); // 5 minutes
    
    // Log system resource usage
    this.logSystemResources();
    
    console.log('✅ Monitoring setup complete');
  }

  logSystemResources() {
    const usage = process.memoryUsage();
    console.log('💾 System Resources:');
    console.log(`   Heap Used: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`);
    console.log(`   Heap Total: ${Math.round(usage.heapTotal / 1024 / 1024)}MB`);
    console.log(`   RSS: ${Math.round(usage.rss / 1024 / 1024)}MB`);
    console.log(`   External: ${Math.round(usage.external / 1024 / 1024)}MB`);
  }

  async getSystemStatus() {
    try {
      const mongoHealth = await mongodbService.healthCheck();
      const openaiHealth = await openaiService.healthCheck();
      const performanceStats = await openaiService.getPerformanceStats();
      
      return {
        status: 'operational',
        uptime: Date.now() - this.initializationStartTime,
        services: {
          mongodb: mongoHealth,
          openai: openaiHealth
        },
        performance: performanceStats,
        system: {
          memory: process.memoryUsage(),
          pid: process.pid,
          version: process.version,
          platform: process.platform
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'degraded',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async gracefulShutdown() {
    console.log('🔄 Starting graceful shutdown...');
    
    try {
      // Clear monitoring interval
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      // Close MongoDB connections
      await mongodbService.close();
      
      console.log('✅ Graceful shutdown completed');
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
    }
  }
}

// Export singleton instance
const applicationInitializer = new ApplicationInitializer();

// ✅ CONVENIENCE FUNCTIONS FOR EASY INTEGRATION
async function initializeApplication() {
  return await applicationInitializer.initialize();
}

async function getApplicationStatus() {
  return await applicationInitializer.getSystemStatus();
}

async function shutdownApplication() {
  return await applicationInitializer.gracefulShutdown();
}

// ✅ PROCESS EVENT HANDLERS
process.on('SIGTERM', async () => {
  console.log('📡 Received SIGTERM signal');
  await shutdownApplication();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('📡 Received SIGINT signal');
  await shutdownApplication();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  shutdownApplication().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  shutdownApplication().then(() => process.exit(1));
});

module.exports = {
  initializeApplication,
  getApplicationStatus,
  shutdownApplication,
  applicationInitializer
};