// Alerting System for Cyan Finance
// Sends notifications when health checks fail or system issues are detected

const sib = require('sib-api-v3-sdk');
const fs = require('fs');
const path = require('path');

class AlertingSystem {
  constructor() {
    this.alertHistory = [];
    this.alertConfig = {
      enabled: process.env.ALERTING_ENABLED === 'true',
      emailRecipients: process.env.ALERT_EMAILS ? process.env.ALERT_EMAILS.split(',') : [],
      slackWebhook: process.env.SLACK_WEBHOOK_URL,
      cooldownMinutes: parseInt(process.env.ALERT_COOLDOWN_MINUTES) || 30,
      maxAlertsPerHour: parseInt(process.env.MAX_ALERTS_PER_HOUR) || 10
    };
    
    this.alertCounts = {
      hourly: 0,
      lastReset: Date.now()
    };
    
    this.loadAlertHistory();
  }

  // Load alert history from file
  loadAlertHistory() {
    try {
      const historyPath = path.join(__dirname, 'alert-history.json');
      if (fs.existsSync(historyPath)) {
        const data = fs.readFileSync(historyPath, 'utf8');
        this.alertHistory = JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading alert history:', error.message);
    }
  }

  // Save alert history to file
  saveAlertHistory() {
    try {
      const historyPath = path.join(__dirname, 'alert-history.json');
      // Keep only last 1000 alerts
      const recentAlerts = this.alertHistory.slice(-1000);
      fs.writeFileSync(historyPath, JSON.stringify(recentAlerts, null, 2));
    } catch (error) {
      console.error('Error saving alert history:', error.message);
    }
  }

  // Check if we should send an alert (cooldown and rate limiting)
  shouldSendAlert(alertType, severity = 'medium') {
    if (!this.alertConfig.enabled) return false;

    // Reset hourly counter if needed
    if (Date.now() - this.alertCounts.lastReset > 3600000) { // 1 hour
      this.alertCounts.hourly = 0;
      this.alertCounts.lastReset = Date.now();
    }

    // Check rate limiting
    if (this.alertCounts.hourly >= this.alertConfig.maxAlertsPerHour) {
      return false;
    }

    // Check cooldown for this specific alert type
    const lastAlert = this.alertHistory
      .filter(alert => alert.type === alertType)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

    if (lastAlert) {
      const timeSinceLastAlert = Date.now() - new Date(lastAlert.timestamp).getTime();
      const cooldownMs = this.alertConfig.cooldownMinutes * 60 * 1000;
      
      if (timeSinceLastAlert < cooldownMs) {
        return false;
      }
    }

    return true;
  }

  // Send email alert
  async sendEmailAlert(alert) {
    if (!this.alertConfig.emailRecipients.length) return;

    try {
      const defaultClient = sib.ApiClient.instance;
      const apiKey = defaultClient.authentications['api-key'];
      apiKey.apiKey = process.env.BREVO_API_KEY;

      const apiInstance = new sib.TransactionalEmailsApi();
      
      const emailContent = this.generateEmailContent(alert);
      
      await apiInstance.sendTransacEmail({
        sender: { 
          email: process.env.EMAIL_FROM || 'alerts@cyanfinance.com', 
          name: 'Cyan Finance Alerts' 
        },
        to: this.alertConfig.emailRecipients.map(email => ({ email })),
        subject: `🚨 Cyan Finance Alert: ${alert.title}`,
        htmlContent: emailContent
      });

      console.log(`Email alert sent to ${this.alertConfig.emailRecipients.length} recipients`);
    } catch (error) {
      console.error('Error sending email alert:', error.message);
    }
  }

  // Send Slack alert
  async sendSlackAlert(alert) {
    if (!this.alertConfig.slackWebhook) return;

    try {
      const slackMessage = this.generateSlackMessage(alert);
      
      const response = await fetch(this.alertConfig.slackWebhook, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackMessage)
      });

      if (response.ok) {
        console.log('Slack alert sent successfully');
      } else {
        console.error('Failed to send Slack alert:', response.statusText);
      }
    } catch (error) {
      console.error('Error sending Slack alert:', error.message);
    }
  }

  // Generate email content
  generateEmailContent(alert) {
    const severityColor = {
      low: '#ffa500',
      medium: '#ff6b35',
      high: '#ff0000',
      critical: '#8b0000'
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .alert { border-left: 4px solid ${severityColor[alert.severity]}; padding: 15px; margin: 10px 0; background-color: #f9f9f9; }
          .header { background-color: #333; color: white; padding: 10px; }
          .details { margin: 10px 0; }
          .timestamp { color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>🚨 Cyan Finance System Alert</h2>
        </div>
        
        <div class="alert">
          <h3>${alert.title}</h3>
          <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
          <p><strong>Type:</strong> ${alert.type}</p>
          <div class="details">
            <p><strong>Description:</strong></p>
            <p>${alert.description}</p>
          </div>
          ${alert.details ? `<div class="details"><p><strong>Details:</strong></p><pre>${JSON.stringify(alert.details, null, 2)}</pre></div>` : ''}
          <p class="timestamp">Alert Time: ${new Date(alert.timestamp).toLocaleString()}</p>
        </div>
        
        <p>This is an automated alert from the Cyan Finance monitoring system.</p>
      </body>
      </html>
    `;
  }

  // Generate Slack message
  generateSlackMessage(alert) {
    const severityEmoji = {
      low: '🟡',
      medium: '🟠',
      high: '🔴',
      critical: '🚨'
    };

    return {
      text: `${severityEmoji[alert.severity]} *Cyan Finance Alert: ${alert.title}*`,
      attachments: [{
        color: alert.severity === 'critical' ? '#ff0000' : 
               alert.severity === 'high' ? '#ff6b35' : 
               alert.severity === 'medium' ? '#ffa500' : '#ffff00',
        fields: [
          {
            title: 'Severity',
            value: alert.severity.toUpperCase(),
            short: true
          },
          {
            title: 'Type',
            value: alert.type,
            short: true
          },
          {
            title: 'Description',
            value: alert.description,
            short: false
          },
          {
            title: 'Timestamp',
            value: new Date(alert.timestamp).toLocaleString(),
            short: true
          }
        ],
        footer: 'Cyan Finance Monitoring System'
      }]
    };
  }

  // Send alert
  async sendAlert(alert) {
    if (!this.shouldSendAlert(alert.type, alert.severity)) {
      console.log(`Alert suppressed: ${alert.title} (cooldown or rate limit)`);
      return;
    }

    // Add to history
    this.alertHistory.push(alert);
    this.alertCounts.hourly++;
    this.saveAlertHistory();

    // Send notifications
    await Promise.all([
      this.sendEmailAlert(alert),
      this.sendSlackAlert(alert)
    ]);

    console.log(`Alert sent: ${alert.title}`);
  }

  // Create and send health check alert
  async sendHealthAlert(healthStatus) {
    const failedChecks = Object.entries(healthStatus.checks)
      .filter(([key, check]) => check.status !== 'healthy')
      .map(([key, check]) => ({ key, ...check }));

    if (failedChecks.length === 0) return;

    const alert = {
      type: 'health_check',
      severity: failedChecks.length > 2 ? 'critical' : 'high',
      title: `Health Check Failed - ${failedChecks.length} component(s) unhealthy`,
      description: `The following system components are reporting unhealthy status: ${failedChecks.map(c => c.key).join(', ')}`,
      details: {
        failedChecks,
        system: healthStatus.system,
        uptime: healthStatus.uptime
      },
      timestamp: new Date().toISOString()
    };

    await this.sendAlert(alert);
  }

  // Create and send database alert
  async sendDatabaseAlert(error) {
    const alert = {
      type: 'database',
      severity: 'critical',
      title: 'Database Connection Issue',
      description: 'Unable to connect to the database or perform operations',
      details: {
        error: error.message,
        stack: error.stack
      },
      timestamp: new Date().toISOString()
    };

    await this.sendAlert(alert);
  }

  // Create and send memory alert
  async sendMemoryAlert(memoryUsage) {
    const alert = {
      type: 'memory',
      severity: memoryUsage > 95 ? 'critical' : 'high',
      title: `High Memory Usage: ${memoryUsage.toFixed(1)}%`,
      description: `System memory usage is critically high and may impact performance`,
      details: {
        usagePercent: memoryUsage,
        threshold: 90
      },
      timestamp: new Date().toISOString()
    };

    await this.sendAlert(alert);
  }

  // Create and send API alert
  async sendAPIAlert(responseTime) {
    const alert = {
      type: 'api_performance',
      severity: responseTime > 5000 ? 'critical' : 'medium',
      title: `Slow API Response: ${responseTime}ms`,
      description: `API response time is significantly slower than expected`,
      details: {
        responseTime,
        threshold: 1000
      },
      timestamp: new Date().toISOString()
    };

    await this.sendAlert(alert);
  }

  // Get alert statistics
  getAlertStats() {
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    const last7d = now - (7 * 24 * 60 * 60 * 1000);

    const alerts24h = this.alertHistory.filter(alert => 
      new Date(alert.timestamp).getTime() > last24h
    );
    const alerts7d = this.alertHistory.filter(alert => 
      new Date(alert.timestamp).getTime() > last7d
    );

    return {
      total: this.alertHistory.length,
      last24h: alerts24h.length,
      last7d: alerts7d.length,
      bySeverity: {
        critical: this.alertHistory.filter(a => a.severity === 'critical').length,
        high: this.alertHistory.filter(a => a.severity === 'high').length,
        medium: this.alertHistory.filter(a => a.severity === 'medium').length,
        low: this.alertHistory.filter(a => a.severity === 'low').length
      },
      byType: this.alertHistory.reduce((acc, alert) => {
        acc[alert.type] = (acc[alert.type] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

module.exports = AlertingSystem;
