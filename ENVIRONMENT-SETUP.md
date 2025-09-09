# 🔐 Environment Variables Setup Guide

## ⚠️ Security Warning
**NEVER commit your `.env` file to Git!** It contains sensitive information like database passwords, API keys, and secrets that could compromise your application's security.

## 🚀 Quick Setup

1. **Copy the example file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit the `.env` file** with your actual values:
   ```bash
   # Use your preferred text editor
   notepad .env
   # or
   code .env
   ```

3. **Restart your application** after making changes

## 📋 Required Environment Variables

### 🔧 Server Configuration
```bash
PORT=5000                    # Port your server runs on
NODE_ENV=development         # Environment (development/production)
```

### 🗄️ Database Configuration
```bash
MONGODB_URI=mongodb://localhost:27017/cyan_finance
# For production, use your MongoDB Atlas connection string:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/cyan_finance
```

### 🔑 JWT Authentication
```bash
JWT_SECRET=your_super_secret_random_string_here
JWT_EXPIRE=24h              # Token expiration time
```

### 📧 Email Service (Brevo/Sendinblue)
```bash
BREVO_API_KEY=your_brevo_api_key_here
BREVO_SENDER_EMAIL=your_sender_email@domain.com
BREVO_SENDER_NAME=Your Company Name
```

### 📱 SMS Service Configuration
```bash
# Primary SMS Provider (MSG91)
SMS_PROVIDER=msg91
SMS_API_KEY=your_sms_api_key_here
SMS_SENDER_ID=your_sender_id_here
SMS_BASE_URL=https://api.msg91.com/api/v5/flow/

# Alternative SMS Provider (Fast2SMS with JioTrueConnect DLT)
FAST2SMS_API_KEY=your_fast2sms_api_key_here
FAST2SMS_BASE_URL=https://www.fast2sms.com/dev/bulkV2
```

### 💳 Payment Gateway (if applicable)
```bash
PAYMENT_API_KEY=your_payment_api_key_here
PAYMENT_SECRET_KEY=your_payment_secret_key_here
```

### 📁 File Storage (if applicable)
```bash
STORAGE_BUCKET=your_storage_bucket_name
STORAGE_ACCESS_KEY=your_storage_access_key
STORAGE_SECRET_KEY=your_storage_secret_key
```

### 📊 Monitoring & Alerts
```bash
SLACK_WEBHOOK_URL=your_slack_webhook_url_here
ALERT_EMAIL=alerts@yourcompany.com
```

### 🛡️ Security Settings
```bash
BCRYPT_ROUNDS=12            # Password hashing strength
RATE_LIMIT_WINDOW=15        # Rate limiting window in minutes
RATE_LIMIT_MAX_REQUESTS=100 # Max requests per window
```

### 🌐 External Services (Optional)
```bash
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
SMS_API_KEY=your_sms_api_key_here
```

## 🔒 Security Best Practices

### 1. **Generate Strong Secrets**
- Use a password generator for JWT_SECRET
- Make it at least 32 characters long
- Include uppercase, lowercase, numbers, and symbols

### 2. **Use Different Values for Different Environments**
- Development: Use local/development values
- Staging: Use staging environment values
- Production: Use production environment values

### 3. **Never Share or Commit**
- `.env` files should never be committed to Git
- Don't share `.env` files in emails or chat
- Use secure methods to share production credentials

### 4. **Regular Rotation**
- Rotate API keys regularly
- Update JWT secrets periodically
- Monitor for any unauthorized access

## 🚨 Troubleshooting

### Common Issues:

1. **"Cannot find module 'dotenv'"**
   ```bash
   npm install dotenv
   ```

2. **"Environment variable not defined"**
   - Check if the variable is in your `.env` file
   - Ensure no spaces around the `=` sign
   - Restart your application after changes

3. **"Invalid MongoDB URI"**
   - Check your connection string format
   - Verify username/password are correct
   - Ensure network access is allowed

4. **"JWT_SECRET is not defined"**
   - Generate a new secret string
   - Add it to your `.env` file
   - Restart the application

## 📱 Production Deployment

### 1. **Environment Variables on Hosting Platforms**

#### Heroku:
```bash
heroku config:set MONGODB_URI=your_production_mongodb_uri
heroku config:set JWT_SECRET=your_production_jwt_secret
```

#### Vercel:
- Add environment variables in the Vercel dashboard
- Go to Project Settings → Environment Variables

#### Railway:
- Add environment variables in the Railway dashboard
- Go to Variables tab

#### DigitalOcean App Platform:
- Add environment variables in the App Spec
- Or use the DigitalOcean dashboard

### 2. **Docker Deployment**
```dockerfile
# In your Dockerfile
ENV NODE_ENV=production
ENV PORT=5000

# Pass other variables at runtime
docker run -e MONGODB_URI=your_uri -e JWT_SECRET=your_secret your-app
```

## 🔍 Verification

After setting up your environment variables:

1. **Check if they're loaded:**
   ```javascript
   console.log('MongoDB URI:', process.env.MONGODB_URI);
   console.log('JWT Secret:', process.env.JWT_SECRET ? 'Set' : 'Not set');
   ```

2. **Test database connection:**
   - Start your application
   - Check if it connects to the database
   - Look for any error messages

3. **Test authentication:**
   - Try to create a user account
   - Test login functionality
   - Verify JWT tokens are generated

## 📞 Support

If you encounter issues:

1. **Check the logs** for specific error messages
2. **Verify all required variables** are set
3. **Ensure no typos** in variable names
4. **Restart the application** after changes
5. **Check file permissions** on the `.env` file

## 🎯 Next Steps

1. ✅ Set up your `.env` file
2. ✅ Test your application
3. ✅ Deploy to production
4. ✅ Monitor for any issues
5. ✅ Set up monitoring and alerting

---

**Remember: Security first! Never expose your environment variables.**

