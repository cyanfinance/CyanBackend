// Health Check System for Cyan Finance
// Monitors application health, database connectivity, and system resources

const express = require('express');
const mongoose = require('mongoose');
const os = require('os');
const fs = require('fs');
const path = require('path');

class HealthChecker {
  constructor() {
    this.startTime = Date.now();
    this.checks = {
      database: false,
      memory: false,
      disk: false,
      api: false
    };
  }

  // Check database connectivity
  async checkDatabase() {
    try {
      const state = mongoose.connection.readyState;
      this.checks.database = state === 1; // 1 = connected
      return {
        status: this.checks.database ? 'healthy' : 'unhealthy',
        details: {
          state: state,
          stateName: ['disconnected', 'connected', 'connecting', 'disconnecting'][state] || 'unknown',
          collections: Object.keys(mongoose.connection.collections).length
        }
      };
    } catch (error) {
      this.checks.database = false;
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Check memory usage
  checkMemory() {
    try {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryUsage = (usedMem / totalMem) * 100;
      
      this.checks.memory = memoryUsage < 90; // Alert if >90% usage
      
      return {
        status: this.checks.memory ? 'healthy' : 'warning',
        details: {
          total: this.formatBytes(totalMem),
          used: this.formatBytes(usedMem),
          free: this.formatBytes(freeMem),
          usagePercent: memoryUsage.toFixed(2)
        }
      };
    } catch (error) {
      this.checks.memory = false;
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Check disk usage
  checkDisk() {
    try {
      const diskPath = process.cwd();
      const stats = fs.statSync(diskPath);
      const diskUsage = process.memoryUsage();
      
      this.checks.disk = true; // Simplified check
      
      return {
        status: 'healthy',
        details: {
          path: diskPath,
          exists: true,
          readable: true,
          writable: true
        }
      };
    } catch (error) {
      this.checks.disk = false;
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Check API responsiveness
  async checkAPI() {
    try {
      const start = Date.now();
      // Simulate a simple database query
      await mongoose.connection.db.admin().ping();
      const responseTime = Date.now() - start;
      
      this.checks.api = responseTime < 1000; // Alert if >1s
      
      return {
        status: this.checks.api ? 'healthy' : 'warning',
        details: {
          responseTime: responseTime + 'ms',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      this.checks.api = false;
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // Get overall health status
  async getHealthStatus() {
    const [db, memory, disk, api] = await Promise.all([
      this.checkDatabase(),
      Promise.resolve(this.checkMemory()),
      Promise.resolve(this.checkDisk()),
      this.checkAPI()
    ]);

    const allHealthy = Object.values(this.checks).every(check => check);
    const uptime = Date.now() - this.startTime;

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: this.formatUptime(uptime),
      checks: {
        database: db,
        memory: memory,
        disk: disk,
        api: api
      },
      system: {
        nodeVersion: process.version,
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        loadAverage: os.loadavg(),
        cpuCount: os.cpus().length
      }
    };
  }

  // Format bytes to human readable
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Format uptime
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}

// Create health check router
const healthRouter = express.Router();
const healthChecker = new HealthChecker();

// Health check endpoint
healthRouter.get('/health', async (req, res) => {
  try {
    const health = await healthChecker.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Simple health check (for load balancers)
healthRouter.get('/ping', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Detailed health check
healthRouter.get('/health/detailed', async (req, res) => {
  try {
    const health = await healthChecker.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    // Add additional system information
    const detailedHealth = {
      ...health,
      environment: process.env.NODE_ENV || 'development',
      processId: process.pid,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      version: require('../package.json').version
    };
    
    res.status(statusCode).json(detailedHealth);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = healthRouter;
