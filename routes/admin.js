const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const Customer = require('../models/Customer');
const User = require('../models/User');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { sendBrevoEmail } = require('../utils/brevo');
const crypto = require('crypto');
const Otp = require('../models/Otp');

// @route   GET /api/admin/check-aadhar/:aadharNumber
// @desc    Check if an Aadhar number exists and get customer details
router.get('/check-aadhar/:aadharNumber', [auth, adminAuth], async (req, res) => {
    try {
        console.log('Checking Aadhar:', req.params.aadharNumber);
        // Check both aadharNumber and customerId fields
        const loan = await Loan.findOne({
            $or: [
                { aadharNumber: req.params.aadharNumber },
                { customerId: req.params.aadharNumber }
            ]
        });
        console.log('Found loan:', loan);
        
        if (loan) {
            return res.json({
                exists: true,
                customerDetails: {
                    customerId: loan.customerId,
                    name: loan.name,
                    email: loan.email,
                    primaryMobile: loan.primaryMobile,
                    secondaryMobile: loan.secondaryMobile || '',
                    presentAddress: loan.presentAddress,
                    permanentAddress: loan.permanentAddress,
                    emergencyContact: loan.emergencyContact || { mobile: '', relation: '' }
                }
            });
        }
        res.json({ exists: false });
    } catch (err) {
        console.error('Error checking Aadhar:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/admin/loans
// @desc    Create a new loan as admin
router.post('/loans', [
    auth,
    adminAuth,
    body('aadharNumber').matches(/^[0-9]{12}$/).withMessage('Aadhar number must be exactly 12 digits'),
    body('amount').isNumeric().withMessage('Loan amount must be a number').isFloat({ min: 100 }).withMessage('Loan amount must be at least 100'),
    body('term').isInt({ min: 1 }).withMessage('Duration must be at least 1 month'),
    body('interestRate').isFloat({ min: 0 }).withMessage('Interest rate cannot be negative'),
    body('monthlyPayment').isNumeric().withMessage('Monthly payment is required'),
    body('totalPayment').isNumeric().withMessage('Total payment is required'),
    body('goldItems').isArray({ min: 1 }).withMessage('At least one gold item must be provided'),
    // Add more field checks as needed
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        console.log('Received request body:', JSON.stringify(req.body, null, 2));
        console.log('User from token:', req.user);

        // Extract customer fields
        const {
            aadharNumber,
            name,
            email,
            primaryMobile,
            secondaryMobile,
            presentAddress,
            permanentAddress,
            emergencyContact,
            goldItems,
            interestRate,
            amount,
            term,
            monthlyPayment,
            totalPayment
        } = req.body;

        // Use the correct field names, falling back to alternates if needed
        const finalAmount = amount;
        const finalTerm = term;

        // Find or create customer
        let customer = await Customer.findOne({ aadharNumber });
        let isNewCustomer = false;
        
        if (!customer) {
            // Create new customer
            customer = await Customer.create({
                aadharNumber,
                name,
                email,
                primaryMobile,
                secondaryMobile,
                presentAddress,
                permanentAddress,
                emergencyContact,
                verified: false
            });
            isNewCustomer = true;

            // Send welcome email to new customer
            try {
                await sendBrevoEmail({
                    to: email,
                    subject: 'Welcome to Cyan Finance',
                    html: `
                        <p>Dear ${name},</p>
                        <p>Welcome to Cyan Finance! We're pleased to have you as our customer.</p>
                        <p>Your account has been successfully created with the following details:</p>
                        <ul>
                            <li>Name: ${name}</li>
                            <li>Email: ${email}</li>
                            <li>Primary Mobile: ${primaryMobile}</li>
                            ${secondaryMobile ? `<li>Secondary Mobile: ${secondaryMobile}</li>` : ''}
                        </ul>
                        <p>If you have any questions or need assistance, please don't hesitate to contact us.</p>
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    `
                });
            } catch (emailErr) {
                console.error('Failed to send welcome email:', emailErr);
                // Continue with loan creation even if email fails
            }
        } else {
            // Update existing customer's information
            customer.name = name;
            customer.email = email;
            customer.primaryMobile = primaryMobile;
            customer.secondaryMobile = secondaryMobile;
            customer.presentAddress = presentAddress;
            customer.permanentAddress = permanentAddress;
            customer.emergencyContact = emergencyContact;
            await customer.save();
        }

        if (!customer.verified) {
            return res.status(400).json({ message: 'Customer email not verified. Please verify before creating a loan.' });
        }

        // Validate goldItems array
        if (!Array.isArray(goldItems) || goldItems.length === 0) {
            return res.status(400).json({
                errors: [{ msg: 'At least one gold item must be provided' }]
            });
        }

        // Validate each gold item
        const invalidGoldItems = goldItems.filter(
            item => !item.description || !item.grossWeight || !item.netWeight
        );

        if (invalidGoldItems.length > 0) {
            return res.status(400).json({
                errors: [{ msg: 'Each gold item must have description, grossWeight, and netWeight' }]
            });
        }

        // Generate unique loanId with retry mechanism
        let loanId;
        let attempts = 0;
        const maxAttempts = 5;
        
        do {
            const now = new Date();
            const year = now.getFullYear() % 1000; // last 3 digits
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');
            const hour = now.getHours().toString().padStart(2, '0');
            const minute = now.getMinutes().toString().padStart(2, '0');
            const second = now.getSeconds().toString().padStart(2, '0');
            const random = Math.floor(Math.random() * 100).toString().padStart(2, '0');
            
            // Create a more unique ID with timestamp and random component
            loanId = `CY${year}${month}${day}${hour}${minute}${second}${random}`;
            
            // Check if this ID already exists
            const existingLoan = await Loan.findOne({ loanId });
            if (!existingLoan) {
                break; // Unique ID found
            }
            
            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error('Unable to generate unique loan ID after multiple attempts');
            }
        } while (attempts < maxAttempts);

        // Calculate daily interest fields
        const dailyInterestRate = (Number(interestRate) / 100) / 365;
        const totalDays = Number(finalTerm) * 30;
        const dailyInterestAmount = Number(finalAmount) * dailyInterestRate;

        // Create new loan data
        const loanData = {
            customerId: customer._id,
            aadharNumber: customer.aadharNumber,
            name: customer.name,
            email: customer.email,
            primaryMobile: customer.primaryMobile,
            secondaryMobile: customer.secondaryMobile,
            presentAddress: customer.presentAddress,
            permanentAddress: customer.permanentAddress,
            emergencyContact: customer.emergencyContact,
            goldItems,
            interestRate: Number(interestRate),
            amount: Number(finalAmount),
            term: Number(finalTerm),
            monthlyPayment: Number(monthlyPayment),
            totalPayment: Number(finalAmount),
            status: 'active',
            createdBy: req.user._id,
            loanId,
            remainingBalance: Number(finalAmount),
            totalPaid: 0,
            payments: [],
            dailyInterestRate,
            totalDays,
            dailyInterestAmount
        };

        console.log('Creating new loan with data:', JSON.stringify(loanData, null, 2));

        try {
            // Create new loan
            const loan = await Loan.create(loanData);
            console.log('Loan created successfully:', loan);

            // Send loan confirmation email
            try {
                await sendBrevoEmail({
                    to: loan.email,
                    subject: 'Loan Confirmation - Cyan Finance',
                    html: `
                        <p>Dear ${loan.name},</p>
                        <p>Your loan has been successfully created with the following details:</p>
                        <p><b>Loan Details:</b></p>
                        <ul>
                            <li>Loan ID: ${loan.loanId}</li>
                            <li>Loan Amount: ₹${loan.amount}</li>
                            <li>Term: ${loan.term} months</li>
                            <li>Interest Rate: ${loan.interestRate}%</li>
                            <li>Monthly Payment: ₹${loan.monthlyPayment}</li>
                            <li>Total Payment: ₹${loan.totalPayment}</li>
                        </ul>
                        <p><b>Gold Items:</b></p>
                        <ul>
                            ${loan.goldItems.map(item => `
                                <li>${item.description} - Gross Weight: ${item.grossWeight}g, Net Weight: ${item.netWeight}g</li>
                            `).join('')}
                        </ul>
                        <p>Please ensure timely payment of your monthly installments.</p>
                        <p>If you have any questions, please don't hesitate to contact us.</p>
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    `
                });
            } catch (emailErr) {
                console.error('Failed to send loan confirmation email:', emailErr);
                // Continue with response even if email fails
            }

            res.status(201).json({
                success: true,
                data: loan
            });
        } catch (err) {
            console.error('Error creating loan:', err);
            console.error('Error details:', {
                name: err.name,
                message: err.message,
                stack: err.stack
            });

            // Check for specific MongoDB validation errors
            if (err.name === 'ValidationError') {
                const validationErrors = Object.values(err.errors).map(error => ({
                    msg: error.message
                }));
                return res.status(400).json({ errors: validationErrors });
            }

            // Check for MongoDB duplicate key errors
            if (err.code === 11000) {
                return res.status(400).json({
                    errors: [{ msg: 'Duplicate key error. This record already exists.' }]
                });
            }

            res.status(500).json({ 
                message: 'Server error',
                error: err.message,
                details: err.name
            });
        }
    } catch (err) {
        console.error('Error creating loan:', err);
        console.error('Error details:', {
            name: err.name,
            message: err.message,
            stack: err.stack
        });

        // Check for specific MongoDB validation errors
        if (err.name === 'ValidationError') {
            const validationErrors = Object.values(err.errors).map(error => ({
                msg: error.message
            }));
            return res.status(400).json({ errors: validationErrors });
        }

        // Check for MongoDB duplicate key errors
        if (err.code === 11000) {
            return res.status(400).json({
                errors: [{ msg: 'Duplicate key error. This record already exists.' }]
            });
        }

        res.status(500).json({ 
            message: 'Server error',
            error: err.message,
            details: err.name
        });
    }
});

// @route   GET /api/admin/loans
// @desc    Get all loans (admin only)
router.get('/loans', [auth, adminAuth], async (req, res) => {
    try {
        const loans = await Loan.find()
            .sort({ createdAt: -1 })
            .populate('createdBy', 'name email role')
            .populate('customerId', 'aadharNumber name');
        res.json({
            success: true,
            data: loans
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/admin/customers
// @desc    Get all customers who have taken at least one loan
router.get('/customers', [auth, adminAuth], async (req, res) => {
    try {
        const customers = await Loan.aggregate([
            {
                $group: {
                    _id: '$aadharNumber',
                    mongoId: { $first: '$_id' },
                    name: { $first: '$name' },
                    email: { $first: '$email' },
                    primaryMobile: { $first: '$primaryMobile' },
                    secondaryMobile: { $first: '$secondaryMobile' },
                    presentAddress: { $first: '$presentAddress' },
                    permanentAddress: { $first: '$permanentAddress' },
                    emergencyContact: { $first: '$emergencyContact' },
                    totalLoans: { $sum: 1 },
                    activeLoans: {
                        $sum: {
                            $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: 'aadharNumber',
                    as: 'userDoc'
                }
            },
            {
                $addFields: {
                    userId: { $arrayElemAt: ['$userDoc._id', 0] },
                    role: { $arrayElemAt: ['$userDoc.role', 0] }
                }
            },
            {
                $project: {
                    aadharNumber: '$_id',
                    mongoId: 1,
                    userId: 1,
                    role: 1,
                    name: 1,
                    email: 1,
                    primaryMobile: 1,
                    secondaryMobile: 1,
                    presentAddress: 1,
                    permanentAddress: 1,
                    emergencyContact: 1,
                    totalLoans: 1,
                    activeLoans: 1,
                    _id: 0
                }
            }
        ]);
        res.json({
            success: true,
            data: customers
        });
    } catch (err) {
        console.error('Error fetching customers:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/admin/loans/:id
// @desc    Update a loan as admin
router.put('/loans/:id', [auth, adminAuth], async (req, res) => {
  try {
    const { goldItems, depositedBank, renewalDate } = req.body;

    // Validate the loan exists
    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Update the loan
    loan.goldItems = goldItems;
    loan.depositedBank = depositedBank;
    loan.renewalDate = renewalDate;

    await loan.save();

    res.json({
      success: true,
      data: loan
    });
  } catch (err) {
    console.error('Error updating loan:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/customers/:aadharNumber
// @desc    Update a customer as admin
router.put('/customers/:aadharNumber', [auth, adminAuth], async (req, res) => {
  try {
    const allowedFields = [
      'name', 'email', 'primaryMobile', 'secondaryMobile',
      'presentAddress', 'permanentAddress', 'emergencyContact'
    ];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    const updated = await Customer.findOneAndUpdate(
      { aadharNumber: req.params.aadharNumber },
      update,
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: 'Customer not found' });

    // Also update all Loan documents for this customer
    await Loan.updateMany(
      { aadharNumber: req.params.aadharNumber },
      { $set: update }
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/admin/customers/:aadharNumber
// @desc    Delete a customer by aadhar number (admin only)
router.delete('/customers/:aadharNumber', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findOne({ aadharNumber: req.params.aadharNumber });
    if (!user) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete an admin user.' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (err) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/employees
// @desc    Add a new employee (admin only)
router.post('/employees', [auth, adminAuth, body('email').isEmail(), body('name').notEmpty(), body('aadharNumber').isLength({ min: 12, max: 12 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, name, mobile, alternateMobile, aadharNumber } = req.body;
    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }
    // Create user with a dummy password (not used for login)
    user = await User.create({
      name,
      email,
      password: 'otp-login', // placeholder, not used
      role: 'employee',
      aadharNumber,
      primaryMobile: mobile,
      secondaryMobile: alternateMobile
    });
    // Send welcome email with OTP login instructions
    try {
      await sendBrevoEmail({
        to: email,
        subject: 'Welcome to Cyan Finance - Employee Account',
        html: `<p>Dear ${name},</p>
          <p>Your employee account has been created on Cyan Finance.</p>
          <p><b>Login Email:</b> ${email}</p>
          <p>You can now log in using the OTP-based login system. On the login page https://cyangold.in/login, enter your email and request an OTP to access your account. No password is required.</p>
          <p>Best regards,<br/>Cyan Finance Team</p>`
      });
    } catch (emailErr) {
      console.error('Failed to send employee welcome email:', emailErr);
      // Continue even if email fails
    }
    res.json({ success: true, message: 'Employee registered and email sent.' });
  } catch (err) {
    console.error('Error registering employee:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/employees
// @desc    Get all employees (admin only)
router.get('/employees', [auth, adminAuth], async (req, res) => {
  try {
    const employees = await User.find({ role: { $in: ['employee', 'admin'] } }).select('-password');
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/admin/employees/:id
// @desc    Delete an employee (admin only)
router.delete('/employees/:id', [auth, adminAuth], async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    if (user.role !== 'employee') {
      return res.status(400).json({ message: 'Can only delete users with employee role' });
    }
    await user.deleteOne();
    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/admin/employees/:id
// @desc    Update an employee (admin only)
router.put('/employees/:id', [auth, adminAuth], async (req, res) => {
  try {
    const allowedFields = [
      'name', 'primaryMobile', 'secondaryMobile', 'role'
    ];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    const updated = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ message: 'Employee not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/sync-customers-from-loans
// @desc    Sync all unique customers from Loan collection to Customer collection
router.post('/sync-customers-from-loans', [auth, adminAuth], async (req, res) => {
  try {
    const loans = await Loan.aggregate([
      { $group: { _id: '$aadharNumber', doc: { $first: '$$ROOT' } } }
    ]);
    let created = 0;
    for (const { _id: aadharNumber, doc } of loans) {
      if (!aadharNumber) continue;
      const exists = await Customer.findOne({ aadharNumber });
      if (!exists) {
        await Customer.create({
          aadharNumber,
          name: doc.name,
          email: doc.email,
          primaryMobile: doc.primaryMobile,
          secondaryMobile: doc.secondaryMobile,
          presentAddress: doc.presentAddress,
          permanentAddress: doc.permanentAddress,
          emergencyContact: doc.emergencyContact
        });
        created++;
      }
    }
    res.json({ success: true, message: `Sync complete! ${created} customers created.` });
  } catch (err) {
    console.error('Error syncing customers:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/admin/customers
// @desc    Add or verify a customer and send OTP for email verification
router.post('/customers', [
    auth,
    adminAuth,
    body('aadharNumber').matches(/^[0-9]{12}$/).withMessage('Aadhar number must be exactly 12 digits'),
    body('name').notEmpty().withMessage('Full Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('primaryMobile').matches(/^[0-9]{10}$/).withMessage('Primary Mobile must be 10 digits'),
    body('presentAddress').notEmpty().withMessage('Present Address is required'),
    body('permanentAddress').notEmpty().withMessage('Permanent Address is required'),
    body('emergencyContact').notEmpty().withMessage('Emergency Contact is required'),
    // Add more field checks as needed
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        const { aadharNumber, name, email, primaryMobile, secondaryMobile, presentAddress, permanentAddress, emergencyContact } = req.body;
        
        // Validate that mobile numbers are different
        const mobileNumbers = new Set([
            primaryMobile?.trim(),
            secondaryMobile?.trim(),
            emergencyContact?.mobile?.trim()
        ].filter(num => num && num.length > 0));
        
        if (mobileNumbers.size < [primaryMobile, secondaryMobile, emergencyContact?.mobile].filter(num => num && num.length > 0).length) {
            return res.status(400).json({ 
                errors: [{ 
                    msg: 'Primary Mobile, Secondary Mobile, and Emergency Contact Number must be different' 
                }] 
            });
        }
        
        let customer = await Customer.findOne({ aadharNumber });
        if (!customer) {
            // Create customer with verified: false
            customer = await Customer.create({
                aadharNumber,
                name,
                email,
                primaryMobile,
                secondaryMobile,
                presentAddress,
                permanentAddress,
                emergencyContact,
                verified: false
            });
        } else {
            // Update customer details and set verified: false if not already verified
            customer.name = name;
            customer.email = email;
            customer.primaryMobile = primaryMobile;
            customer.secondaryMobile = secondaryMobile;
            customer.presentAddress = presentAddress;
            customer.permanentAddress = permanentAddress;
            customer.emergencyContact = emergencyContact;
            if (!customer.verified) customer.verified = false;
            await customer.save();
        }
        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
        console.log(`[ADMIN] Generated OTP ${otp} for mobile ${primaryMobile}, expires at ${expiresAt}`);
        
        // Remove any previous unused OTPs
        await Otp.deleteMany({ email });
        
        // Create OTP record with phone number
        const otpData = {
            email,
            otp,
            expiresAt,
            purpose: 'customer_registration',
            phoneNumber: primaryMobile
        };
        
        await Otp.create(otpData);
        
        // Send SMS-only OTP
        if (!primaryMobile) {
            return res.status(400).json({ errors: [{ msg: 'Primary mobile number is required for SMS verification' }] });
        }
        
        try {
            const smsService = require('../utils/smsService');
            const smsResult = await smsService.sendOTP(primaryMobile, otp, 'login');
            
            if (!smsResult.success) {
                console.error('Failed to send SMS OTP:', smsResult.error);
                return res.status(500).json({ errors: [{ msg: 'Failed to send SMS OTP. Please check the mobile number or try again later.' }] });
            }
            
            console.log(`[ADMIN] SMS OTP sent successfully to ${primaryMobile}`);
        } catch (smsErr) {
            console.error('Failed to send SMS OTP:', smsErr);
            return res.status(500).json({ errors: [{ msg: 'Failed to send SMS OTP. Please check the mobile number or try again later.' }] });
        }
        
        res.json({ success: true, message: 'OTP sent to mobile number for verification.' });
    } catch (err) {
        if (err.code === 11000 && err.keyPattern && err.keyPattern.primaryMobile) {
            return res.status(400).json({ errors: [{ msg: 'This primary mobile number is already registered. Please use a different number.' }] });
        }
        if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
            return res.status(400).json({ errors: [{ msg: 'This email is already registered. Please use a different email.' }] });
        }
        console.error('Error adding customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/admin/verify-customer-otp
// @desc    Verify customer email OTP
router.post('/verify-customer-otp', [auth, adminAuth], async (req, res) => {
    try {
        const { email, otp } = req.body;
        console.log(`[ADMIN] Verifying OTP for email: ${email}, OTP: ${otp}`);
        
        if (!email || !otp) {
            return res.status(400).json({ message: 'Email and OTP are required' });
        }
        
        // Debug: log all OTPs for this email
        const allOtps = await Otp.find({ email: email.trim() });
        console.log('[ADMIN] All OTPs for email:', allOtps);
        const otpDoc = await Otp.findOne({ email: email.trim(), otp: String(otp).trim(), purpose: 'customer_registration' });
        console.log(`[ADMIN] OTP document found:`, otpDoc ? 'Yes' : 'No');
        
        if (!otpDoc) {
            return res.status(400).json({ message: 'Invalid OTP. Please check the OTP and try again.' });
        }
        
        if (otpDoc.expiresAt < new Date()) {
            console.log(`[ADMIN] OTP expired. Expires at: ${otpDoc.expiresAt}, Current time: ${new Date()}`);
            return res.status(400).json({ message: 'OTP has expired. Please request a new OTP.' });
        }
        
        // Set customer as verified
        const customer = await Customer.findOneAndUpdate({ email }, { verified: true }, { new: true });
        await Otp.deleteMany({ email });
        
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        
        console.log(`[ADMIN] Customer verified successfully: ${customer.name}`);
        res.json({ success: true, message: 'Email verified successfully', customer });
    } catch (err) {
        console.error('Error verifying OTP:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 