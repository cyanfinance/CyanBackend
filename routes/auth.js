const express = require('express');
const router = express.Router();

// CORS middleware for auth routes
router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    next();
});
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const Otp = require('../models/Otp');
const sib = require('sib-api-v3-sdk');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const Customer = require('../models/Customer');
const Employee = require('../models/User'); // Assuming employees and admins are in User model
const smsService = require('../utils/smsService');

// Configure Brevo
const defaultClient = sib.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

// Helper to send OTP email
async function sendOtpEmail(email, otp) {
  try {
    const apiInstance = new sib.TransactionalEmailsApi();
    const result = await apiInstance.sendTransacEmail({
      sender: { email: process.env.EMAIL_FROM, name: 'Cyan Finance' },
      to: [{ email }],
      subject: 'Your OTP for Login',
      htmlContent: `<p>Your OTP for Login is: <b>${otp}</b></p>`
    });
    
    return {
      success: true,
      messageId: result.messageId || 'email_sent'
    };
  } catch (error) {
    console.error('Email sending failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper to generate a 6-digit OTP
function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// @route   GET /auth/validate
// @desc    Validate authentication token
router.get('/validate', auth, async (req, res) => {
    try {
        // If we reach here, it means the token is valid (auth middleware passed)
        res.json({ 
            valid: true, 
            user: {
                id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                role: req.user.role
            }
        });
    } catch (err) {
        console.error('Error validating token:', err);
        res.status(401).json({ 
            valid: false, 
            message: 'Invalid token' 
        });
    }
});

// @route   POST /auth/register
// @desc    Register user
router.post('/register', [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, password, role } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create user with role if provided
        const userData = {
            name,
            email,
            password
        };
        
        // Only allow admin role if explicitly provided (for testing purposes)
        if (role && ['admin', 'employee', 'user'].includes(role)) {
            userData.role = role;
        }

        user = await User.create(userData);

        // Create token
        const token = user.getSignedJwtToken();

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/login
// @desc    Login user
router.post('/login', [
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').exists().withMessage('Password is required')
], async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Create token
        const token = user.getSignedJwtToken();

        // Send response with user role
        res.json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                mustResetPassword: user.mustResetPassword
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/register-admin
// @desc    Register admin user (temporary, remove in production)
router.post('/register-admin', [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Please include a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters long')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { name, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create admin user
        user = await User.create({
            name,
            email,
            password,
            role: 'admin' // Set role as admin
        });

        const token = user.getSignedJwtToken();

        res.status(201).json({
            success: true,
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /auth/refresh-token
// @desc    Refresh authentication token
router.post('/refresh-token', auth, async (req, res) => {
  try {
    // Get user from middleware
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate new token
    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error in refresh token:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/forgot-password
// @desc    Send OTP to email for password reset
router.post('/forgot-password', [body('email').isEmail().withMessage('Valid email is required')], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'No user found with this email' });
    }
    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    // Remove any previous unused OTPs for this email/purpose
    await Otp.deleteMany({ email, purpose: 'password_reset' });
    await Otp.create({ email, otp, expiresAt, purpose: 'password_reset', userId: user._id });
    // Send OTP email
    await sendOtpEmail(email, otp);
    res.json({ success: true, message: 'OTP sent to email.' });
  } catch (err) {
    console.error('Error in forgot-password:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/verify-reset-otp
// @desc    Verify OTP for password reset
router.post('/verify-reset-otp', [body('email').isEmail(), body('otp').isLength({ min: 6, max: 6 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, otp } = req.body;
    const otpDoc = await Otp.findOne({ email, otp, purpose: 'password_reset' });
    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    if (otpDoc.expiresAt < new Date()) {
      await otpDoc.deleteOne();
      return res.status(400).json({ message: 'OTP expired' });
    }
    // OTP is valid, delete it to prevent reuse
    await otpDoc.deleteOne();
    res.json({ success: true, message: 'OTP verified. You may reset your password.' });
  } catch (err) {
    console.error('Error verifying reset OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/reset-password
// @desc    Reset password after OTP verification
router.post('/reset-password', [
  body('email').isEmail(),
  body('otp').isLength({ min: 6, max: 6 }),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, otp, newPassword } = req.body;
    const otpDoc = await Otp.findOne({ email, otp, purpose: 'password_reset' });
    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    if (otpDoc.expiresAt < new Date()) {
      await otpDoc.deleteOne();
      return res.status(400).json({ message: 'OTP expired' });
    }
    // OTP is valid, update password
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.password = newPassword;
    await user.save();
    await otpDoc.deleteOne();
    res.json({ success: true, message: 'Password reset successful. You may now log in.' });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/reset-password/first-login
// @desc    Reset password for first login (AUTH-PROTECTED)
router.post('/reset-password/first-login', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('+password');
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters long' });
        }
        user.password = password;
        user.mustResetPassword = false;
        await user.save();
        res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
        console.error('Error resetting password:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Unified OTP Request Endpoint
router.post('/request-otp', [
  body('email').isEmail().withMessage('Please include a valid email')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    let user = await User.findOne({ email });
    let role = null;
    if (user) {
      role = user.role || 'employee'; // default to employee if not set
    } else {
      user = await Customer.findOne({ email });
      if (user) {
        role = 'customer';
      }
    }
    if (!user) {
      return res.status(401).json({ message: 'Email not registered or not authorized' });
    }
    // Generate OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes
    // Save OTP to DB (no userType)
    await Otp.create({ email, otp, expiresAt, purpose: 'login' });
    // Send OTP email
    const emailResult = await sendOtpEmail(email, otp);
    if (emailResult.success) {
      res.json({ success: true, message: 'OTP sent to email', role });
    } else {
      res.status(500).json({ message: 'Failed to send OTP email' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unified OTP Verification Endpoint
router.post('/verify-otp', [
  body('identifier').notEmpty().withMessage('Email or phone number is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { identifier, otp } = req.body;
    
    // Find OTP using the new findValidOTP method
    const otpDoc = await Otp.findValidOTP(identifier, identifier, otp, 'login');
    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }
    
    // Find user by email or phone number
    let user = await User.findOne({
      $or: [
        { email: identifier },
        { primaryMobile: identifier },
        { secondaryMobile: identifier }
      ]
    });
    
    if (!user) {
      // Try to find customer
      user = await Customer.findOne({
        $or: [
          { email: identifier },
          { primaryMobile: identifier },
          { secondaryMobile: identifier }
        ]
      });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Delete OTP after use
    await Otp.deleteOne({ _id: otpDoc._id });
    
    // Create token
    let token;
    let role = user.role || (user instanceof Customer ? 'customer' : 'employee');
    
    if (role === 'customer') {
      const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';
      token = jwt.sign(
        { id: user._id, email: user.email, role: 'customer' },
        jwtSecret,
        { expiresIn: '24h' }
      );
    } else {
      token = user.getSignedJwtToken();
    }
    
    res.json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Resend OTP endpoint with rate limiting
router.post('/resend-otp', [
  body('email').isEmail().withMessage('Please include a valid email')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email } = req.body;
    
    // Check if user exists
    let user = await User.findOne({ email });
    let role = null;
    if (user) {
      role = user.role || 'employee';
    } else {
      user = await Customer.findOne({ email });
      if (user) {
        role = 'customer';
      }
    }
    if (!user) {
      return res.status(401).json({ message: 'Email not registered or not authorized' });
    }
    
    // Check if OTP was sent recently (within 60 seconds)
    const recentOtp = await Otp.findOne({
      email,
      purpose: 'login',
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) } // Within last 60 seconds
    });
    
    if (recentOtp) {
      const timeLeft = Math.ceil((60 * 1000 - (Date.now() - recentOtp.createdAt.getTime())) / 1000);
      return res.status(429).json({ 
        message: `Please wait ${timeLeft} seconds before requesting another OTP`,
        timeLeft
      });
    }
    
    // Delete any existing OTPs for this email
    await Otp.deleteMany({ email, purpose: 'login' });
    
    // Generate new OTP
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutes
    
    // Save OTP to DB
    await Otp.create({ email, otp, expiresAt, purpose: 'login' });
    
    // Send OTP email
    await sendOtpEmail(email, otp);
    
    res.json({ success: true, message: 'OTP resent to email', role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/send-payment-otp
// @desc    Send payment verification OTP via email and SMS
router.post('/send-payment-otp', [
  body('identifier').notEmpty().withMessage('Email or phone number is required'),
  body('purpose').isIn(['payment_verification', 'loan_creation']).withMessage('Valid purpose is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { identifier, purpose, customerId } = req.body;
    
    // Find user by email or phone number
    let user = await User.findOne({
      $or: [
        { email: identifier },
        { primaryMobile: identifier },
        { secondaryMobile: identifier }
      ]
    });
    
    if (!user) {
      // Try to find customer
      user = await Customer.findOne({
        $or: [
          { email: identifier },
          { primaryMobile: identifier },
          { secondaryMobile: identifier }
        ]
      });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    
    // Remove any previous unused OTPs
    await Otp.deleteMany({ 
      $or: [{ email: identifier }, { phoneNumber: identifier }], 
      purpose 
    });
    
    // Create OTP record
    const otpData = {
      email: user.email || identifier,
      otp,
      expiresAt,
      purpose,
      customerId: customerId || user._id
    };
    
    // Add phone number if available
    if (user.primaryMobile) {
      otpData.phoneNumber = user.primaryMobile;
    }
    
    const otpDoc = await Otp.create(otpData);
    
    // Send dual-channel OTP
    const userData = {
      email: user.email,
      primaryMobile: user.primaryMobile,
      name: user.name
    };
    
    // In development mode, skip SMS to avoid charges, EXCEPT for loan creation
    const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
    const isLoanCreation = purpose === 'loan_creation' || purpose === 'customer_registration';
    
    let dualChannelResult;
    if (isDevelopment && !isLoanCreation) {
      console.log('🚧 Development mode: Skipping SMS OTP to avoid charges (except for loan creation)');
      // Only send email OTP in development (except for loan creation)
      try {
        const emailResult = await sendOtpEmail(userData.email, otp, purpose);
        dualChannelResult = {
          email: emailResult,
          sms: { success: false, error: 'SMS disabled in development mode' },
          overall: {
            success: emailResult.success,
            message: emailResult.success ? 'OTP sent via email only (SMS disabled in development)' : 'Failed to send OTP'
          }
        };
      } catch (error) {
        dualChannelResult = {
          email: { success: false, error: error.message },
          sms: { success: false, error: 'SMS disabled in development mode' },
          overall: { success: false, message: 'Failed to send OTP' }
        };
      }
    } else {
      // Production mode OR loan creation - send both email and SMS
      dualChannelResult = await smsService.sendDualChannelOTP(
        userData,
        otp,
        purpose,
        sendOtpEmail
      );
    }
    
    // Update OTP record with delivery status
    if (dualChannelResult.email.success) {
      await otpDoc.markEmailSent(dualChannelResult.email.messageId || 'email_sent');
    }
    
    if (dualChannelResult.sms.success) {
      await otpDoc.markSMSSent(dualChannelResult.sms.messageId || 'sms_sent');
    }
    
    // Return appropriate response
    if (dualChannelResult.overall.success) {
      res.json({ 
        success: true, 
        message: dualChannelResult.overall.message,
        channels: {
          email: dualChannelResult.email.success,
          sms: dualChannelResult.sms.success
        },
        purpose,
        expiresAt
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send OTP. Please try again.',
        error: dualChannelResult.overall.message
      });
    }
    
  } catch (err) {
    console.error('Error sending payment OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/verify-payment-otp
// @desc    Verify payment OTP
router.post('/verify-payment-otp', [
  body('identifier').notEmpty().withMessage('Email or phone number is required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('purpose').isIn(['payment_verification', 'loan_creation']).withMessage('Valid purpose is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { identifier, otp, purpose } = req.body;
    
    // Find OTP record
    const otpDoc = await Otp.findValidOTP(identifier, identifier, otp, purpose);
    
    if (!otpDoc) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }
    
    if (otpDoc.isExpired()) {
      await otpDoc.deleteOne();
      return res.status(400).json({ message: 'OTP expired' });
    }
    
    if (!otpDoc.canAttemptVerification()) {
      await otpDoc.deleteOne();
      return res.status(400).json({ message: 'Too many verification attempts. Please request a new OTP.' });
    }
    
    // Increment attempt counter
    await otpDoc.incrementAttempts();
    
    // OTP is valid, mark as verified
    await otpDoc.markVerified('both');
    
    res.json({ 
      success: true, 
      message: 'Payment OTP verified successfully.',
      verifiedVia: otpDoc.verifiedVia,
      purpose,
      customerId: otpDoc.customerId
    });
    
  } catch (err) {
    console.error('Error verifying payment OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /auth/send-login-otp
// @desc    Send login OTP via email and SMS
router.post('/send-login-otp', [
  body('identifier').notEmpty().withMessage('Email or phone number is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    
    const { identifier } = req.body;
    
    // Find user by email or phone number
    let user = await User.findOne({
      $or: [
        { email: identifier },
        { primaryMobile: identifier },
        { secondaryMobile: identifier }
      ]
    });
    
    if (!user) {
      // Try to find customer
      user = await Customer.findOne({
        $or: [
          { email: identifier },
          { primaryMobile: identifier },
          { secondaryMobile: identifier }
        ]
      });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    
    // Remove any previous unused OTPs
    await Otp.deleteMany({ 
      $or: [{ email: identifier }, { phoneNumber: identifier }], 
      purpose: 'login' 
    });
    
    // Create OTP record
    const otpData = {
      email: user.email || identifier,
      otp,
      expiresAt,
      purpose: 'login',
      customerId: user._id
    };
    
    // Add phone number if available
    if (user.primaryMobile) {
      otpData.phoneNumber = user.primaryMobile;
    }
    
    const otpDoc = await Otp.create(otpData);
    
    // Send dual-channel OTP
    const userData = {
      email: user.email,
      primaryMobile: user.primaryMobile,
      name: user.name
    };
    
    // In development mode, skip SMS to avoid charges, EXCEPT for loan creation
    const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';
    const isLoanCreation = false; // Login is not loan creation
    
    let dualChannelResult;
    if (isDevelopment && !isLoanCreation) {
      console.log('🚧 Development mode: Skipping SMS OTP to avoid charges (except for loan creation)');
      // Only send email OTP in development (except for loan creation)
      try {
        const emailResult = await sendOtpEmail(userData.email, otp, 'login');
        dualChannelResult = {
          email: emailResult,
          sms: { success: false, error: 'SMS disabled in development mode' },
          overall: {
            success: emailResult.success,
            message: emailResult.success ? 'OTP sent via email only (SMS disabled in development)' : 'Failed to send OTP'
          }
        };
      } catch (error) {
        dualChannelResult = {
          email: { success: false, error: error.message },
          sms: { success: false, error: 'SMS disabled in development mode' },
          overall: { success: false, message: 'Failed to send OTP' }
        };
      }
    } else {
      // Production mode OR loan creation - send both email and SMS
      dualChannelResult = await smsService.sendDualChannelOTP(
        userData,
        otp,
        'login',
        sendOtpEmail
      );
    }
    
    // Update OTP record with delivery status
    if (dualChannelResult.email.success) {
      await otpDoc.markEmailSent(dualChannelResult.email.messageId || 'email_sent');
    }
    
    if (dualChannelResult.sms.success) {
      await otpDoc.markSMSSent(dualChannelResult.sms.messageId || 'sms_sent');
    }
    
    // Return appropriate response
    if (dualChannelResult.overall.success) {
      res.json({ 
        success: true, 
        message: dualChannelResult.overall.message,
        channels: {
          email: dualChannelResult.email.success,
          sms: dualChannelResult.sms.success
        },
        expiresAt
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send OTP. Please try again.',
        error: dualChannelResult.overall.message
      });
    }
    
  } catch (err) {
    console.error('Error sending login OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 