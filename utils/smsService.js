const axios = require('axios');

/**
 * SMS Service for Cyan Finance
 * Supports multiple SMS providers with DLT compliance
 */

class SMSService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || 'msg91'; // msg91, twilio, fast2sms, etc.
    this.apiKey = process.env.SMS_API_KEY;
    this.senderId = process.env.SMS_SENDER_ID;
    this.baseUrl = process.env.SMS_BASE_URL;
    
    // Fast2SMS specific configuration
    this.fast2smsApiKey = process.env.FAST2SMS_API_KEY;
    this.fast2smsBaseUrl = process.env.FAST2SMS_BASE_URL || 'https://www.fast2sms.com/dev/bulkV2';
    
    // Multiple template IDs for different purposes
    this.templates = {
      login: {
        templateId: process.env.SMS_LOGIN_TEMPLATE_ID,
        headerId: process.env.SMS_LOGIN_HEADER_ID,
        // Fast2SMS DLT template configuration
        fast2smsTemplateId: process.env.FAST2SMS_LOGIN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_LOGIN_HEADER_ID
      },
      payment_verification: {
        templateId: process.env.SMS_PAYMENT_TEMPLATE_ID,
        headerId: process.env.SMS_PAYMENT_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_PAYMENT_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_PAYMENT_HEADER_ID
      },
      password_reset: {
        templateId: process.env.SMS_PASSWORD_TEMPLATE_ID,
        headerId: process.env.SMS_PASSWORD_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_PASSWORD_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_PASSWORD_HEADER_ID
      },
      payment_reminder: {
        templateId: process.env.SMS_REMINDER_TEMPLATE_ID,
        headerId: process.env.SMS_REMINDER_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_REMINDER_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_REMINDER_HEADER_ID
      },
      payment_update: {
        templateId: process.env.SMS_UPDATE_TEMPLATE_ID,
        headerId: process.env.SMS_UPDATE_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_UPDATE_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_UPDATE_HEADER_ID
      },
      loan_creation: {
        templateId: process.env.SMS_LOAN_TEMPLATE_ID,
        headerId: process.env.SMS_LOAN_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_LOAN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_LOAN_HEADER_ID
      },
      // New user/employee registration (first time)
      user_registration: {
        templateId: process.env.SMS_USER_LOGIN_TEMPLATE_ID,
        headerId: process.env.SMS_USER_LOGIN_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_USER_LOGIN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_USER_LOGIN_HEADER_ID
      },
      // Employee registration (first time)
      employee_registration: {
        templateId: process.env.SMS_USER_LOGIN_TEMPLATE_ID,
        headerId: process.env.SMS_USER_LOGIN_HEADER_ID,
        fast2smsTemplateId: process.env.FAST2SMS_USER_LOGIN_TEMPLATE_ID,
        fast2smsHeaderId: process.env.FAST2SMS_USER_LOGIN_HEADER_ID
      }
    };
    
    // Validate configuration
    if (!this.apiKey && !this.fast2smsApiKey) {
      console.warn('SMS_API_KEY or FAST2SMS_API_KEY not configured. SMS functionality will be disabled.');
    }
  }

  /**
   * Send OTP via SMS
   * @param {string} phoneNumber - Phone number with country code
   * @param {string} otp - 6-digit OTP
   * @param {string} purpose - Purpose of OTP (login, payment, etc.)
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendOTP(phoneNumber, otp, purpose = 'verification') {
    try {
      // Skip SMS in development mode to avoid charges, EXCEPT for loan creation
      const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
      const isLoanCreation = purpose === 'loan_creation' || purpose === 'customer_registration';
      
      if (isDevelopment && !isLoanCreation) {
        console.log('🚧 Development mode: SMS OTP skipped to avoid charges (except for loan creation)');
        return {
          success: false,
          message: 'SMS disabled in development mode',
          messageId: 'dev_mode_skip',
          provider: 'development_mode'
        };
      }
      
      // Check if any SMS provider is configured
      if (!this.apiKey && !this.fast2smsApiKey) {
        throw new Error('SMS service not configured');
      }
      
      // Check if current provider is configured
      if (this.provider.toLowerCase() === 'fast2sms' && !this.fast2smsApiKey) {
        throw new Error('Fast2SMS API key not configured');
      }
      if (this.provider.toLowerCase() !== 'fast2sms' && !this.apiKey) {
        throw new Error('SMS API key not configured for current provider');
      }

      // Validate phone number
      const validatedPhone = this.validatePhoneNumber(phoneNumber);
      if (!validatedPhone) {
        throw new Error('Invalid phone number format');
      }

      // Create message content based on purpose
      const message = this.createOTPMessage(otp, purpose);
      
      // Send SMS based on provider
      let result;
             switch (this.provider.toLowerCase()) {
         case 'msg91':
           result = await this.sendViaMsg91(validatedPhone, message, purpose);
           break;
         case 'twilio':
           result = await this.sendViaTwilio(validatedPhone, message);
           break;
         case 'fast2sms':
           result = await this.sendViaFast2SMS(validatedPhone, message, purpose);
           break;
         default:
           throw new Error(`Unsupported SMS provider: ${this.provider}. Supported providers: msg91, twilio, fast2sms`);
       }

      console.log(`SMS OTP sent to ${validatedPhone} for ${purpose}:`, result);
      return {
        success: true,
        messageId: result.messageId || result.sid || result.MessageId,
        provider: this.provider,
        phoneNumber: validatedPhone,
        purpose
      };

    } catch (error) {
      console.error('SMS OTP sending failed:', error);
      return {
        success: false,
        error: error.message,
        phoneNumber,
        purpose
      };
    }
  }

  /**
   * Send payment reminder via SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} paymentData - Payment information
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendPaymentReminder(phoneNumber, paymentData) {
    try {
      // Check if any SMS provider is configured
      if (!this.apiKey && !this.fast2smsApiKey) {
        throw new Error('SMS service not configured');
      }
      
      // Check if current provider is configured
      if (this.provider.toLowerCase() === 'fast2sms' && !this.fast2smsApiKey) {
        throw new Error('Fast2SMS API key not configured');
      }
      if (this.provider.toLowerCase() !== 'fast2sms' && !this.apiKey) {
        throw new Error('SMS API key not configured for current provider');
      }

      const validatedPhone = this.validatePhoneNumber(phoneNumber);
      if (!validatedPhone) {
        throw new Error('Invalid phone number format');
      }

      const message = this.createPaymentReminderMessage(paymentData);
      
      let result;
             switch (this.provider.toLowerCase()) {
         case 'msg91':
           result = await this.sendViaMsg91(validatedPhone, message, 'payment_reminder');
           break;
         case 'twilio':
           result = await this.sendViaTwilio(validatedPhone, message);
           break;
         case 'fast2sms':
           result = await this.sendViaFast2SMS(validatedPhone, message, 'payment_reminder');
           break;
         default:
           throw new Error(`Unsupported SMS provider: ${this.provider}. Supported providers: msg91, twilio, fast2sms`);
       }

      console.log(`Payment reminder SMS sent to ${validatedPhone}:`, result);
      return {
        success: true,
        messageId: result.messageId || result.sid || result.MessageId,
        provider: this.provider,
        phoneNumber: validatedPhone,
        type: 'payment_reminder'
      };

    } catch (error) {
      console.error('Payment reminder SMS failed:', error);
      return {
        success: false,
        error: error.message,
        phoneNumber,
        type: 'payment_reminder'
      };
    }
  }

  /**
   * Send payment update notification via SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} paymentData - Payment update information
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendPaymentUpdate(phoneNumber, paymentData) {
    try {
      // Check if any SMS provider is configured
      if (!this.apiKey && !this.fast2smsApiKey) {
        throw new Error('SMS service not configured');
      }
      
      // Check if current provider is configured
      if (this.provider.toLowerCase() === 'fast2sms' && !this.fast2smsApiKey) {
        throw new Error('Fast2SMS API key not configured');
      }
      if (this.provider.toLowerCase() !== 'fast2sms' && !this.apiKey) {
        throw new Error('SMS API key not configured for current provider');
      }

      const validatedPhone = this.validatePhoneNumber(phoneNumber);
      if (!validatedPhone) {
        throw new Error('Invalid phone number format');
      }

      const message = this.createPaymentUpdateMessage(paymentData);
      
      let result;
             switch (this.provider.toLowerCase()) {
         case 'msg91':
           result = await this.sendViaMsg91(validatedPhone, message, 'payment_update');
           break;
         case 'twilio':
           result = await this.sendViaTwilio(validatedPhone, message);
           break;
         case 'fast2sms':
           result = await this.sendViaFast2SMS(validatedPhone, message, 'payment_update');
           break;
         default:
           throw new Error(`Unsupported SMS provider: ${this.provider}. Supported providers: msg91, twilio, fast2sms`);
       }

      console.log(`Payment update SMS sent to ${validatedPhone}:`, result);
      return {
        success: true,
        messageId: result.messageId || result.sid || result.MessageId,
        provider: this.provider,
        phoneNumber: validatedPhone,
        type: 'payment_update'
      };

    } catch (error) {
      console.error('Payment update SMS failed:', error);
      return {
        success: false,
        error: error.message,
        phoneNumber,
        type: 'payment_update'
      };
    }
  }

  /**
   * Send dual-channel notification (SMS + Email)
   * @param {Object} userData - User information with email and phone
   * @param {string} otp - OTP to send
   * @param {string} purpose - Purpose of OTP
   * @param {Function} emailFunction - Function to send email
   * @returns {Promise<Object>} - Combined delivery results
   */
  async sendDualChannelOTP(userData, otp, purpose, emailFunction) {
    try {
      const results = {
        email: { success: false, error: null },
        sms: { success: false, error: null },
        overall: { success: false, message: '' }
      };

      // Send email
      if (userData.email && emailFunction) {
        try {
          const emailResult = await emailFunction(userData.email, otp, purpose);
          results.email = emailResult;
        } catch (error) {
          results.email.error = error.message;
        }
      }

      // Send SMS (will be automatically skipped in development mode by sendOTP method)
      if (userData.primaryMobile) {
        try {
          const smsResult = await this.sendOTP(userData.primaryMobile, otp, purpose);
          results.sms = smsResult;
        } catch (error) {
          results.sms.error = error.message;
        }
      }

      // Determine overall success
      const emailSuccess = results.email.success;
      const smsSuccess = results.sms.success;
      
      if (emailSuccess && smsSuccess) {
        results.overall = {
          success: true,
          message: 'OTP sent successfully via both email and SMS'
        };
      } else if (emailSuccess || smsSuccess) {
        results.overall = {
          success: true,
          message: `OTP sent via ${emailSuccess ? 'email' : 'SMS'} only`
        };
      } else {
        results.overall = {
          success: false,
          message: 'Failed to send OTP via both channels'
        };
      }

      return results;

    } catch (error) {
      console.error('Dual-channel OTP sending failed:', error);
      return {
        email: { success: false, error: error.message },
        sms: { success: false, error: error.message },
        overall: { success: false, message: 'Dual-channel sending failed' }
      };
    }
  }

  /**
   * Send OTP for new user registration (first time)
   * @param {string} phoneNumber - Phone number with country code
   * @param {string} otp - 6-digit OTP
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendNewUserOTP(phoneNumber, otp) {
    return await this.sendOTP(phoneNumber, otp, 'user_registration');
  }

  /**
   * Send OTP for new employee registration (first time)
   * @param {string} phoneNumber - Phone number with country code
   * @param {string} otp - 6-digit OTP
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendNewEmployeeOTP(phoneNumber, otp) {
    return await this.sendOTP(phoneNumber, otp, 'employee_registration');
  }

  /**
   * Send OTP for existing user login (not first time)
   * @param {string} phoneNumber - Phone number with country code
   * @param {string} otp - 6-digit OTP
   * @returns {Promise<Object>} - SMS delivery result
   */
  async sendExistingUserOTP(phoneNumber, otp) {
    return await this.sendOTP(phoneNumber, otp, 'login');
  }

  // Private helper methods

  /**
   * Validate and format phone number
   * @param {string} phoneNumber - Raw phone number
   * @returns {string|null} - Formatted phone number or null if invalid
   */
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle Indian numbers (10 digits + 91 country code)
    if (cleaned.length === 10) {
      cleaned = '91' + cleaned;
    } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
      // Already has country code
    } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
      // Remove leading 0 and add 91
      cleaned = '91' + cleaned.substring(1);
    } else if (cleaned.length < 10 || cleaned.length > 15) {
      return null; // Invalid length
    }
    
    return '+' + cleaned;
  }

  /**
   * Create OTP message content
   * @param {string} otp - 6-digit OTP
   * @param {string} purpose - Purpose of OTP
   * @returns {string} - Formatted message
   */
  createOTPMessage(otp, purpose) {
    const companyName = process.env.COMPANY_NAME || 'Cyan Finance';
    
    switch (purpose) {
      case 'login':
        return `Your ${companyName} login OTP is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
      case 'payment_verification':
        return `Your ${companyName} payment verification OTP is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
      case 'password_reset':
        return `Your ${companyName} password reset OTP is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
      default:
        return `Your ${companyName} verification OTP is ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
    }
  }

  /**
   * Create payment reminder message
   * @param {Object} paymentData - Payment information
   * @returns {string} - Formatted message
   */
  createPaymentReminderMessage(paymentData) {
    const companyName = process.env.COMPANY_NAME || 'Cyan Finance';
    const amount = paymentData.amount || 'your payment';
    const dueDate = paymentData.dueDate || 'the due date';
    
    return `Dear ${paymentData.customerName || 'Customer'}, your ${companyName} payment of ₹${amount} is due on ${dueDate}. Please make the payment to avoid any late fees.`;
  }

  /**
   * Create payment update message
   * @param {Object} paymentData - Payment update information
   * @returns {string} - Formatted message
   */
  createPaymentUpdateMessage(paymentData) {
    const companyName = process.env.COMPANY_NAME || 'Cyan Finance';
    const amount = paymentData.amount || 'your payment';
    const status = paymentData.status || 'processed';
    
    return `Dear ${paymentData.customerName || 'Customer'}, your ${companyName} payment of ₹${amount} has been ${status} successfully. Thank you for your business.`;
  }

  // Provider-specific implementations

  /**
   * Send SMS via MSG91 (DLT compliant)
   * @param {string} phoneNumber - Phone number
   * @param {string} message - Message content
   * @param {string} purpose - Purpose for DLT compliance
   * @returns {Promise<Object>} - API response
   */
  async sendViaMsg91(phoneNumber, message, purpose) {
    const url = this.baseUrl || 'https://api.msg91.com/api/v5/flow/';
    
    // Get template configuration for the specific purpose
    const templateConfig = this.templates[purpose];
    if (!templateConfig || !templateConfig.templateId) {
      throw new Error(`Template ID not configured for purpose: ${purpose}`);
    }
    
    const payload = {
      flow_id: templateConfig.templateId,
      sender: this.senderId,
      mobiles: phoneNumber.replace('+', ''),
      VAR1: message, // OTP or message content
      VAR2: purpose, // Purpose for DLT compliance
      VAR3: new Date().toISOString() // Timestamp
    };

    // Add header ID if configured
    if (templateConfig.headerId) {
      payload.header_id = templateConfig.headerId;
    }

    const response = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authkey': this.apiKey
      }
    });

    return response.data;
  }

  /**
   * Send SMS via Twilio
   * @param {string} phoneNumber - Phone number
   * @param {string} message - Message content
   * @returns {Promise<Object>} - API response
   */
  async sendViaTwilio(phoneNumber, message) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      throw new Error('Twilio credentials not configured');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    
    const payload = new URLSearchParams({
      To: phoneNumber,
      From: fromNumber,
      Body: message
    });

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data;
  }

  /**
   * Send SMS via Fast2SMS with DLT compliance
   * @param {string} phoneNumber - Phone number
   * @param {string} message - Message content
   * @param {string} purpose - Purpose for DLT compliance
   * @returns {Promise<Object>} - API response
   */
  async sendViaFast2SMS(phoneNumber, message, purpose) {
    try {
      if (!this.fast2smsApiKey) {
        throw new Error('Fast2SMS API key not configured');
      }

      // Get template configuration for the specific purpose
      const templateConfig = this.templates[purpose];
      if (!templateConfig || !templateConfig.fast2smsTemplateId) {
        throw new Error(`Fast2SMS template ID not configured for purpose: ${purpose}`);
      }

      // Determine route based on purpose (t for transactional, p for promotional)
      const route = this.getRouteForPurpose(purpose);
      
      // Format phone number for Fast2SMS (remove + and country code if needed)
      const formattedPhone = this.formatPhoneForFast2SMS(phoneNumber);

      // Use DLT route with correct Fast2SMS format (from Excel sheet)
      const payload = new URLSearchParams({
        sender_id: templateConfig.fast2smsHeaderId || this.senderId, // CYANGR
        message: templateConfig.fast2smsTemplateId, // Use template ID as message parameter
        variables_values: message, // OTP value as variable
        route: 'dlt', // DLT route
        numbers: formattedPhone
      });

      const response = await axios.post(this.fast2smsBaseUrl, payload, {
        headers: {
          'authorization': this.fast2smsApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000 // 30 second timeout
      });

      // Check if the response indicates success
      if (response.data && response.data.return === false) {
        throw new Error(`Fast2SMS API error: ${response.data.message || 'Unknown error'}`);
      }

      return response.data;
    } catch (error) {
      if (error.response) {
        // API responded with error status
        const errorMessage = error.response.data?.message || error.response.statusText || 'API request failed';
        throw new Error(`Fast2SMS API error (${error.response.status}): ${errorMessage}`);
      } else if (error.request) {
        // Request was made but no response received
        throw new Error('Fast2SMS API request failed: No response received');
      } else {
        // Something else happened
        throw new Error(`Fast2SMS API error: ${error.message}`);
      }
    }
  }

  /**
   * Get route type for Fast2SMS based on purpose
   * @param {string} purpose - Purpose of the message
   * @returns {string} - Route type (t for transactional, p for promotional)
   */
  getRouteForPurpose(purpose) {
    const transactionalPurposes = [
      'login',
      'payment_verification', 
      'password_reset',
      'payment_reminder',
      'payment_update',
      'loan_creation'
    ];
    
    return transactionalPurposes.includes(purpose) ? 't' : 'p';
  }

  /**
   * Format phone number for Fast2SMS API
   * @param {string} phoneNumber - Phone number with country code
   * @returns {string} - Formatted phone number
   */
  formatPhoneForFast2SMS(phoneNumber) {
    // Remove + and country code for Indian numbers
    let cleaned = phoneNumber.replace('+', '');
    
    // If it starts with 91 (India), remove it for Fast2SMS
    if (cleaned.startsWith('91') && cleaned.length === 12) {
      cleaned = cleaned.substring(2);
    }
    
    return cleaned;
  }

  /**
   * Check SMS delivery status
   * @param {string} messageId - Message ID from send operation
   * @returns {Promise<Object>} - Delivery status
   */
  async checkDeliveryStatus(messageId) {
    try {
      switch (this.provider.toLowerCase()) {
        case 'msg91':
          return await this.checkMsg91Status(messageId);
        case 'twilio':
          return await this.checkTwilioStatus(messageId);
        case 'fast2sms':
          return await this.checkFast2SMSStatus(messageId);
        default:
          throw new Error(`Unsupported provider: ${this.provider}. Supported providers: msg91, twilio, fast2sms`);
      }
    } catch (error) {
      console.error('Error checking delivery status:', error);
      return { status: 'unknown', error: error.message };
    }
  }

  async checkMsg91Status(messageId) {
    const url = `https://api.msg91.com/api/v5/flow/status/${messageId}`;
    const response = await axios.get(url, {
      headers: { 'Authkey': this.apiKey }
    });
    return response.data;
  }

  async checkTwilioStatus(messageId) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageId}.json`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
      }
    });
    return response.data;
  }

  async checkFast2SMSStatus(messageId) {
    try {
      const url = `https://www.fast2sms.com/dev/report`;
      const response = await axios.get(url, {
        headers: {
          'authorization': this.fast2smsApiKey
        },
        params: {
          id: messageId
        },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error('Error checking Fast2SMS status:', error);
      return { status: 'unknown', error: error.message };
    }
  }



  /**
   * Get template configuration for a specific purpose
   * @param {string} purpose - Purpose of the message
   * @returns {Object|null} - Template configuration or null if not found
   */
  getTemplateConfig(purpose) {
    return this.templates[purpose] || null;
  }

  /**
   * Get all available template configurations
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
    const config = this.templates[purpose];
    if (this.provider.toLowerCase() === 'fast2sms') {
      return config && config.fast2smsTemplateId;
    }
    return config && config.templateId;
  }

  /**
   * Validate all template configurations
   * @returns {Object} - Validation results
   */
  validateTemplates() {
    const results = {};
    const purposes = Object.keys(this.templates);
    
    purposes.forEach(purpose => {
      const config = this.templates[purpose];
      const isFast2SMS = this.provider.toLowerCase() === 'fast2sms';
      
      results[purpose] = {
        configured: !!(config && (isFast2SMS ? config.fast2smsTemplateId : config.templateId)),
        templateId: isFast2SMS ? (config?.fast2smsTemplateId || null) : (config?.templateId || null),
        headerId: isFast2SMS ? (config?.fast2smsHeaderId || null) : (config?.headerId || null),
        status: config && (isFast2SMS ? config.fast2smsTemplateId : config.templateId) ? 'configured' : 'missing',
        provider: this.provider
      };
    });
    
    return results;
  }
}

module.exports = new SMSService();
