# 🏦 Cyan Finance Backend

A comprehensive backend system for financial services with dual-channel notifications, DLT-compliant SMS, and advanced loan management.

## ✨ Features

- **🔐 Authentication & Authorization**: JWT-based auth with role-based access control
- **📱 Dual-Channel Notifications**: SMS + Email notifications with OTP verification
- **📧 Email Service**: Brevo/Sendinblue integration for transactional emails
- **📲 SMS Service**: Multi-provider SMS with DLT compliance (MSG91, Fast2SMS, Twilio)
- **🏦 Loan Management**: Complete loan lifecycle management
- **👥 User Management**: Admin, employee, and customer management
- **📊 Monitoring**: Health checks, alerting, and performance monitoring
- **🔒 Security**: Rate limiting, input validation, and secure data handling

## 🚀 Quick Start

### Prerequisites

- Node.js 18.x or higher
- MongoDB 5.0+ (or MongoDB Atlas)
- SMTP service (Brevo/Sendinblue)
- SMS service (MSG91, Fast2SMS, or Twilio)

### Installation

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd cyan-finance-backend-main
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

4. **Create Admin User**
   ```bash
   node scripts/createAdmin.js
   ```

## 📋 Environment Configuration

### Required Variables

```bash
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/cyan_finance

# Authentication
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRE=24h

# Email Service (Brevo)
BREVO_API_KEY=your_brevo_api_key_here
BREVO_SENDER_EMAIL=your_sender_email@domain.com
BREVO_SENDER_NAME=Your Company Name

# SMS Service (Choose one)
SMS_PROVIDER=msg91  # or fast2sms, twilio
SMS_API_KEY=your_sms_api_key_here
SMS_SENDER_ID=your_sender_id_here
```

### SMS Provider Options

#### MSG91 (Recommended for India)
```bash
SMS_PROVIDER=msg91
SMS_API_KEY=your_msg91_api_key
SMS_BASE_URL=https://api.msg91.com/api/v5/flow/
```

#### Fast2SMS with JioTrueConnect DLT
```bash
SMS_PROVIDER=fast2sms
FAST2SMS_API_KEY=your_fast2sms_api_key
FAST2SMS_BASE_URL=https://www.fast2sms.com/dev/bulkV2
```

#### Twilio (International)
```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=your_twilio_phone_number
```

## 📱 SMS Integration

### Fast2SMS + JioTrueConnect DLT

For DLT-compliant SMS in India, use Fast2SMS with JioTrueConnect:

1. **Register on JioTrueConnect DLT Platform**
   - Visit [trueconnect.jio.com](https://trueconnect.jio.com/)
   - Register your business entity
   - Get headers and templates approved

2. **Configure Fast2SMS**
   - Create account at [fast2sms.com](https://www.fast2sms.com/)
   - Get API key from Dev API section
   - Configure DLT template IDs

3. **Test Integration**
   ```bash
   node scripts/testFast2SMS.js
   ```

📚 **Detailed Setup Guide**: See [FAST2SMS-DLT-SETUP.md](./FAST2SMS-DLT-SETUP.md)

## 🔧 API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/send-login-otp` - Send login OTP
- `POST /auth/verify-otp` - Verify OTP
- `POST /auth/forgot-password` - Password reset

### Customer Management
- `GET /customers` - List customers
- `POST /customers` - Create customer
- `PUT /customers/:id` - Update customer
- `DELETE /customers/:id` - Delete customer

### Loan Management
- `GET /loans` - List loans
- `POST /loans` - Create loan
- `PUT /loans/:id` - Update loan
- `POST /loans/:id/payments` - Record payment

### Notifications
- `GET /notifications` - List notifications
- `POST /notifications/send` - Send notification
- `PUT /notifications/:id/read` - Mark as read

## 🛠️ Scripts

### Development Scripts
```bash
npm run dev          # Start development server
npm start           # Start production server
npm run build       # Build for production
```

### Utility Scripts
```bash
node scripts/createAdmin.js           # Create admin user
node scripts/testFast2SMS.js          # Test Fast2SMS integration
node scripts/checkTemplates.js        # Validate SMS templates
node scripts/sendPaymentReminders.js  # Send payment reminders
```

## 📊 Monitoring

### Health Checks
- `GET /health` - Basic health check
- `GET /health/detailed` - Detailed system status

### Monitoring Dashboard
- Access monitoring dashboard at `/monitoring`
- View system metrics and alerts
- Monitor SMS/Email delivery rates

## 🔒 Security Features

- **Rate Limiting**: Prevents API abuse
- **Input Validation**: Comprehensive request validation
- **JWT Authentication**: Secure token-based auth
- **Role-Based Access**: Admin, employee, customer roles
- **Data Encryption**: Sensitive data encryption
- **CORS Protection**: Cross-origin request security

## 📈 Performance

- **Connection Pooling**: Optimized database connections
- **Caching**: Redis caching for frequently accessed data
- **Compression**: Gzip compression for API responses
- **Monitoring**: Real-time performance monitoring

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Integration Tests
```bash
npm run test:integration
```

### SMS Testing
```bash
node scripts/testFast2SMS.js
```

## 📚 Documentation

- [Environment Setup Guide](./ENVIRONMENT-SETUP.md)
- [Dual-Channel Setup Guide](./DUAL-CHANNEL-SETUP.md)
- [Fast2SMS DLT Setup Guide](./FAST2SMS-DLT-SETUP.md)

## 🚀 Deployment

### Production Deployment
1. Set `NODE_ENV=production`
2. Configure production database
3. Set up SSL certificates
4. Configure reverse proxy (Nginx)
5. Use PM2 for process management

### Docker Deployment
```bash
docker build -t cyan-finance-backend .
docker run -p 5000:5000 cyan-finance-backend
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📞 Support

For technical support:
1. Check the documentation
2. Review environment configuration
3. Check server logs
4. Test individual services
5. Contact the development team

## 📄 License

This project is licensed under the MIT License.

---

**Built with ❤️ for Cyan Finance**
