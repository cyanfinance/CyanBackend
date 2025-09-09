# 🔐 Dual-Channel Notification System Setup Guide

## 🎯 Overview

This guide explains how to set up and use the dual-channel notification system for Cyan Finance, which sends OTPs, payment reminders, and updates via both **SMS** and **Email** simultaneously.

## ✨ Key Features

- **Dual-Channel Delivery**: OTPs sent via both SMS and Email
- **Same OTP Value**: Both channels receive identical OTP codes
- **DLT Compliance**: SMS service configured for Indian regulations
- **Multiple SMS Providers**: Support for MSG91 and Twilio
- **Comprehensive Tracking**: Monitor delivery status for both channels
- **Fallback Support**: System works even if one channel fails

## 🚀 Quick Setup

### 1. **Install Dependencies**
```bash
npm install axios
```

### 2. **Configure Environment Variables**
Copy `.env.example` to `.env` and configure:

```bash
# SMS Service Configuration (DLT Compliant)
SMS_PROVIDER=msg91
SMS_API_KEY=your_msg91_api_key_here
SMS_SENDER_ID=your_sender_id_here
SMS_BASE_URL=https://api.msg91.com/api/v5/flow/

# Template IDs for Different Purposes
SMS_LOGIN_TEMPLATE_ID=your_login_template_id_here
SMS_LOGIN_HEADER_ID=your_login_header_id_here

SMS_PAYMENT_TEMPLATE_ID=your_payment_template_id_here
SMS_PAYMENT_HEADER_ID=your_payment_header_id_here

SMS_PASSWORD_TEMPLATE_ID=your_password_template_id_here
SMS_PASSWORD_HEADER_ID=your_password_header_id_here

SMS_REMINDER_TEMPLATE_ID=your_reminder_template_id_here
SMS_REMINDER_HEADER_ID=your_reminder_header_id_here

SMS_UPDATE_TEMPLATE_ID=your_update_template_id_here
SMS_UPDATE_HEADER_ID=your_update_header_id_here

SMS_LOAN_TEMPLATE_ID=your_loan_template_id_here
SMS_LOAN_HEADER_ID=your_loan_header_id_here

# Company Information
COMPANY_NAME=Cyan Finance

# Email Service (Brevo)
BREVO_API_KEY=your_brevo_api_key_here
BREVO_SENDER_EMAIL=your_sender_email@domain.com
BREVO_SENDER_NAME=Your Company Name
```

### 3. **DLT Registration (Required for India)**
- Register with TRAI for DLT compliance
- Get sender ID approved
- Create message templates for each purpose
- Get template IDs and header IDs approved
- Configure MSG91 account

### 4. **Template Management**
Run the template checker script to validate your configuration:

```bash
node scripts/checkTemplates.js
```

This will show you:
- Which templates are configured
- Which ones are missing
- MSG91 compatibility status
- Required environment variables

## 📱 SMS Provider Setup

### **MSG91 (Recommended for India)**

