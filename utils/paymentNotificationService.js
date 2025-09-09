const smsService = require('./smsService');
const { sendPaymentReminderEmail, sendPaymentUpdateEmail } = require('./brevo');

/**
 * Payment Notification Service
 * Handles dual-channel payment notifications (SMS + Email)
 */

class PaymentNotificationService {
  constructor() {
    this.companyName = process.env.COMPANY_NAME || 'Cyan Finance';
  }

  /**
   * Send payment reminder via both SMS and email
   * @param {Object} customerData - Customer information
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Object>} - Delivery results
   */
  async sendPaymentReminder(customerData, paymentData) {
    try {
      const results = {
        email: { success: false, error: null },
        sms: { success: false, error: null },
        overall: { success: false, message: '' }
      };

      // Send email reminder
      if (customerData.email) {
        try {
          const emailResult = await sendPaymentReminderEmail(
            customerData.email,
            customerData.name,
            paymentData
          );
          results.email = emailResult;
        } catch (error) {
          results.email.error = error.message;
        }
      }

      // Send SMS reminder
      if (customerData.primaryMobile) {
        try {
          const smsResult = await smsService.sendPaymentReminder(
            customerData.primaryMobile,
            paymentData
          );
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
          message: 'Payment reminder sent successfully via both email and SMS'
        };
      } else if (emailSuccess || smsSuccess) {
        results.overall = {
          success: true,
          message: `Payment reminder sent via ${emailSuccess ? 'email' : 'SMS'} only`
        };
      } else {
        results.overall = {
          success: false,
          message: 'Failed to send payment reminder via both channels'
        };
      }

      return results;

    } catch (error) {
      console.error('Payment reminder sending failed:', error);
      return {
        email: { success: false, error: error.message },
        sms: { success: false, error: error.message },
        overall: { success: false, message: 'Payment reminder sending failed' }
      };
    }
  }

  /**
   * Send payment update notification via both SMS and email
   * @param {Object} customerData - Customer information
   * @param {Object} paymentData - Payment update details
   * @returns {Promise<Object>} - Delivery results
   */
  async sendPaymentUpdate(customerData, paymentData) {
    try {
      const results = {
        email: { success: false, error: null },
        sms: { success: false, error: null },
        overall: { success: false, message: '' }
      };

      // Send email update
      if (customerData.email) {
        try {
          const emailResult = await sendPaymentUpdateEmail(
            customerData.email,
            customerData.name,
            paymentData
          );
          results.email = emailResult;
        } catch (error) {
          results.email.error = error.message;
        }
      }

      // Send SMS update
      if (customerData.primaryMobile) {
        try {
          const smsResult = await smsService.sendPaymentUpdate(
            customerData.primaryMobile,
            paymentData
          );
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
          message: 'Payment update sent successfully via both email and SMS'
        };
      } else if (emailSuccess || smsSuccess) {
        results.overall = {
          success: true,
          message: `Payment update sent via ${emailSuccess ? 'email' : 'SMS'} only`
        };
      } else {
        results.overall = {
          success: false,
          message: 'Failed to send payment update via both channels'
        };
      }

      return results;

    } catch (error) {
      console.error('Payment update sending failed:', error);
      return {
        email: { success: false, error: error.message },
        sms: { success: false, error: error.message },
        overall: { success: false, message: 'Payment update sending failed' }
      };
    }
  }

  /**
   * Send loan creation notification via both SMS and email
   * @param {Object} customerData - Customer information
   * @param {Object} loanData - Loan details
   * @returns {Promise<Object>} - Delivery results
   */
  async sendLoanCreationNotification(customerData, loanData) {
    try {
      const results = {
        email: { success: false, error: null },
        sms: { success: false, error: null },
        overall: { success: false, message: '' }
      };

      // Send email notification
      if (customerData.email) {
        try {
          const emailResult = await this.sendLoanCreationEmail(
            customerData.email,
            customerData.name,
            loanData
          );
          results.email = emailResult;
        } catch (error) {
          results.email.error = error.message;
        }
      }

      // Send SMS notification
      if (customerData.primaryMobile) {
        try {
          const smsResult = await this.sendLoanCreationSMS(
            customerData.primaryMobile,
            customerData.name,
            loanData
          );
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
          message: 'Loan creation notification sent successfully via both email and SMS'
        };
      } else if (emailSuccess || smsSuccess) {
        results.overall = {
          success: true,
          message: `Loan creation notification sent via ${emailSuccess ? 'email' : 'SMS'} only`
        };
      } else {
        results.overall = {
          success: false,
          message: 'Failed to send loan creation notification via both channels'
        };
      }

      return results;

    } catch (error) {
      console.error('Loan creation notification failed:', error);
      return {
        email: { success: false, error: error.message },
        sms: { success: false, error: error.message },
        overall: { success: false, message: 'Loan creation notification failed' }
      };
    }
  }

