// src/controllers/classificationController.js
// Optimized controller with performance monitoring and enhanced session management

const openaiService = require('../services/openaiService');

// ✅ ENHANCED SESSION MANAGEMENT with TTL and cleanup
class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
    this.maxSessions = 10000; // Prevent memory leaks
    
    // ✅ Cleanup old sessions every 10 minutes
    setInterval(() => this.cleanupExpiredSessions(), 10 * 60 * 1000);
  }
  
  createSession(productDescription, responseId) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // ✅ Prevent memory leaks
    if (this.sessions.size >= this.maxSessions) {
      this.cleanupOldestSessions(1000); // Remove 1000 oldest sessions
    }
    
    this.sessions.set(sessionId, {
      productDescription,
      lastResponseId: responseId,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      requestCount: 1
    });
    
    console.log(`📝 Created session ${sessionId} (${this.sessions.size} total sessions)`);
    return sessionId;
  }
  
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Check if session expired
    if (Date.now() - session.lastActivity > this.sessionTimeout) {
      this.sessions.delete(sessionId);
      console.log(`🗑️ Expired session ${sessionId}`);
      return null;
    }
    
    // Update last activity
    session.lastActivity = Date.now();
    session.requestCount++;
    
    return session;
  }
  
  updateSession(sessionId, responseId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastResponseId = responseId;
      session.lastActivity = Date.now();
      session.requestCount++;
    }
  }
  
  cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.sessionTimeout) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired sessions (${this.sessions.size} remaining)`);
    }
  }
  
  cleanupOldestSessions(count) {
    const sortedSessions = Array.from(this.sessions.entries())
      .sort(([,a], [,b]) => a.lastActivity - b.lastActivity)
      .slice(0, count);
    
    for (const [sessionId] of sortedSessions) {
      this.sessions.delete(sessionId);
    }
    
    console.log(`🧹 Cleaned up ${count} oldest sessions (${this.sessions.size} remaining)`);
  }
  
  getStats() {
    return {
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).filter(
        s => Date.now() - s.lastActivity < 5 * 60 * 1000 // Active in last 5 minutes
      ).length
    };
  }
}

// Create session manager instance
const sessionManager = new SessionManager();

/**
 * ✅ OPTIMIZED: Start a new classification process with performance monitoring
 */
async function startClassification(req, res) {
  const startTime = Date.now();
  
  try {
    const { productDescription } = req.body;
    
    console.log('\n🚀 NEW CLASSIFICATION REQUEST');
    console.log('📝 Product length:', productDescription?.length || 0, 'characters');
    console.log('🌐 IP:', req.ip || req.connection.remoteAddress);
    
    // ✅ ENHANCED VALIDATION
    // ✅ STREAMLINED VALIDATION (No length restrictions)
    if (!productDescription) {
      return res.status(400).json({ 
        error: 'Product description is required',
        code: 'MISSING_DESCRIPTION'
      });
    }
    
    if (typeof productDescription !== 'string') {
      return res.status(400).json({ 
        error: 'Product description must be a string',
        code: 'INVALID_TYPE',
        received: typeof productDescription
      });
    }
    
    // ✅ ONLY CHECK: Not empty after trimming whitespace
    if (productDescription.trim().length === 0) {
      return res.status(400).json({ 
        error: 'Product description cannot be empty',
        code: 'DESCRIPTION_EMPTY'
      });
    }
    
    console.log('🔧 Starting OpenAI classification...');
    
    // ✅ Start the classification using optimized service
    const result = await openaiService.startClassification(productDescription);
    
    console.log('✅ OpenAI classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // ✅ Create session with enhanced management
    const sessionId = sessionManager.createSession(productDescription, result.response_id);
    
    // ✅ ENHANCED RESPONSE PROCESSING
    if (typeof result.response === 'object' && result.response.responseType) {
      // Convert responseType to type for frontend compatibility
      const responseForUI = {
        ...result.response,
        type: result.response.responseType === 'classification' ? 'result' : result.response.responseType
      };
      
      const duration = Date.now() - startTime;
      console.log(`✅ Classification completed in ${duration}ms`);
      
      return res.status(200).json({
        success: true,
        sessionId,
        ...responseForUI,
        performance: {
          duration,
          breakdown: result.performance_stats
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // ✅ ENHANCED ERROR HANDLING
      console.error('❌ Unexpected response format:', result.response);
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from OpenAI',
        code: 'INVALID_RESPONSE_FORMAT',
        details: 'The response did not contain the expected structured data.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Classification failed in ${duration}ms:`, error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to start classification', 
      code: 'CLASSIFICATION_ERROR',
      message: error.message,
      duration,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * ✅ OPTIMIZED: Continue an existing classification process
 */