1. **Create Account**
   - Sign up at [MSG91.com](https://msg91.com)
   - Complete KYC verification
   - Get API key from dashboard

2. **DLT Setup**
   - Register sender ID (e.g., "CYANFI")
   - Create message templates for each purpose
   - Get template IDs approved

3. **Template Examples**
   ```
   Login OTP: Your {{company_name}} login OTP is {{otp}}. Valid for {{expiry_time}} minutes.
   Payment Verification: Your {{company_name}} payment verification OTP for ₹{{amount}} is {{otp}}. Valid for {{expiry_time}} minutes.
   Payment Reminder: Dear {{customer_name}}, your {{company_name}} payment of ₹{{amount}} is due on {{due_date}}. Loan ID: {{loan_id}}
   Payment Update: Dear {{customer_name}}, your {{company_name}} payment of ₹{{amount}} has been {{status}} successfully. TXN ID: {{transaction_id}}
   Loan Creation: Dear {{customer_name}}, your {{company_name}} loan of ₹{{amount}} has been created successfully. Loan ID: {{loan_id}}, EMI: ₹{{emi_amount}}
   ```

4. **Template Configuration**
   Each template needs:
   - **Template ID**: Unique identifier from MSG91
   - **Header ID**: Optional header identifier for DLT compliance
   - **Variables**: Dynamic content placeholders
   - **Approval**: Must be approved by TRAI

### **Twilio (Alternative)**

```bash
# Environment variables
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=your_twilio_number

# Update .env
SMS_PROVIDER=twilio
```



## 🔑 OTP System Usage

### **1. Send Login OTP**
```javascript
// Frontend request
POST /auth/send-login-otp
{
  "identifier": "user@email.com" // or phone number
}

// Response
{
  "success": true,
  "message": "OTP sent via both email and SMS",
  "channels": {
    "email": true,
    "sms": true
  },
  "expiresAt": "2025-08-22T15:30:00.000Z"
}
```

### **2. Send Payment Verification OTP**
```javascript
// Frontend request
POST /auth/send-payment-otp
{
  "identifier": "user@email.com",
  "purpose": "payment_verification",
  "customerId": "customer_id_here"
}

// Response
{
  "success": true,
  "message": "OTP sent via both email and SMS",
  "channels": {
    "email": true,
    "sms": true
  },
  "purpose": "payment_verification",
  "expiresAt": "2025-08-22T15:30:00.000Z"
}
```

### **3. Verify OTP**
```javascript
// Frontend request
POST /auth/verify-payment-otp
{
  "identifier": "user@email.com",
  "otp": "123456",
  "purpose": "payment_verification"
}

// Response
{
  "success": true,
  "message": "Payment OTP verified successfully.",
  "verifiedVia": "both",
  "purpose": "payment_verification",
  "customerId": "customer_id_here"
}
```

## 💰 Payment Notifications

### **Payment Reminders**
```javascript
const paymentNotificationService = require('./utils/paymentNotificationService');

const customerData = {
  name: "John Doe",
  email: "john@example.com",
  primaryMobile: "9876543210"
};

const paymentData = {
  amount: 5000,
  dueDate: "2025-08-25",
  loanId: "LOAN123"
};

const result = await paymentNotificationService.sendPaymentReminder(
  customerData, 
  paymentData
);

console.log(result);
// {
//   email: { success: true, messageId: "email_123" },
//   sms: { success: true, messageId: "sms_456" },
//   overall: { success: true, message: "Sent via both channels" }
// }
```

### **Payment Updates**
```javascript
const paymentData = {
  amount: 5000,
  status: "processed",
  transactionId: "TXN789"
};

const result = await paymentNotificationService.sendPaymentUpdate(
  customerData, 
  paymentData
);
```

### **Loan Creation Notifications**
```javascript
const loanData = {
  amount: 100000,
  interestRate: 12.5,
  tenure: 24,
  emiAmount: 4720,
  loanId: "LOAN456"
};

const result = await paymentNotificationService.sendLoanCreationNotification(
  customerData, 
  loanData
);
```

## 📊 Bulk Operations

### **Send Bulk Payment Reminders**
```javascript
const customers = [
  { _id: "1", name: "John", email: "john@example.com", primaryMobile: "9876543210" },
  { _id: "2", name: "Jane", email: "jane@example.com", primaryMobile: "9876543211" }
];

const paymentData = {
  amount: 5000,
  dueDate: "2025-08-25"
};

const results = await paymentNotificationService.sendBulkPaymentReminders(
  customers, 
  paymentData
);

// Get statistics
const stats = paymentNotificationService.getNotificationStats(results);
console.log(stats);
// {
//   total: 2,
//   successful: 2,
//   failed: 0,
//   emailSuccess: 2,
//   smsSuccess: 2,
//   bothSuccess: 2,
//   partialSuccess: 0
// }
```

## 🔍 Monitoring & Tracking

### **OTP Delivery Status**
```javascript
// Check SMS delivery status
const smsStatus = await smsService.checkDeliveryStatus(messageId);

// Check email delivery status (via Brevo dashboard)
// Brevo provides delivery tracking in their dashboard
```

### **Notification Logs**
```javascript
// OTP records include delivery tracking
const otpRecord = await Otp.findById(otpId);
console.log({
  emailSent: otpRecord.emailSent,
  emailSentAt: otpRecord.emailSentAt,
  smsSent: otpRecord.smsSent,
  smsSentAt: otpRecord.smsSentAt,
  verifiedAt: otpRecord.verifiedAt,
  verifiedVia: otpRecord.verifiedVia
});
```

## 🛡️ Security Features

### **OTP Security**
- **6-digit OTPs**: Secure random generation
- **10-minute expiry**: Short validity period
- **Attempt limiting**: Maximum 3 verification attempts
- **One-time use**: OTPs deleted after verification
- **Rate limiting**: Prevents spam OTP requests

### **Data Protection**
- **No OTP storage**: OTPs not logged in plain text
- **Encrypted transmission**: HTTPS for all API calls
- **DLT compliance**: Regulatory compliance for SMS
- **Audit trail**: Complete delivery tracking

## 🚨 Troubleshooting

### **Common Issues**

1. **SMS Not Sending**
   ```bash
   # Check environment variables
   echo $SMS_API_KEY
   echo $SMS_PROVIDER
   
   # Check SMS service logs
   console.log('SMS service status:', smsService.provider);
   ```

2. **Email Not Sending**
   ```bash
   # Check Brevo configuration
   echo $BREVO_API_KEY
   echo $BREVO_SENDER_EMAIL
   
   # Verify Brevo account status
   ```

3. **DLT Issues**
   - Ensure sender ID is approved
   - Check template approval status
   - Verify MSG91 account status

4. **Phone Number Format**
   ```javascript
   // Supported formats
   "9876543210"     // 10 digits (auto-adds +91)
   "+919876543210"  // With country code
   "919876543210"   // Without + symbol
   ```

### **Testing**

1. **Test SMS Service**
   ```javascript
   const testResult = await smsService.sendOTP(
     "9876543210", 
     "123456", 
     "test"
   );
   console.log('SMS test result:', testResult);
   ```

2. **Test Email Service**
   ```javascript
   const emailResult = await sendOtpEmail(
     "test@example.com", 
     "123456", 
     "test"
   );
   console.log('Email test result:', emailResult);
   ```

3. **Test Dual-Channel**
   ```javascript
   const dualResult = await smsService.sendDualChannelOTP(
     { email: "test@example.com", primaryMobile: "9876543210" },
     "123456",
     "test",
     sendOtpEmail
   );
   console.log('Dual-channel result:', dualResult);
   ```

## 📈 Performance Optimization

### **Best Practices**

1. **Parallel Processing**
   ```javascript
   // Send SMS and email simultaneously
   const [smsResult, emailResult] = await Promise.all([
     smsService.sendOTP(phone, otp, purpose),
     sendOtpEmail(email, otp, purpose)
   ]);
   ```

2. **Bulk Operations**
   ```javascript
   // Use bulk operations for multiple customers
   const results = await paymentNotificationService.sendBulkPaymentReminders(
     customers, 
     paymentData
   );
   ```

3. **Caching**
   ```javascript
   // Cache frequently used data
   const customerCache = new Map();
   // Implement caching strategy
   ```

## 🔄 Integration Examples

### **Frontend Integration**

```javascript
// React component example
const sendOTP = async (identifier) => {
  try {
    const response = await fetch('/auth/send-login-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier })
    });
    
    const result = await response.json();
    
    if (result.success) {
      setMessage(`OTP sent via ${result.channels.email ? 'email' : ''}${result.channels.email && result.channels.sms ? ' and ' : ''}${result.channels.sms ? 'SMS' : ''}`);
    }
  } catch (error) {
    console.error('Error sending OTP:', error);
  }
};
```

### **Cron Job Integration**

```javascript
// scripts/sendPaymentReminders.js
const cron = require('node-cron');
const paymentNotificationService = require('../utils/paymentNotificationService');

// Send payment reminders daily at 9 AM
cron.schedule('0 9 * * *', async () => {
  try {
    const customers = await getCustomersWithDuePayments();
    const paymentData = { dueDate: new Date() };
    
    const results = await paymentNotificationService.sendBulkPaymentReminders(
      customers, 
      paymentData
    );
    
    console.log('Payment reminders sent:', results.length);
  } catch (error) {
    console.error('Payment reminder cron job failed:', error);
  }
});
```

## 📋 API Reference

### **Authentication Routes**

| Route | Method | Description |
|-------|--------|-------------|
| `/auth/send-login-otp` | POST | Send login OTP via both channels |
| `/auth/send-payment-otp` | POST | Send payment verification OTP |
| `/auth/verify-payment-otp` | POST | Verify payment OTP |
| `/auth/forgot-password` | POST | Send password reset OTP |

### **SMS Service Methods**

| Method | Description |
|--------|-------------|
| `sendOTP(phone, otp, purpose)` | Send OTP via SMS (MSG91/Twilio) |
| `sendPaymentReminder(phone, data)` | Send payment reminder SMS |
| `sendPaymentUpdate(phone, data)` | Send payment update SMS |
| `sendDualChannelOTP(userData, otp, purpose, emailFn)` | Send via both channels |

### **Payment Notification Service**

| Method | Description |
|--------|-------------|
| `sendPaymentReminder(customer, payment)` | Send payment reminder via both channels |
| `sendPaymentUpdate(customer, payment)` | Send payment update via both channels |
| `sendLoanCreationNotification(customer, loan)` | Send loan creation notification |
| `sendBulkPaymentReminders(customers, payment)` | Send bulk reminders |

## 🎯 Next Steps

1. ✅ **Configure SMS provider** (MSG91 recommended for India)
2. ✅ **Set up DLT compliance** (required for Indian SMS)
3. ✅ **Test dual-channel delivery** with sample OTPs
4. ✅ **Integrate with frontend** for user experience
5. ✅ **Set up monitoring** and alerting
6. ✅ **Configure cron jobs** for automated reminders

## 📞 Support

For technical support:
1. Check environment variable configuration
2. Verify SMS provider account status
3. Test individual services separately
4. Review server logs for error details
5. Check DLT compliance status

---

**Remember: Security first! Never expose API keys or sensitive configuration.**
