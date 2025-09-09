// Monitoring Dashboard for Cyan Finance
// Provides real-time system metrics, health status, and alert statistics

const express = require('express');
const os = require('os');
const mongoose = require('mongoose');
const AlertingSystem = require('./alerting');

class MonitoringDashboard {
  constructor() {
    this.router = express.Router();
    this.alertingSystem = new AlertingSystem();
    this.setupRoutes();
  }

  setupRoutes() {
    // Dashboard overview
    this.router.get('/dashboard', async (req, res) => {
      try {
        const dashboard = await this.getDashboardData();
        res.json(dashboard);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // System metrics
    this.router.get('/metrics', (req, res) => {
      try {
        const metrics = this.getSystemMetrics();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Alert statistics
    this.router.get('/alerts', (req, res) => {
      try {
        const alertStats = this.alertingSystem.getAlertStats();
        res.json(alertStats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Recent alerts
    this.router.get('/alerts/recent', (req, res) => {
      try {
        const recentAlerts = this.alertingSystem.alertHistory
          .slice(-50) // Last 50 alerts
          .reverse(); // Most recent first
        res.json(recentAlerts);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Database statistics
    this.router.get('/database', async (req, res) => {
      try {
        const dbStats = await this.getDatabaseStats();
        res.json(dbStats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Performance metrics
    this.router.get('/performance', (req, res) => {
      try {
        const perfMetrics = this.getPerformanceMetrics();
        res.json(perfMetrics);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  // Get comprehensive dashboard data
  async getDashboardData() {
    const [systemMetrics, dbStats, alertStats, perfMetrics] = await Promise.all([
      Promise.resolve(this.getSystemMetrics()),
      this.getDatabaseStats(),
      Promise.resolve(this.alertingSystem.getAlertStats()),
      Promise.resolve(this.getPerformanceMetrics())
    ]);

    return {
      timestamp: new Date().toISOString(),
      system: systemMetrics,
      database: dbStats,
      alerts: alertStats,
      performance: perfMetrics,
      status: this.getOverallStatus(systemMetrics, dbStats, alertStats)
    };
  }

  // Get system metrics
  getSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = (usedMem / totalMem) * 100;

    const loadAvg = os.loadavg();
    const cpuCount = os.cpus().length;
    const cpuUsage = (loadAvg[0] / cpuCount) * 100;

    return {
      memory: {
        total: this.formatBytes(totalMem),
        used: this.formatBytes(usedMem),
        free: this.formatBytes(freeMem),
        usagePercent: memoryUsage.toFixed(2),
        status: memoryUsage > 90 ? 'critical' : memoryUsage > 80 ? 'warning' : 'healthy'
      },
      cpu: {
        cores: cpuCount,
        loadAverage: loadAvg,
        usagePercent: cpuUsage.toFixed(2),
        status: cpuUsage > 90 ? 'critical' : cpuUsage > 80 ? 'warning' : 'healthy'
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        hostname: os.hostname(),
        uptime: this.formatUptime(os.uptime() * 1000),
        nodeVersion: process.version,
        processId: process.pid
      }
    };
  }

  // Get database statistics
  async getDatabaseStats() {
    try {
      const db = mongoose.connection.db;
      const adminDb = db.admin();
      
      const [dbStats, serverStatus] = await Promise.all([
        db.stats(),
        adminDb.serverStatus()
      ]);

      return {
        status: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        collections: dbStats.collections,
        documents: dbStats.objects,
        dataSize: this.formatBytes(dbStats.dataSize),
        storageSize: this.formatBytes(dbStats.storageSize),
        indexes: dbStats.indexes,
        indexSize: this.formatBytes(dbStats.indexSize),
        connections: serverStatus.connections?.current || 0,
        activeConnections: serverStatus.connections?.active || 0,
        availableConnections: serverStatus.connections?.available || 0
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  // Get performance metrics
  getPerformanceMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      process: {
        memory: {
          rss: this.formatBytes(memUsage.rss),
          heapTotal: this.formatBytes(memUsage.heapTotal),
          heapUsed: this.formatBytes(memUsage.heapUsed),
          external: this.formatBytes(memUsage.external),
          arrayBuffers: this.formatBytes(memUsage.arrayBuffers)
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        uptime: this.formatUptime(process.uptime() * 1000)
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 5001
      }
    };
  }

  // Get overall system status
  getOverallStatus(systemMetrics, dbStats, alertStats) {
    const criticalAlerts = alertStats.bySeverity.critical || 0;
    const highAlerts = alertStats.bySeverity.high || 0;
    const memoryStatus = systemMetrics.memory.status;
    const cpuStatus = systemMetrics.cpu.status;
    const dbStatus = dbStats.status;

    if (criticalAlerts > 0 || memoryStatus === 'critical' || cpuStatus === 'critical') {
      return 'critical';
    } else if (highAlerts > 0 || memoryStatus === 'warning' || cpuStatus === 'warning') {
      return 'warning';
    } else if (dbStatus !== 'connected') {
      return 'warning';
    } else {
      return 'healthy';
    }
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

  // Get router
  getRouter() {
    return this.router;
  }
}

// Export both the class and a function that returns the router
module.exports = MonitoringDashboard;
module.exports.getRouter = () => {
  const dashboard = new MonitoringDashboard();
  return dashboard.getRouter();
};