async function continueClassification(req, res) {
  const startTime = Date.now();
  
  try {
    const { sessionId, selection } = req.body;
    
    console.log('\n🔄 CONTINUE CLASSIFICATION REQUEST');
    console.log('🔗 Session ID:', sessionId);
    console.log('💬 Selection length:', selection?.length || 0, 'characters');
    console.log('🌐 IP:', req.ip || req.connection.remoteAddress);
    
    // ✅ ENHANCED VALIDATION
    if (!sessionId || !selection) {
      return res.status(400).json({ 
        error: 'Session ID and selection are required',
        code: 'MISSING_PARAMETERS',
        missing: {
          sessionId: !sessionId,
          selection: !selection
        }
      });
    }
    
    if (typeof selection !== 'string') {
      return res.status(400).json({ 
        error: 'Selection must be a string',
        code: 'INVALID_SELECTION_TYPE',
        received: typeof selection
      });
    }
    
    // ✅ Check session with enhanced management
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found or expired',
        code: 'SESSION_NOT_FOUND',
        sessionId
      });
    }
    
    console.log('🔧 Continuing OpenAI classification...');
    console.log('📋 Session stats:', {
      age: Math.round((Date.now() - session.createdAt) / 1000) + 's',
      requests: session.requestCount
    });
    
    // ✅ Continue with optimized service
    const result = await openaiService.continueClassification(
      session.lastResponseId,
      selection
    );
    
    console.log('✅ Continue classification completed');
    console.log('📊 Response type:', result.response?.responseType);
    
    // ✅ Update session
    sessionManager.updateSession(sessionId, result.response_id);
    
    // ✅ ENHANCED RESPONSE PROCESSING
    if (typeof result.response === 'object' && result.response.responseType) {
      // Convert responseType to type for frontend compatibility
      const responseForUI = {
        ...result.response,
        type: result.response.responseType === 'classification' ? 'result' : result.response.responseType
      };
      
      const duration = Date.now() - startTime;
      console.log(`✅ Continue completed in ${duration}ms`);
      
      return res.status(200).json({
        success: true,
        sessionId,
        ...responseForUI,
        performance: {
          duration,
          breakdown: result.performance_stats
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // ✅ ENHANCED ERROR HANDLING
      console.error('❌ Unexpected response format:', result.response);
      return res.status(500).json({ 
        success: false,
        error: 'Unexpected response format from OpenAI',
        code: 'INVALID_RESPONSE_FORMAT',
        details: 'The response did not contain the expected structured data.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Continue classification failed in ${duration}ms:`, error);
    
    return res.status(500).json({ 
      success: false,
      error: 'Failed to continue classification', 
      code: 'CONTINUE_ERROR',
      message: error.message,
      duration,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * ✅ ENHANCED: Get the current status of a classification session
 */
async function getSessionStatus(req, res) {
  try {
    const { sessionId } = req.params;
    
    console.log('🔍 Getting session status for:', sessionId);
    
    if (!sessionId) {
      return res.status(400).json({ 
        error: 'Session ID is required',
        code: 'MISSING_SESSION_ID'
      });
    }
    
    // ✅ Check session with enhanced management
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found or expired',
        code: 'SESSION_NOT_FOUND',
        sessionId
      });
    }
    
    const sessionAge = Date.now() - session.createdAt;
    const lastActivity = Date.now() - session.lastActivity;
    
    return res.status(200).json({
      success: true,
      sessionId,
      productDescription: session.productDescription.substring(0, 200) + '...', // Truncate for privacy
      hasActiveConversation: !!session.lastResponseId,
      stats: {
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
        ageSeconds: Math.round(sessionAge / 1000),
        lastActivitySeconds: Math.round(lastActivity / 1000),
        requestCount: session.requestCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting session status:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to get session status', 
      code: 'SESSION_STATUS_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * ✅ NEW: Get session statistics (for monitoring)
 */
async function getSessionStats(req, res) {
  try {
    const stats = sessionManager.getStats();
    
    return res.status(200).json({
      success: true,
      sessionStats: stats,
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting session stats:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to get session stats',
      code: 'SESSION_STATS_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  startClassification,
  continueClassification,
  getSessionStatus,
  getSessionStats
};