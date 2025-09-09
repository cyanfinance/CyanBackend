/**
 * Template Manager for Cyan Finance SMS Service
 * Manages different template IDs and header IDs for various message purposes
 */

class TemplateManager {
  constructor() {
    this.templates = {
      login: {
        name: 'Login OTP',
        description: 'OTP for user login verification',
        templateId: process.env.SMS_LOGIN_TEMPLATE_ID,
        headerId: process.env.SMS_LOGIN_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_LOGIN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_LOGIN_HEADER_ID,
        variables: ['otp', 'company_name', 'expiry_time'],
        example: 'Your {{company_name}} login OTP is {{otp}}. Valid for {{expiry_time}} minutes.'
      },
      payment_verification: {
        name: 'Payment Verification OTP',
        description: 'OTP for payment verification',
        templateId: process.env.SMS_PAYMENT_TEMPLATE_ID,
        headerId: process.env.SMS_PAYMENT_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_PAYMENT_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_PAYMENT_HEADER_ID,
        variables: ['otp', 'company_name', 'amount', 'expiry_time'],
        example: 'Your {{company_name}} payment verification OTP for ₹{{amount}} is {{otp}}. Valid for {{expiry_time}} minutes.'
      },
      password_reset: {
        name: 'Password Reset OTP',
        description: 'OTP for password reset',
        templateId: process.env.SMS_PASSWORD_TEMPLATE_ID,
        headerId: process.env.SMS_PASSWORD_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_PASSWORD_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_PASSWORD_HEADER_ID,
        variables: ['otp', 'company_name', 'expiry_time'],
        example: 'Your {{company_name}} password reset OTP is {{otp}}. Valid for {{expiry_time}} minutes.'
      },
      payment_reminder: {
        name: 'Payment Reminder',
        description: 'Payment due reminder notification',
        templateId: process.env.SMS_REMINDER_TEMPLATE_ID,
        headerId: process.env.SMS_REMINDER_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_REMINDER_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_REMINDER_HEADER_ID,
        variables: ['customer_name', 'amount', 'due_date', 'loan_id'],
        example: 'Dear {{customer_name}}, your {{company_name}} payment of ₹{{amount}} is due on {{due_date}}. Loan ID: {{loan_id}}'
      },
      payment_update: {
        name: 'Payment Update',
        description: 'Payment status update notification',
        templateId: process.env.SMS_UPDATE_TEMPLATE_ID,
        headerId: process.env.SMS_UPDATE_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_UPDATE_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_UPDATE_HEADER_ID,
        variables: ['customer_name', 'amount', 'status', 'transaction_id'],
        example: 'Dear {{customer_name}}, your {{company_name}} payment of ₹{{amount}} has been {{status}} successfully. TXN ID: {{transaction_id}}'
      },
      loan_creation: {
        name: 'Loan Creation',
        description: 'Loan creation confirmation',
        templateId: process.env.SMS_LOAN_TEMPLATE_ID,
        headerId: process.env.SMS_LOAN_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_LOAN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_LOAN_HEADER_ID,
        variables: ['customer_name', 'amount', 'loan_id', 'emi_amount'],
        example: 'Dear {{customer_name}}, your {{company_name}} loan of ₹{{amount}} has been created successfully. Loan ID: {{loan_id}}, EMI: ₹{{emi_amount}}'
      }
    };
  }

  /**
   * Get template configuration for a specific purpose
   * @param {string} purpose - Purpose of the message
   * @returns {Object|null} - Template configuration or null if not found
   */
  getTemplate(purpose) {
    return this.templates[purpose] || null;
  }

  /**
   * Get all available templates
   * @returns {Object} - All template configurations
   */
  getAllTemplates() {
    return this.templates;
  }

  /**
   * Check if template is configured for a purpose
   * @param {string} purpose - Purpose of the message
   * @returns {boolean} - True if template is configured
   */
  isTemplateConfigured(purpose) {
    const template = this.templates[purpose];
    return template && template.templateId;
  }

