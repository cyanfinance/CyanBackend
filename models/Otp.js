const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: false },
  phoneNumber: { type: String }, // Phone number for SMS delivery
  otp: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  purpose: { 
    type: String, 
    enum: ['customer_registration', 'loan_creation', 'login', 'password_reset', 'payment_verification'], 
    required: true 
  },
  customerId: { type: String }, // Only required for loan_creation
  
  // Delivery tracking
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  emailMessageId: { type: String },
  
  smsSent: { type: Boolean, default: false },
  smsSentAt: { type: Date },
  smsMessageId: { type: String },
  
  // Verification tracking
  verifiedAt: { type: Date },
  verifiedVia: { type: String, enum: ['email', 'sms', 'both'] },
  
  // Attempts tracking
  verificationAttempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 3 },
  
  // DLT compliance
  smsTemplateId: { type: String },
  smsProvider: { type: String },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
otpSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Indexes for performance
otpSchema.index({ email: 1, purpose: 1 });
otpSchema.index({ phoneNumber: 1, purpose: 1 });
otpSchema.index({ expiresAt: 1 });
otpSchema.index({ customerId: 1 });

// Instance methods
otpSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

otpSchema.methods.canAttemptVerification = function() {
  return this.verificationAttempts < this.maxAttempts;
};

otpSchema.methods.incrementAttempts = function() {
  this.verificationAttempts += 1;
  return this.save();
};

otpSchema.methods.markEmailSent = function(messageId) {
  this.emailSent = true;
  this.emailSentAt = new Date();
  this.emailMessageId = messageId;
  return this.save();
};

otpSchema.methods.markSMSSent = function(messageId) {
  this.smsSent = true;
  this.smsSentAt = new Date();
  this.smsMessageId = messageId;
  return this.save();
};

otpSchema.methods.markVerified = function(via = 'both') {
  this.verifiedAt = new Date();
  this.verifiedVia = via;
  return this.save();
};

// Static methods
otpSchema.statics.findValidOTP = function(email, phoneNumber, otp, purpose) {
  const query = {
    $or: [
      { email: email },
      { phoneNumber: phoneNumber }
    ],
    otp: otp,
    purpose: purpose,
    expiresAt: { $gt: new Date() }
  };
  
  return this.findOne(query);
};

otpSchema.statics.cleanupExpired = function() {
  return this.deleteMany({ expiresAt: { $lt: new Date() } });
};

otpSchema.statics.cleanupVerified = function() {
  return this.deleteMany({ verifiedAt: { $exists: true } });
};

otpSchema.statics.deleteByCustomerAndPurpose = function(customerId, purpose) {
  return this.deleteMany({ customerId, purpose });
};

module.exports = mongoose.model('Otp', otpSchema); 