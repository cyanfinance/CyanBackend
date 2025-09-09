// Monitoring Configuration for Cyan Finance
// Centralized configuration for health checks, alerting, and monitoring

module.exports = {
  // Health Check Configuration
  healthCheck: {
    enabled: process.env.HEALTH_CHECK_ENABLED !== 'false',
    interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
    timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000, // 5 seconds
    thresholds: {
      memory: {
        warning: parseFloat(process.env.MEMORY_WARNING_THRESHOLD) || 80, // 80%
        critical: parseFloat(process.env.MEMORY_CRITICAL_THRESHOLD) || 90 // 90%
      },
      cpu: {
        warning: parseFloat(process.env.CPU_WARNING_THRESHOLD) || 80, // 80%
        critical: parseFloat(process.env.CPU_CRITICAL_THRESHOLD) || 90 // 90%
      },
      api: {
        warning: parseInt(process.env.API_WARNING_THRESHOLD) || 1000, // 1 second
        critical: parseInt(process.env.API_CRITICAL_THRESHOLD) || 5000 // 5 seconds
      }
    }
  },

  // Alerting Configuration
  alerting: {
    enabled: process.env.ALERTING_ENABLED === 'true',
    email: {
      enabled: process.env.EMAIL_ALERTS_ENABLED !== 'false',
      recipients: process.env.ALERT_EMAILS ? process.env.ALERT_EMAILS.split(',') : [],
      from: process.env.EMAIL_FROM || 'alerts@cyanfinance.com',
      subjectPrefix: process.env.EMAIL_SUBJECT_PREFIX || '🚨 Cyan Finance Alert:'
    },
    slack: {
      enabled: !!process.env.SLACK_WEBHOOK_URL,
      webhookUrl: process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || '#alerts',
      username: process.env.SLACK_USERNAME || 'Cyan Finance Monitor'
    },
    rateLimiting: {
      maxAlertsPerHour: parseInt(process.env.MAX_ALERTS_PER_HOUR) || 10,
      cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 30
    }
  },

  // Monitoring Dashboard Configuration
  dashboard: {
    enabled: process.env.DASHBOARD_ENABLED !== 'false',
    refreshInterval: parseInt(process.env.DASHBOARD_REFRESH_INTERVAL) || 30000, // 30 seconds
    retention: {
      alertHistory: parseInt(process.env.ALERT_HISTORY_RETENTION) || 1000, // Keep last 1000 alerts
      metricsHistory: parseInt(process.env.METRICS_HISTORY_RETENTION) || 100 // Keep last 100 data points
    }
  },

  // Database Monitoring
  database: {
    enabled: process.env.DB_MONITORING_ENABLED !== 'false',
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 5000,
    queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT) || 10000,
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 100
  },

  // Performance Monitoring
  performance: {
    enabled: process.env.PERFORMANCE_MONITORING_ENABLED !== 'false',
    slowQueryThreshold: parseInt(process.env.SLOW_QUERY_THRESHOLD) || 1000, // 1 second
    memoryLeakThreshold: parseFloat(process.env.MEMORY_LEAK_THRESHOLD) || 0.1, // 10% growth per hour
    gcMonitoring: process.env.GC_MONITORING_ENABLED === 'true'
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: {
      enabled: process.env.FILE_LOGGING_ENABLED !== 'false',
      path: process.env.LOG_FILE_PATH || './logs/monitoring.log',
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5
    },
    console: {
      enabled: process.env.CONSOLE_LOGGING_ENABLED !== 'false'
    }
  },

  // Security Configuration
  security: {
    // API endpoints that require authentication
    protectedEndpoints: [
      '/api/monitoring/dashboard',
      '/api/monitoring/metrics',
      '/api/monitoring/alerts',
      '/api/monitoring/database',
      '/api/monitoring/performance'
    ],
    // IP whitelist for monitoring endpoints (optional)
    ipWhitelist: process.env.MONITORING_IP_WHITELIST ? 
      process.env.MONITORING_IP_WHITELIST.split(',') : [],
    // API key for external monitoring tools
    apiKey: process.env.MONITORING_API_KEY
  },

  // External Monitoring Integration
  external: {
    // Uptime Robot integration
    uptimeRobot: {
      enabled: process.env.UPTIME_ROBOT_ENABLED === 'true',
      webhookUrl: process.env.UPTIME_ROBOT_WEBHOOK_URL
    },
    // New Relic integration
    newRelic: {
      enabled: process.env.NEW_RELIC_ENABLED === 'true',
      licenseKey: process.env.NEW_RELIC_LICENSE_KEY,
      appName: process.env.NEW_RELIC_APP_NAME || 'Cyan Finance'
    },
    // DataDog integration
    datadog: {
      enabled: process.env.DATADOG_ENABLED === 'true',
      apiKey: process.env.DATADOG_API_KEY,
      appKey: process.env.DATADOG_APP_KEY
    }
  },

  // Maintenance Mode
  maintenance: {
    enabled: process.env.MAINTENANCE_MODE_ENABLED === 'true',
    message: process.env.MAINTENANCE_MESSAGE || 'System is under maintenance. Please try again later.',
    allowedIPs: process.env.MAINTENANCE_ALLOWED_IPS ? 
      process.env.MAINTENANCE_ALLOWED_IPS.split(',') : []
  }
};
