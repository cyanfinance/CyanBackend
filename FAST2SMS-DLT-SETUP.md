# 🚀 Fast2SMS + JioTrueConnect DLT Integration Guide

## 📋 Overview

This guide explains how to integrate Fast2SMS API with JioTrueConnect DLT (Distributed Ledger Technology) for compliant SMS messaging in India. This integration ensures your SMS messages comply with TRAI regulations.

## ✨ Key Features

- **DLT Compliance**: Full compliance with Indian TRAI regulations
- **JioTrueConnect Integration**: Seamless integration with Jio's DLT platform
- **Template Management**: Pre-approved message templates for different purposes
- **Header Management**: Approved sender IDs for brand recognition
- **Dual Provider Support**: Switch between MSG91 and Fast2SMS as needed

## 🚀 Quick Setup

### 1. **Register on JioTrueConnect DLT Platform**

#### Step 1: Entity Registration
1. Visit [JioTrueConnect DLT Platform](https://trueconnect.jio.com/)
2. Register your business entity with required documents:
   - Company registration certificate
   - PAN card
   - GST certificate (if applicable)
   - Business authorization letter
3. Wait for approval (typically 2-3 working days)

#### Step 2: Header Registration
1. Login to your Jio DLT account
2. Navigate to "Header SMS" → "SMS Registration"
3. Choose header type:
   - **Transactional/Service**: For OTPs, payment confirmations
   - **Promotional**: For marketing messages
4. Create a 6-character sender ID (e.g., "CYANFI")
5. Submit for approval (3-7 working days)

#### Step 3: Template Registration
1. Go to "Template" → "Content Template Registration"
2. Fill template details:
   - **Template Type**: Transactional/Service or Promotional
   - **Category**: Select relevant business category
   - **Header**: Choose your approved header
   - **Template Name**: Unique name for the template
   - **Template Content**: Message with variables

**Example Templates:**

**Login OTP:**
```
Dear {#var#}, your Cyan Finance login OTP is {#var#}. Valid for 10 minutes. Do not share with anyone.
```

**Payment Reminder:**
```
Dear {#var#}, your payment of ₹{#var#} is due on {#var#}. Please pay to avoid late fees. - Cyan Finance
```

**Payment Confirmation:**
```
Dear {#var#}, your payment of ₹{#var#} has been processed successfully. Thank you! - Cyan Finance
```

### 2. **Fast2SMS Account Setup**

1. **Create Account**: Visit [Fast2SMS](https://www.fast2sms.com/)
2. **Get API Key**: 
   - Login to your account
   - Go to "Dev API" section
   - Generate your API key
3. **Add Balance**: Recharge your account for SMS credits

### 3. **Environment Configuration**

Update your `.env` file with the following variables:

```bash
# SMS Provider Selection
SMS_PROVIDER=fast2sms

# Fast2SMS Configuration
FAST2SMS_API_KEY=your_fast2sms_api_key_here
FAST2SMS_BASE_URL=https://www.fast2sms.com/dev/bulkV2

# Fast2SMS DLT Template IDs (from JioTrueConnect)
FAST2SMS_LOGIN_TEMPLATE_ID=your_approved_login_template_id
FAST2SMS_LOGIN_HEADER_ID=your_approved_login_header_id

FAST2SMS_PAYMENT_TEMPLATE_ID=your_approved_payment_template_id
FAST2SMS_PAYMENT_HEADER_ID=your_approved_payment_header_id

FAST2SMS_PASSWORD_TEMPLATE_ID=your_approved_password_template_id
FAST2SMS_PASSWORD_HEADER_ID=your_approved_password_header_id

FAST2SMS_REMINDER_TEMPLATE_ID=your_approved_reminder_template_id
FAST2SMS_REMINDER_HEADER_ID=your_approved_reminder_header_id

FAST2SMS_UPDATE_TEMPLATE_ID=your_approved_update_template_id
FAST2SMS_UPDATE_HEADER_ID=your_approved_update_header_id

FAST2SMS_LOAN_TEMPLATE_ID=your_approved_loan_template_id
FAST2SMS_LOAN_HEADER_ID=your_approved_loan_header_id
```

## 🔧 API Integration

### Basic Usage

```javascript
const smsService = require('./utils/smsService');

// Send OTP
const result = await smsService.sendOTP('+919876543210', '123456', 'login');

// Send payment reminder
const reminderResult = await smsService.sendPaymentReminder('+919876543210', {
  customerName: 'John Doe',
  amount: '5000',
  dueDate: '2024-01-15'
});
```

### API Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `sender_id` | Approved header ID from DLT | "CYANFI" |
| `message` | Message content matching approved template | "Dear John, your OTP is 123456..." |
| `language` | Message language | "english" |
| `route` | Message route (t=transactional, p=promotional) | "t" |
| `numbers` | Recipient phone number (without country code) | "9876543210" |
| `template_id` | Approved template ID from DLT | "1234567890" |

## 📊 Template Management

### Supported Message Types

1. **Login OTP**: User authentication
2. **Payment Verification**: Payment confirmation OTPs
3. **Password Reset**: Password reset OTPs
4. **Payment Reminder**: Due payment notifications
5. **Payment Update**: Payment status updates
6. **Loan Creation**: New loan notifications

### Template Variables

Use `{#var#}` placeholders in your DLT templates:

```javascript
// Template: "Dear {#var#}, your OTP is {#var#}."
// Usage: Variables will be replaced in order
const message = "Dear John, your OTP is 123456.";
```

## 🔍 Delivery Status Checking

```javascript
// Check delivery status
const status = await smsService.checkDeliveryStatus(messageId);
console.log('Delivery Status:', status);
```

## 🛠️ Testing

### Test SMS Sending

```javascript
// Test with your own number first
const testResult = await smsService.sendOTP('+919876543210', '123456', 'login');
console.log('Test Result:', testResult);
```

### Validate Template Configuration

```javascript
// Check if all templates are configured
const validation = smsService.validateTemplates();
console.log('Template Validation:', validation);
```

## 📋 Best Practices

### 1. **Template Compliance**
- Always use approved templates from DLT
- Don't modify template content without re-approval
- Use proper variable placeholders

### 2. **Message Routing**
- Use 't' (transactional) for OTPs and confirmations
- Use 'p' (promotional) for marketing messages
- Ensure proper categorization

### 3. **Error Handling**
```javascript
try {
  const result = await smsService.sendOTP(phone, otp, 'login');
  if (result.success) {
    console.log('SMS sent successfully');
  } else {
    console.error('SMS failed:', result.error);
  }
} catch (error) {
  console.error('SMS service error:', error.message);
}
```

### 4. **Rate Limiting**
- Respect API rate limits
- Implement proper queuing for bulk messages
- Monitor your account balance

## 🚨 Troubleshooting

### Common Issues

1. **Template Not Found**
   - Verify template ID is correct
   - Ensure template is approved in DLT
   - Check template ID in environment variables

2. **Header Not Approved**
   - Verify header ID is approved
   - Check header ID in environment variables
   - Ensure header matches template registration

3. **Message Rejected**
   - Verify message content matches approved template
   - Check for proper variable usage
   - Ensure route type is correct

4. **API Key Issues**
   - Verify API key is correct
   - Check account balance
   - Ensure API key has proper permissions

### Debug Mode

Enable debug logging:

```javascript
// Add to your .env file
DEBUG_SMS=true
```

## 📞 Support

### Fast2SMS Support
- **Website**: [https://www.fast2sms.com/](https://www.fast2sms.com/)
- **Documentation**: [Fast2SMS API Docs](https://www.fast2sms.com/dev/api)
- **Support**: Contact through their support portal

### JioTrueConnect DLT Support
- **Platform**: [https://trueconnect.jio.com/](https://trueconnect.jio.com/)
- **Support**: Use the support section in your DLT account

## 🔄 Switching Between Providers

To switch between MSG91 and Fast2SMS:

```bash
# For MSG91
SMS_PROVIDER=msg91

# For Fast2SMS
SMS_PROVIDER=fast2sms
```

The system will automatically use the appropriate templates and configuration based on the selected provider.

## 📈 Monitoring and Analytics

### Delivery Reports
- Check Fast2SMS dashboard for delivery reports
- Monitor success/failure rates
- Track message costs

### DLT Compliance
- Regular audit of message content
- Ensure all templates remain approved
- Monitor for any policy changes

---

**Remember**: Always test with your own number before going live, and ensure all templates are properly approved in the DLT system.