  /**
   * Send loan creation email
   * @param {string} email - Customer email
   * @param {string} name - Customer name
   * @param {Object} loanData - Loan details
   * @returns {Promise<Object>} - Email result
   */
  async sendLoanCreationEmail(email, name, loanData) {
    try {
      const subject = `Loan Created Successfully - ${this.companyName}`;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2c3e50;">Loan Created Successfully</h2>
          <p>Dear ${name},</p>
          <p>Your loan has been created successfully with the following details:</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="color: #34495e; margin-top: 0;">Loan Details</h3>
            <p><strong>Loan Amount:</strong> ₹${loanData.amount}</p>
            <p><strong>Interest Rate:</strong> ${loanData.interestRate}%</p>
            <p><strong>Tenure:</strong> ${loanData.tenure} months</p>
            <p><strong>EMI Amount:</strong> ₹${loanData.emiAmount}</p>
            <p><strong>Loan ID:</strong> ${loanData.loanId}</p>
          </div>
          <p>You will receive further instructions via email and SMS.</p>
          <p>Thank you for choosing ${this.companyName}!</p>
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #ecf0f1;">
          <p style="color: #7f8c8d; font-size: 12px;">
            This is an automated message. Please do not reply to this email.
          </p>
        </div>
      `;

      // Use Brevo to send email
      const sib = require('sib-api-v3-sdk');
      const apiInstance = new sib.TransactionalEmailsApi();
      
      const result = await apiInstance.sendTransacEmail({
        sender: { 
          email: process.env.BREVO_SENDER_EMAIL || 'noreply@cyanfinance.com', 
          name: this.companyName 
        },
        to: [{ email }],
        subject,
        htmlContent
      });

      return {
        success: true,
        messageId: result.messageId || 'email_sent'
      };

    } catch (error) {
      console.error('Loan creation email failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send loan creation SMS
   * @param {string} phoneNumber - Customer phone number
   * @param {string} name - Customer name
   * @param {Object} loanData - Loan details
   * @returns {Promise<Object>} - SMS result
   */
  async sendLoanCreationSMS(phoneNumber, name, loanData) {
    try {
      const paymentData = {
        customerName: name,
        amount: loanData.amount,
        loanId: loanData.loanId,
        type: 'loan_creation'
      };

      // Use the payment update method which supports custom messages
      const result = await smsService.sendPaymentUpdate(phoneNumber, paymentData);
      
      if (result.success) {
        return {
          success: true,
          messageId: result.messageId,
          message: 'Loan creation SMS sent successfully'
        };
      }

      return result;

    } catch (error) {
      console.error('Loan creation SMS failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Send bulk payment reminders
   * @param {Array} customers - Array of customer data
   * @param {Object} paymentData - Payment details
   * @returns {Promise<Array>} - Results for each customer
   */
  async sendBulkPaymentReminders(customers, paymentData) {
    const results = [];
    
    for (const customer of customers) {
      try {
        const result = await this.sendPaymentReminder(customer, paymentData);
        results.push({
          customerId: customer._id,
          customerName: customer.name,
          ...result
        });
      } catch (error) {
        results.push({
          customerId: customer._id,
          customerName: customer.name,
          email: { success: false, error: error.message },
          sms: { success: false, error: error.message },
          overall: { success: false, message: 'Failed to send reminder' }
        });
      }
    }
    
    return results;
  }

  /**
   * Get notification statistics
   * @param {Array} results - Array of notification results
   * @returns {Object} - Statistics summary
   */
  getNotificationStats(results) {
    const stats = {
      total: results.length,
      successful: 0,
      failed: 0,
      emailSuccess: 0,
      smsSuccess: 0,
      bothSuccess: 0,
      partialSuccess: 0
    };

    results.forEach(result => {
      if (result.overall.success) {
        stats.successful++;
        if (result.email.success && result.sms.success) {
          stats.bothSuccess++;
        } else if (result.email.success || result.sms.success) {
          stats.partialSuccess++;
        }
      } else {
        stats.failed++;
      }

      if (result.email.success) stats.emailSuccess++;
      if (result.sms.success) stats.smsSuccess++;
    });

    return stats;
  }
}

module.exports = new PaymentNotificationService();