  /**
   * Validate all template configurations
   * @returns {Object} - Validation results
   */
  validateTemplates() {
    const results = {
      summary: {
        total: Object.keys(this.templates).length,
        configured: 0,
        missing: 0,
        withHeaderId: 0
      },
      details: {}
    };

    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      const configured = !!(template && template.templateId);
      const hasHeaderId = !!(template && template.headerId);
      
      results.details[purpose] = {
        name: template.name,
        configured,
        templateId: template.templateId || null,
        headerId: template.headerId || null,
        hasHeaderId,
        status: configured ? 'configured' : 'missing',
        variables: template.variables || []
      };

      if (configured) {
        results.summary.configured++;
        if (hasHeaderId) results.summary.withHeaderId++;
      } else {
        results.summary.missing++;
      }
    });

    return results;
  }

  /**
   * Get template status summary
   * @returns {Object} - Summary of template status
   */
  getTemplateStatus() {
    const validation = this.validateTemplates();
    return {
      status: validation.summary.missing === 0 ? 'complete' : 'incomplete',
      message: validation.summary.missing === 0 
        ? 'All templates are configured' 
        : `${validation.summary.missing} templates are missing`,
      summary: validation.summary
    };
  }

  /**
   * Get missing template configurations
   * @returns {Array} - Array of missing template purposes
   */
  getMissingTemplates() {
    const missing = [];
    Object.keys(this.templates).forEach(purpose => {
      if (!this.isTemplateConfigured(purpose)) {
        missing.push({
          purpose,
          name: this.templates[purpose].name,
          description: this.templates[purpose].description
        });
      }
    });
    return missing;
  }

  /**
   * Get template variables for a specific purpose
   * @param {string} purpose - Purpose of the message
   * @returns {Array} - Array of variable names
   */
  getTemplateVariables(purpose) {
    const template = this.templates[purpose];
    return template ? template.variables : [];
  }

  /**
   * Get template example for a specific purpose
   * @param {string} purpose - Purpose of the message
   * @returns {string|null} - Template example or null if not found
   */
  getTemplateExample(purpose) {
    const template = this.templates[purpose];
    return template ? template.example : null;
  }

  /**
   * Generate environment variable configuration
   * @returns {string} - Environment variable configuration text
   */
  generateEnvConfig() {
    let config = '# SMS Template Configuration\n';
    config += '# Copy these to your .env file\n\n';
    
    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      config += `# ${template.name}\n`;
      config += `# ${template.description}\n`;
      config += `SMS_${purpose.toUpperCase()}_TEMPLATE_ID=your_${purpose}_template_id_here\n`;
      config += `SMS_${purpose.toUpperCase()}_HEADER_ID=your_${purpose}_header_id_here\n\n`;
    });
    
    return config;
  }

  /**
   * Generate MSG91 template configuration guide
   * @returns {string} - Template configuration guide
   */
  generateMSG91Guide() {
    let guide = '# MSG91 Template Configuration Guide\n\n';
    
    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      guide += `## ${template.name}\n`;
      guide += `**Purpose:** ${template.description}\n\n`;
      guide += `**Template Example:**\n`;
      guide += `\`\`\`\n${template.example}\n\`\`\`\n\n`;
      guide += `**Variables:** ${template.variables.join(', ')}\n\n`;
      guide += `**Environment Variables:**\n`;
      guide += `- Template ID: \`SMS_${purpose.toUpperCase()}_TEMPLATE_ID\`\n`;
      guide += `- Header ID: \`SMS_${purpose.toUpperCase()}_HEADER_ID\`\n\n`;
      guide += `---\n\n`;
    });
    
    return guide;
  }

  /**
   * Check template compatibility with MSG91
   * @returns {Object} - Compatibility check results
   */
  checkMSG91Compatibility() {
    const results = {
      compatible: true,
      issues: [],
      recommendations: []
    };

    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      
      if (!template.templateId) {
        results.issues.push(`Missing template ID for ${template.name}`);
        results.compatible = false;
      }
      
      if (template.variables.length > 10) {
        results.issues.push(`Too many variables (${template.variables.length}) for ${template.name}. MSG91 supports max 10 variables.`);
        results.compatible = false;
      }
      
      if (template.example.length > 160) {
        results.issues.push(`Template too long (${template.example.length} chars) for ${template.name}. Keep under 160 characters.`);
        results.recommendations.push(`Shorten template for ${template.name}`);
      }
    });

    if (results.issues.length === 0) {
      results.recommendations.push('All templates are MSG91 compatible');
    }

    return results;
  }

  /**
   * Check template compatibility with Twilio
   * @returns {Object} - Compatibility check results
   */
  checkTwilioCompatibility() {
    const results = {
      compatible: true,
      issues: [],
      recommendations: []
    };

    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      
      if (template.example.length > 1600) {
        results.issues.push(`Template too long (${template.example.length} chars) for ${template.name}. Twilio supports max 1600 characters.`);
        results.compatible = false;
      }
    });

    if (results.issues.length === 0) {
      results.recommendations.push('All templates are Twilio compatible');
    }

    return results;
  }

  /**
   * Export template configuration for external use
   * @returns {Object} - Exportable template configuration
   */
  exportConfiguration() {
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        version: '1.0',
        company: 'Cyan Finance'
      },
      templates: {}
    };

    Object.keys(this.templates).forEach(purpose => {
      const template = this.templates[purpose];
      exportData.templates[purpose] = {
        name: template.name,
        description: template.description,
        templateId: template.templateId,
        headerId: template.headerId,
        variables: template.variables,
        example: template.example,
        configured: !!template.templateId
      };
    });

    return exportData;
  }
}

module.exports = new TemplateManager();
