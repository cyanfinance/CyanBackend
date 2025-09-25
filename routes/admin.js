const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const Customer = require('../models/Customer');
const User = require('../models/User');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { sendBrevoEmail } = require('../utils/brevo');
const { sendSMS } = require('../utils/smsService');
const crypto = require('crypto');
const Otp = require('../models/Otp');
const { processInterestRateUpgrades, getUpgradeStatistics } = require('../scripts/interestRateUpgradeManager');
const Notification = require('../models/Notification');
const { calculateMuthootGoldLoanInterest: calcMuthoot, calculateMuthootGoldLoanInterest, calculateClientInterestMethod } = require('../utils/interestCalculator');

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
                    aadharNumber: loan.aadharNumber,
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
    body('term').isIn([3, 6, 12]).withMessage('Duration must be 3, 6, or 12 months'),
    body('interestRate').isIn([18, 24, 30, 36]).withMessage('Interest rate must be 18%, 24%, 30% or 36%'),
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
            customerId,
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
            totalPayment,
            customLoanDate
        } = req.body;

        // Use the correct field names, falling back to alternates if needed
        const finalAmount = amount;
        const finalTerm = term;

        // Find or create customer
        let customer;
        let isNewCustomer = false;
        
        if (customerId) {
            // Use the provided customerId (from OTP verification)
            customer = await Customer.findById(customerId);
            console.log(`[ADMIN] Found customer by ID: ${customerId}`, customer ? 'Yes' : 'No');
        } else {
            // Fallback to Aadhar number lookup
            customer = await Customer.findOne({ aadharNumber });
            console.log(`[ADMIN] Found customer by Aadhar: ${aadharNumber}`, customer ? 'Yes' : 'No');
        }
        
        if (!customer) {
            if (customerId) {
                // Customer ID was provided but customer not found
                return res.status(404).json({ message: 'Customer not found with the provided ID' });
            }
            // Create new customer (only if no customerId was provided)
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
        } else if (!customerId) {
            // Update existing customer's information (only if no customerId was provided)
            customer.name = name;
            customer.email = email;
            customer.primaryMobile = primaryMobile;
            customer.secondaryMobile = secondaryMobile;
            customer.presentAddress = presentAddress;
            customer.permanentAddress = permanentAddress;
            customer.emergencyContact = emergencyContact;
            await customer.save();
        }

        // Always require customer verification (via SMS OTP)
        if (!customer.verified) {
            return res.status(400).json({ message: 'Customer not verified. Please verify customer via SMS OTP before creating a loan.' });
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

        // Calculate using client's interest method
        const disbursementDate = new Date();
        const closureDate = new Date(disbursementDate);
        closureDate.setMonth(closureDate.getMonth() + Number(finalTerm));
        
        const muthootResult = calculateClientInterestMethod({
            principal: Number(finalAmount),
            annualRate: Number(interestRate),
            disbursementDate: disbursementDate,
            closureDate: closureDate,
            termMonths: Number(finalTerm)
        });
        
        // Calculate daily interest fields for tracking
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
            originalInterestRate: Number(interestRate), // Add this required field
            amount: Number(finalAmount),
            term: Number(finalTerm),
            monthlyPayment: Math.round(muthootResult.totalAmount / Number(finalTerm)),
            totalPayment: muthootResult.totalAmount,
            status: 'active',
            createdBy: req.user._id,
            loanId,
            remainingBalance: muthootResult.totalAmount,
            // Use custom loan date if provided, otherwise use current date
            createdAt: customLoanDate ? new Date(customLoanDate) : new Date(),
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

            // Send loan confirmation email (only if email is provided)
            if (loan.email && loan.email.trim()) {
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
        
        // Process each loan to include accurate payment totals and remaining balance
        const processedLoans = loans.map(loan => {
            const loanObj = loan.toObject();
            
            // Calculate total paid from payments (include both success and pending payments)
            const totalPaid = loan.payments ? loan.payments.reduce((sum, payment) => {
                return sum + payment.amount; // Include all payments regardless of status
            }, 0) : 0;
            
            // Use the loan's remainingBalance if available, otherwise calculate it
            const remainingBalance = loan.remainingBalance !== undefined ? 
                loan.remainingBalance : 
                Math.max(0, (loan.totalPayment || loan.amount) - totalPaid);
            
            // Determine loan status based on payments and database status
            let loanStatus = loan.status;
            if (remainingBalance <= 0 && totalPaid > 0) {
                loanStatus = 'closed';
            } else if (totalPaid > 0 && remainingBalance > 0) {
                loanStatus = 'active';
            }
            
            return {
                ...loanObj,
                totalPaid,
                remainingBalance,
                status: loanStatus
            };
        });
        
        res.json({
            success: true,
            data: processedLoans
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
    const { goldItems, depositedBank, renewalDate, bankMobileNumber, bankLoanAmount } = req.body;

    // Validate the loan exists
    const loan = await Loan.findById(req.params.id);
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Update the loan
    loan.goldItems = goldItems;
    loan.depositedBank = depositedBank;
    loan.renewalDate = renewalDate;
    loan.bankMobileNumber = bankMobileNumber;
    loan.bankLoanAmount = bankLoanAmount;

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
// @desc    Add a new employee or admin (admin only)
router.post('/employees', [auth, adminAuth, body('email').isEmail(), body('name').notEmpty(), body('aadharNumber').isLength({ min: 12, max: 12 })], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, name, mobile, alternateMobile, aadharNumber, role } = req.body;
    
    // Validate role
    const validRoles = ['employee', 'admin'];
    const userRole = role && validRoles.includes(role) ? role : 'employee';
    
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
      role: userRole,
      aadharNumber,
      primaryMobile: mobile,
      secondaryMobile: alternateMobile
    });
    // Send welcome email with OTP login instructions
    try {
      const roleTitle = userRole === 'admin' ? 'Admin' : 'Employee';
      await sendBrevoEmail({
        to: email,
        subject: `Welcome to Cyan Finance - ${roleTitle} Account`,
        html: `<p>Dear ${name},</p>
          <p>Your ${roleTitle.toLowerCase()} account has been created on Cyan Finance.</p>
          <p><b>Login Email:</b> ${email}</p>
          <p><b>Role:</b> ${roleTitle}</p>
          <p>You can now log in using the OTP-based login system. On the login page https://cyangold.in/login, enter your email and request an OTP to access your account. No password is required.</p>
          <p>Best regards,<br/>Cyan Finance Team</p>`
      });
    } catch (emailErr) {
      console.error(`Failed to send ${userRole} welcome email:`, emailErr);
      // Continue even if email fails
    }
    
    const successMessage = userRole === 'admin' ? 'Admin registered and email sent.' : 'Employee registered and email sent.';
    res.json({ success: true, message: successMessage });
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
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email is required'),
    body('primaryMobile').matches(/^[0-9]{10}$/).withMessage('Primary Mobile must be 10 digits'),
    body('presentAddress').notEmpty().withMessage('Present Address is required'),
    body('permanentAddress').notEmpty().withMessage('Permanent Address is required'),
    body('emergencyContact.mobile').notEmpty().withMessage('Emergency Contact mobile is required'),
    body('emergencyContact.relation').notEmpty().withMessage('Emergency Contact relation is required'),
    // Add more field checks as needed
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        console.log('[ADMIN] Customer creation validation errors:', errors.array());
        return res.status(400).json({ errors: errors.array() });
    }
    try {
        console.log('[ADMIN] Received customer creation request:', JSON.stringify(req.body, null, 2));
        const { aadharNumber, name, email, primaryMobile, secondaryMobile, presentAddress, permanentAddress, emergencyContact } = req.body;
        
        // Convert empty email to null to avoid unique constraint issues
        const processedEmail = email && email.trim() ? email.trim() : null;
        
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
                email: processedEmail,
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
            customer.email = processedEmail;
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
        if (email && email.trim()) {
            await Otp.deleteMany({ email });
        }
        // Also remove OTPs by phone number
        if (primaryMobile && primaryMobile.trim()) {
            await Otp.deleteMany({ phoneNumber: primaryMobile.trim() });
        }
        
        // Create OTP record with phone number
        const otpData = {
            email: email || '', // Allow empty email
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
            // Use customer_verification template for loan creation, login template for customer registration
            const templatePurpose = req.body.purpose === 'loan_creation' ? 'customer_verification' : 'login';
            const smsResult = await smsService.sendOTP(primaryMobile, otp, templatePurpose);
            
            if (!smsResult.success) {
                console.error('Failed to send SMS OTP:', smsResult.error);
                return res.status(500).json({ errors: [{ msg: 'Failed to send SMS OTP. Please check the mobile number or try again later.' }] });
            }
            
            console.log(`[ADMIN] SMS OTP sent successfully to ${primaryMobile}`);
        } catch (smsErr) {
            console.error('Failed to send SMS OTP:', smsErr);
            return res.status(500).json({ errors: [{ msg: 'Failed to send SMS OTP. Please check the mobile number or try again later.' }] });
        }
        
        res.json({ 
            success: true, 
            message: email && email.trim() 
                ? 'OTP sent to mobile number for verification.' 
                : 'Customer created successfully. OTP sent to mobile number for verification.'
        });
    } catch (err) {
        if (err.code === 11000 && err.keyPattern && err.keyPattern.primaryMobile) {
            return res.status(400).json({ errors: [{ msg: 'This primary mobile number is already registered. Please use a different number.' }] });
        }
        // Email is no longer unique, so no need to handle email duplicates
        console.error('Error adding customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/admin/verify-customer-otp
// @desc    Verify customer OTP (SMS-based)
router.post('/verify-customer-otp', [auth, adminAuth], async (req, res) => {
    try {
        const { email, otp, phoneNumber } = req.body;
        console.log(`[ADMIN] Verifying OTP for email: ${email}, phone: ${phoneNumber}, OTP: ${otp}`);
        
        if (!otp) {
            return res.status(400).json({ message: 'OTP is required' });
        }
        
        // Find OTP by phone number (primary) or email (fallback)
        let otpDoc;
        if (phoneNumber && phoneNumber.trim()) {
            otpDoc = await Otp.findOne({ 
                phoneNumber: phoneNumber.trim(), 
                otp: String(otp).trim(), 
                purpose: 'customer_registration' 
            });
        } else if (email && email.trim()) {
            otpDoc = await Otp.findOne({ 
                email: email.trim(), 
                otp: String(otp).trim(), 
                purpose: 'customer_registration' 
            });
        } else {
            return res.status(400).json({ message: 'Either phone number or email is required for OTP verification' });
        }
        
        console.log(`[ADMIN] OTP document found:`, otpDoc ? 'Yes' : 'No');
        
        if (!otpDoc) {
            return res.status(400).json({ message: 'Invalid OTP. Please check the OTP and try again.' });
        }
        
        if (otpDoc.expiresAt < new Date()) {
            console.log(`[ADMIN] OTP expired. Expires at: ${otpDoc.expiresAt}, Current time: ${new Date()}`);
            return res.status(400).json({ message: 'OTP has expired. Please request a new OTP.' });
        }
        
        // Set customer as verified - find by phone number or email
        let customer;
        if (phoneNumber && phoneNumber.trim()) {
            customer = await Customer.findOneAndUpdate(
                { primaryMobile: phoneNumber.trim() }, 
                { verified: true }, 
                { new: true }
            );
        } else if (email && email.trim()) {
            customer = await Customer.findOneAndUpdate(
                { email: email.trim() }, 
                { verified: true }, 
                { new: true }
            );
        }
        
        // Clean up OTP
        if (phoneNumber && phoneNumber.trim()) {
            await Otp.deleteMany({ phoneNumber: phoneNumber.trim() });
        } else if (email && email.trim()) {
            await Otp.deleteMany({ email: email.trim() });
        }
        
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        
        console.log(`[ADMIN] Customer verified successfully: ${customer.name}`);
        res.json({ success: true, message: 'Customer verified successfully', customer });
    } catch (err) {
        console.error('Error verifying OTP:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/admin/process-interest-rate-upgrades
// @desc    Manually trigger interest rate upgrade process
// @access  Private (Admin only)
router.post('/process-interest-rate-upgrades', [auth, adminAuth], async (req, res) => {
    try {
        console.log('🔄 Manual interest rate upgrade process triggered by admin:', req.user.email);
        
        const result = await processInterestRateUpgrades();
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Interest rate upgrade process completed successfully',
                data: result
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Interest rate upgrade process failed',
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error in manual interest rate upgrade:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during interest rate upgrade process',
            error: error.message 
        });
    }
});

// @route   POST /api/admin/fix-loan-calculation/:loanId
// @desc    Recalculate and fix loan amounts using correct Muthoot method
// @access  Private (Admin only)
router.post('/fix-loan-calculation/:loanId', [auth, adminAuth], async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.loanId);
        
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        
        console.log(`🔧 Fixing calculation for loan ${loan.loanId}...`);
        console.log(`   Current values: Total ₹${loan.totalPayment}, Monthly ₹${loan.monthlyPayment}`);
        
        // Calculate correct values using Muthoot method
        const loanStartDate = loan.createdAt;
        const loanEndDate = new Date(loanStartDate);
        loanEndDate.setMonth(loanEndDate.getMonth() + loan.term);
        
        const { totalAmount, totalInterest } = calculateMuthootGoldLoanInterest({
            principal: loan.amount,
            annualRate: loan.interestRate,
            disbursementDate: loanStartDate,
            closureDate: loanEndDate
        });
        
        const correctMonthlyPayment = Math.round(totalAmount / loan.term);
        
        // Update the loan with correct values
        loan.totalPayment = totalAmount;
        loan.monthlyPayment = correctMonthlyPayment;
        loan.remainingBalance = Math.max(0, totalAmount - (loan.totalPaid || 0));
        
        await loan.save();
        
        console.log(`✅ Loan ${loan.loanId} fixed!`);
        console.log(`   New values: Total ₹${totalAmount}, Monthly ₹${correctMonthlyPayment}`);
        
        res.json({
            success: true,
            message: 'Loan calculation fixed successfully',
            data: {
                loanId: loan.loanId,
                oldTotalPayment: loan.totalPayment,
                newTotalPayment: totalAmount,
                oldMonthlyPayment: loan.monthlyPayment,
                newMonthlyPayment: correctMonthlyPayment,
                totalInterest: totalInterest
            }
        });
        
    } catch (error) {
        console.error('Error fixing loan calculation:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fixing loan calculation',
            error: error.message 
        });
    }
});

// @route   GET /api/admin/interest-rate-upgrade-statistics
// @desc    Get statistics about loans eligible for interest rate upgrade
// @access  Private (Admin only)
router.get('/interest-rate-upgrade-statistics', [auth, adminAuth], async (req, res) => {
    try {
        const stats = await getUpgradeStatistics();
        
        if (stats) {
            res.json({
                success: true,
                data: stats
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve upgrade statistics'
            });
        }
    } catch (error) {
        console.error('Error getting upgrade statistics:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while retrieving statistics',
            error: error.message 
        });
    }
});

// @route   POST /api/admin/loans/:loanId/mark-ready-for-auction-36-percent
// @desc    Mark a loan as ready for auction after reaching 36% interest rate
// @access  Private (Admin only)
router.post('/loans/:loanId/mark-ready-for-auction-36-percent', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        const { notes } = req.body;
        
        const loan = await Loan.findById(loanId);
        
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        
        const markedBy = {
            id: req.user.id,
            name: req.user.name
        };
        
        // Mark loan as ready for auction after 36% upgrade
        await loan.markReadyForAuctionAfter36Percent(notes || '', markedBy);
        
        // Create notification
        await Notification.createAuctionWarningNotification(loan, {});
        
        // Send email notification to customer
        try {
            await sendBrevoEmail({
                to: loan.email,
                subject: 'URGENT: Final Interest Rate Reached - Loan Ready for Auction',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #dc2626;">⚠️ URGENT: Final Interest Rate Reached - Loan Ready for Auction</h2>
                        <p>Dear ${loan.name},</p>
                        <p>We are writing to inform you that your loan has reached the final interest rate (36%) and is now ready for auction due to non-payment.</p>
                        
                        <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <h3 style="color: #dc2626; margin-top: 0;">Loan Details:</h3>
                            <p><strong>Loan ID:</strong> ${loan.loanId}</p>
                            <p><strong>Current Interest Rate:</strong> 36% (Final Level)</p>
                            <p><strong>Outstanding Amount:</strong> ₹${loan.remainingBalance.toLocaleString()}</p>
                            <p><strong>Date Marked for Auction:</strong> ${new Date().toDateString()}</p>
                        </div>
                        
                        <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #92400e;"><strong>⚠️ URGENT ACTION REQUIRED:</strong> Your loan has reached the maximum interest rate (36%) and is now ready for auction. Please pay the full outstanding amount immediately to avoid auction of your gold items.</p>
                        </div>
                        
                        <p>To avoid auction, please:</p>
                        <ul>
                            <li>Visit our office immediately with full payment</li>
                            <li>Contact us at +91-9700049444</li>
                            <li>Email us at support@cyanfinance.in</li>
                        </ul>
                        
                        <p>If you have any questions, please contact us immediately.</p>
                        
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    </div>
                `
            });
            console.log(`📧 36% auction warning email sent to ${loan.email}`);
        } catch (emailError) {
            console.error(`❌ Failed to send 36% auction email to ${loan.email}:`, emailError.message);
        }
        
        // Send SMS notification
        try {
            const smsMessage = `URGENT: Loan ${loan.loanId} reached 36% interest rate and marked for auction. Outstanding: ₹${loan.remainingBalance.toLocaleString()}. Pay immediately to avoid auction. Contact: +91-9700049444 - Cyan Finance`;
            await sendSMS(loan.primaryMobile, smsMessage);
            console.log(`📱 36% auction warning SMS sent to ${loan.primaryMobile}`);
        } catch (smsError) {
            console.error(`❌ Failed to send 36% auction SMS to ${loan.primaryMobile}:`, smsError.message);
        }
        
        res.json({
            success: true,
            message: 'Loan marked as ready for auction after reaching 36% interest rate and notifications sent',
            data: loan.getAuctionSummary()
        });
        
    } catch (error) {
        console.error('Error marking loan for auction after 36%:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while marking loan for auction after 36%',
            error: error.message
        });
    }
});

// @route   POST /api/admin/loans/:loanId/mark-ready-for-auction
// @desc    Mark a loan as ready for auction
// @access  Private (Admin only)
router.post('/loans/:loanId/mark-ready-for-auction', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        const { notes } = req.body;
        
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        
        const markedBy = {
            id: req.user.id,
            name: req.user.name
        };
        
        // Mark loan as ready for auction
        await loan.markReadyForAuction(notes || '', markedBy);
        
        // Create system notification
        await Notification.createAuctionWarningNotification(loan, {});
        
        // Send email notification to customer
        try {
            await sendBrevoEmail({
                to: loan.email,
                subject: 'URGENT: Loan Ready for Auction - Immediate Payment Required',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #dc2626;">⚠️ URGENT: Loan Ready for Auction</h2>
                        <p>Dear ${loan.name},</p>
                        <p>We are writing to inform you that due to non-payment of your loan, we are preparing for auction of your gold items.</p>
                        
                        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                            <h3 style="color: #dc2626; margin-top: 0;">Loan Details:</h3>
                            <p><strong>Loan ID:</strong> ${loan.loanId}</p>
                            <p><strong>Outstanding Amount:</strong> ₹${loan.remainingBalance.toLocaleString()}</p>
                            <p><strong>Total Gold Weight:</strong> ${loan.goldItems ? loan.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0} grams</p>
                            <p><strong>Date Marked for Auction:</strong> ${new Date().toDateString()}</p>
                        </div>
                        
                        <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #92400e;"><strong>⚠️ URGENT ACTION REQUIRED:</strong> Please pay the full outstanding amount immediately to avoid auction of your gold items.</p>
                        </div>
                        
                        <p>To avoid auction, please:</p>
                        <ul>
                            <li>Visit our office immediately</li>
                            <li>Pay the full outstanding amount</li>
                            <li>Contact us to discuss payment options</li>
                        </ul>
                        
                        <p>If you have any questions or need to discuss payment arrangements, please contact us immediately:</p>
                        <ul>
                            <li>Phone: +91-9700049444</li>
                            <li>Email: support@cyanfinance.in</li>
                        </ul>
                        
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    </div>
                `
            });
            console.log(`📧 Auction warning email sent to ${loan.email}`);
        } catch (emailError) {
            console.error(`❌ Failed to send auction email to ${loan.email}:`, emailError.message);
        }
        
        // Send SMS notification
        try {
            const smsMessage = `URGENT: Loan ${loan.loanId} marked for auction due to non-payment. Outstanding: ₹${loan.remainingBalance.toLocaleString()}. Pay immediately to avoid auction. Contact: +91-9700049444 - Cyan Finance`;
            await sendSMS(loan.primaryMobile, smsMessage);
            console.log(`📱 Auction warning SMS sent to ${loan.primaryMobile}`);
        } catch (smsError) {
            console.error(`❌ Failed to send auction SMS to ${loan.primaryMobile}:`, smsError.message);
        }
        
        res.json({
            success: true,
            message: 'Loan marked as ready for auction and notifications sent',
            data: loan.getAuctionSummary()
        });
        
    } catch (error) {
        console.error('Error marking loan for auction:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while marking loan for auction',
            error: error.message 
        });
    }
});

// @route   POST /api/admin/loans/:loanId/schedule-auction
// @desc    Schedule auction for a loan
// @access  Private (Admin only)
router.post('/loans/:loanId/schedule-auction', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        const { auctionDate, notes } = req.body;
        
        if (!auctionDate) {
            return res.status(400).json({ message: 'Auction date is required' });
        }
        
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        
        const scheduledBy = {
            id: req.user.id,
            name: req.user.name
        };
        
        const auctionDateObj = new Date(auctionDate);
        
        // Schedule auction
        await loan.scheduleAuction(auctionDateObj, notes || '', scheduledBy);
        
        // Create system notification
        await Notification.createAuctionScheduledNotification(loan, auctionDateObj);
        
        // Send email notification to customer
        try {
            await sendBrevoEmail({
                to: loan.email,
                subject: 'Auction Scheduled - Final Warning',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #dc2626;">🚨 Auction Scheduled - Final Warning</h2>
                        <p>Dear ${loan.name},</p>
                        <p>We are writing to inform you that an auction has been scheduled for your loan due to non-payment.</p>
                        
                        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                            <h3 style="color: #dc2626; margin-top: 0;">Auction Details:</h3>
                            <p><strong>Loan ID:</strong> ${loan.loanId}</p>
                            <p><strong>Auction Date:</strong> ${auctionDateObj.toDateString()}</p>
                            <p><strong>Outstanding Amount:</strong> ₹${loan.remainingBalance.toLocaleString()}</p>
                            <p><strong>Total Gold Weight:</strong> ${loan.goldItems ? loan.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0} grams</p>
                        </div>
                        
                        <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #92400e;"><strong>🚨 FINAL WARNING:</strong> Please pay the full outstanding amount before ${auctionDateObj.toDateString()} to avoid auction of your gold items.</p>
                        </div>
                        
                        <p>To avoid auction, please:</p>
                        <ul>
                            <li>Visit our office before the auction date</li>
                            <li>Pay the full outstanding amount</li>
                            <li>Contact us immediately to discuss payment options</li>
                        </ul>
                        
                        <p>If you have any questions, please contact us immediately:</p>
                        <ul>
                            <li>Phone: +91-9700049444</li>
                            <li>Email: support@cyanfinance.in</li>
                        </ul>
                        
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    </div>
                `
            });
            console.log(`📧 Auction scheduled email sent to ${loan.email}`);
        } catch (emailError) {
            console.error(`❌ Failed to send auction scheduled email to ${loan.email}:`, emailError.message);
        }
        
        res.json({
            success: true,
            message: 'Auction scheduled and notifications sent',
            data: loan.getAuctionSummary()
        });
        
    } catch (error) {
        console.error('Error scheduling auction:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while scheduling auction',
            error: error.message 
        });
    }
});

// @route   POST /api/admin/loans/:loanId/mark-auctioned
// @desc    Mark a loan as auctioned
// @access  Private (Admin only)
router.post('/loans/:loanId/mark-auctioned', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        const { auctionDate, notes } = req.body;
        
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        
        const auctionedBy = {
            id: req.user.id,
            name: req.user.name
        };
        
        const auctionDateObj = auctionDate ? new Date(auctionDate) : new Date();
        
        // Mark loan as auctioned
        await loan.markAsAuctioned(auctionDateObj, notes || '', auctionedBy);
        
        // Create system notification
        await Notification.createAuctionFinalWarningNotification(loan, auctionDateObj);
        
        // Send email notification to customer
        try {
            await sendBrevoEmail({
                to: loan.email,
                subject: 'Gold Items Auctioned - Loan Closed',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #dc2626;">Gold Items Auctioned</h2>
                        <p>Dear ${loan.name},</p>
                        <p>We are writing to inform you that your loan has been auctioned due to non-payment.</p>
                        
                        <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                            <h3 style="color: #dc2626; margin-top: 0;">Auction Details:</h3>
                            <p><strong>Loan ID:</strong> ${loan.loanId}</p>
                            <p><strong>Auction Date:</strong> ${auctionDateObj.toDateString()}</p>
                            <p><strong>Outstanding Amount:</strong> ₹${loan.remainingBalance.toLocaleString()}</p>
                            <p><strong>Total Gold Weight:</strong> ${loan.goldItems ? loan.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0} grams</p>
                        </div>
                        
                        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                            <p style="margin: 0; color: #374151;">Your gold items have been sold to recover the outstanding loan amount. The loan has been closed.</p>
                        </div>
                        
                        <p>If you have any questions, please contact us:</p>
                        <ul>
                            <li>Phone: +91-9700049444</li>
                            <li>Email: support@cyanfinance.in</li>
                        </ul>
                        
                        <p>Best regards,<br/>Cyan Finance Team</p>
                    </div>
                `
            });
            console.log(`📧 Auction completed email sent to ${loan.email}`);
        } catch (emailError) {
            console.error(`❌ Failed to send auction completed email to ${loan.email}:`, emailError.message);
        }
        
        res.json({
            success: true,
            message: 'Loan marked as auctioned and notifications sent',
            data: loan.getAuctionSummary()
        });
        
    } catch (error) {
        console.error('Error marking loan as auctioned:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while marking loan as auctioned',
            error: error.message 
        });
    }
});

// @route   GET /api/admin/loans-ready-for-36-percent-auction
// @desc    Get all loans at 36% interest rate that can be marked for auction
// @access  Private (Admin only)
router.get('/loans-ready-for-36-percent-auction', [auth, adminAuth], async (req, res) => {
    try {
        const loans = await Loan.find({
            status: 'active',
            interestRate: 36,
            currentUpgradeLevel: 3,
            auctionStatus: { $in: ['not_ready', 'cancelled'] }
        }).sort({ createdAt: -1 });
        
        const eligibleLoans = loans.map(loan => ({
            _id: loan._id,
            loanId: loan.loanId,
            name: loan.name,
            email: loan.email,
            primaryMobile: loan.primaryMobile,
            amount: loan.amount,
            interestRate: loan.interestRate,
            currentUpgradeLevel: loan.currentUpgradeLevel,
            totalPayment: loan.totalPayment,
            remainingBalance: loan.remainingBalance,
            createdAt: loan.createdAt,
            interestRateUpgradeDate: loan.interestRateUpgradeDate,
            auctionStatus: loan.auctionStatus,
            daysSinceUpgrade: loan.interestRateUpgradeDate ? 
                Math.floor((new Date() - loan.interestRateUpgradeDate) / (1000 * 60 * 60 * 24)) : 0
        }));
        
        res.json({
            success: true,
            data: eligibleLoans,
            count: eligibleLoans.length
        });
        
    } catch (error) {
        console.error('Error fetching loans ready for 36% auction:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching loans ready for 36% auction',
            error: error.message
        });
    }
});

// @route   GET /api/admin/auction-loans
// @desc    Get all loans ready for auction or scheduled for auction
// @access  Private (Admin only)
router.get('/auction-loans', [auth, adminAuth], async (req, res) => {
    try {
        const loans = await Loan.find({
            auctionStatus: { $in: ['ready_for_auction', 'auction_scheduled'] }
        }).sort({ auctionReadyDate: -1 });
        
        const auctionLoans = loans.map(loan => loan.getAuctionSummary());
        
        res.json({
            success: true,
            data: auctionLoans
        });
        
    } catch (error) {
        console.error('Error fetching auction loans:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error while fetching auction loans',
            error: error.message 
        });
    }
});

// @route   GET /api/admin/loans/:loanId/upgrade-history
// @desc    Get upgrade history for a specific loan
router.get('/loans/:loanId/upgrade-history', [auth, adminAuth], async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.loanId);
        
        if (!loan) {
            return res.status(404).json({
                success: false,
                message: 'Loan not found'
            });
        }
        
        const upgradeHistory = loan.getUpgradeHistory();
        const timeline = loan.getUpgradeTimeline();
        
        res.json({
            success: true,
            data: {
                upgradeHistory,
                timeline
            }
        });
    } catch (error) {
        console.error('Error fetching upgrade history:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching upgrade history',
            error: error.message
        });
    }
});

// @route   GET /api/admin/loans-with-upgrades
// @desc    Get all loans with upgrade history (highlighted loans)
router.get('/loans-with-upgrades', [auth, adminAuth], async (req, res) => {
    try {
        const { page = 1, limit = 10, status = 'active' } = req.query;
        const skip = (page - 1) * limit;
        
        // Find loans that have been upgraded
        const loans = await Loan.find({
            status: status,
            currentUpgradeLevel: { $gt: 0 }
        })
        .populate('createdBy', 'name email')
        .sort({ interestRateUpgradeDate: -1 })
        .skip(skip)
        .limit(parseInt(limit));
        
        // Get total count
        const total = await Loan.countDocuments({
            status: status,
            currentUpgradeLevel: { $gt: 0 }
        });
        
        // Add upgrade history summary to each loan
        const loansWithHistory = loans.map(loan => {
            const upgradeHistory = loan.getUpgradeHistory();
            return {
                _id: loan._id,
                loanId: loan.loanId,
                customerName: loan.name,
                customerMobile: loan.primaryMobile,
                customerEmail: loan.email,
                amount: loan.amount,
                originalInterestRate: loan.originalInterestRate,
                currentInterestRate: loan.interestRate,
                currentUpgradeLevel: loan.currentUpgradeLevel,
                totalUpgrades: upgradeHistory.totalUpgrades,
                lastUpgradeDate: upgradeHistory.lastUpgradeDate,
                nextUpgradeInfo: upgradeHistory.nextUpgradeInfo,
                isAtFinalLevel: upgradeHistory.isAtFinalLevel,
                remainingBalance: loan.remainingBalance,
                status: loan.status,
                createdAt: loan.createdAt,
                createdBy: loan.createdBy,
                // Highlighting information
                isHighlighted: true,
                highlightReason: `Upgraded ${upgradeHistory.totalUpgrades} time(s) - Current: ${loan.interestRate}%`,
                highlightColor: loan.currentUpgradeLevel === 3 ? 'red' : 
                              loan.currentUpgradeLevel === 2 ? 'orange' : 'yellow'
            };
        });
        
        res.json({
            success: true,
            data: {
                loans: loansWithHistory,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / limit),
                    totalLoans: total,
                    hasNext: skip + loans.length < total,
                    hasPrev: page > 1
                }
            }
        });
    } catch (error) {
        console.error('Error fetching loans with upgrades:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching loans with upgrades',
            error: error.message
        });
    }
});

// @route   GET /api/admin/upgrade-statistics
// @desc    Get upgrade statistics and summary
router.get('/upgrade-statistics', [auth, adminAuth], async (req, res) => {
    try {
        const stats = await getUpgradeStatistics();
        
        // Get additional upgrade history statistics
        const upgradeHistoryStats = await Loan.aggregate([
            {
                $match: { status: 'active' }
            },
            {
                $group: {
                    _id: null,
                    totalLoans: { $sum: 1 },
                    upgradedLoans: {
                        $sum: {
                            $cond: [{ $gt: ['$currentUpgradeLevel', 0] }, 1, 0]
                        }
                    },
                    level1Upgrades: {
                        $sum: {
                            $cond: [{ $eq: ['$currentUpgradeLevel', 1] }, 1, 0]
                        }
                    },
                    level2Upgrades: {
                        $sum: {
                            $cond: [{ $eq: ['$currentUpgradeLevel', 2] }, 1, 0]
                        }
                    },
                    level3Upgrades: {
                        $sum: {
                            $cond: [{ $eq: ['$currentUpgradeLevel', 3] }, 1, 0]
                        }
                    },
                    totalUpgradeHistoryEntries: {
                        $sum: { $size: { $ifNull: ['$upgradeHistory', []] } }
                    }
                }
            }
        ]);
        
        const historyStats = upgradeHistoryStats[0] || {
            totalLoans: 0,
            upgradedLoans: 0,
            level1Upgrades: 0,
            level2Upgrades: 0,
            level3Upgrades: 0,
            totalUpgradeHistoryEntries: 0
        };
        
        res.json({
            success: true,
            data: {
                ...stats,
                upgradeHistory: historyStats,
                upgradeRate: historyStats.totalLoans > 0 ? 
                    (historyStats.upgradedLoans / historyStats.totalLoans * 100).toFixed(2) : 0
            }
        });
    } catch (error) {
        console.error('Error fetching upgrade statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching upgrade statistics',
            error: error.message
        });
    }
});

// @route   POST /api/admin/loans/:loanId/renew
// @desc    Renew a closed loan
// @access  Private (Admin only)
router.post('/loans/:loanId/renew', [auth, adminAuth, [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('interestRate').isIn([18, 24, 30, 36]).withMessage('Interest rate must be 18%, 24%, 30%, or 36%'),
    body('term').isIn([3, 6, 12]).withMessage('Term must be 3, 6, or 12 months')
]], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { loanId } = req.params;
        const { amount, interestRate, term } = req.body;

        // Find the loan
        const loan = await Loan.findById(loanId);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Check if loan is closed
        if (loan.status !== 'closed') {
            return res.status(400).json({ message: 'Only closed loans can be renewed' });
        }

        // Calculate new loan details using Muthoot method
        const disbursementDate = new Date();
        const closureDate = new Date(disbursementDate);
        closureDate.setMonth(closureDate.getMonth() + term);
        
        const muthootResult = calcMuthoot({
            principal: amount,
            annualRate: interestRate,
            disbursementDate: disbursementDate,
            closureDate: closureDate
        });

        // Calculate daily interest fields
        const dailyInterestRate = (interestRate / 100) / 365;
        const totalDays = term * 30;
        const dailyInterestAmount = amount * dailyInterestRate;

        // Update loan with renewal details
        loan.amount = amount;
        loan.interestRate = interestRate;
        loan.term = term;
        loan.status = 'active';
        loan.createdAt = disbursementDate; // Update to present date
        loan.monthlyPayment = muthootResult.monthlyPayment;
        loan.totalPayment = muthootResult.totalAmount;
        loan.remainingBalance = muthootResult.totalAmount;
        loan.totalPaid = 0; // Reset total paid
        loan.dailyInterestRate = dailyInterestRate;
        loan.totalDays = totalDays;
        loan.dailyInterestAmount = dailyInterestAmount;
        loan.closedDate = null; // Remove closed date

        // Reset payments array
        loan.payments = [];

        // Create new installment schedule
        loan.installments = [];
        let currentDate = new Date(disbursementDate);
        
        for (let i = 1; i <= term; i++) {
            currentDate = new Date(currentDate);
            currentDate.setMonth(currentDate.getMonth() + 1);
            
            loan.installments.push({
                number: i,
                dueDate: new Date(currentDate),
                amount: loan.monthlyPayment,
                status: 'pending',
                amountPaid: 0
            });
        }

        await loan.save();

        // Create notification for loan renewal
        const notification = new Notification({
            loanId: loan._id,
            type: 'new_loan',
            title: 'Loan Renewed',
            message: `Your loan ${loan.loanId} has been renewed with amount ₹${amount.toLocaleString()} for ${term} months at ${interestRate}% interest rate.`,
            customerName: loan.name,
            customerMobile: loan.primaryMobile,
            amount: amount,
            isRead: false
        });
        await notification.save();

        res.json({
            success: true,
            message: 'Loan renewed successfully',
            data: {
                loanId: loan.loanId,
                amount: loan.amount,
                interestRate: loan.interestRate,
                term: loan.term,
                status: loan.status,
                renewedAt: disbursementDate
            }
        });

    } catch (error) {
        console.error('Error renewing loan:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while renewing loan',
            error: error.message
        });
    }
});

// @route   POST /api/admin/reset-loan-upgrade/:loanId
// @desc    Reset loan upgrade history for testing purposes
router.post('/reset-loan-upgrade/:loanId', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        
        // Find the loan
        const loan = await Loan.findOne({ loanId: loanId });
        if (!loan) {
            return res.status(404).json({
                success: false,
                message: 'Loan not found'
            });
        }
        
        // Reset upgrade history and related fields
        loan.upgradeHistory = [];
        loan.currentUpgradeLevel = 0;
        loan.interestRate = loan.originalInterestRate;
        loan.interestRateUpgraded = false;
        loan.interestRateUpgradeDate = undefined;
        loan.interestRateUpgradeReason = undefined;
        
        // Reset auction status
        loan.auctionStatus = 'not_ready';
        loan.auctionReadyDate = undefined;
        loan.auctionScheduledDate = undefined;
        loan.auctionDate = undefined;
        loan.auctionNotes = undefined;
        loan.auctionNotifications = [];
        
        // Recalculate original loan details
        const disbursementDate = loan.createdAt;
        const closureDate = new Date(disbursementDate);
        closureDate.setMonth(closureDate.getMonth() + loan.term);
        
        const muthootResult = calculateClientInterestMethod({
            principal: loan.amount,
            annualRate: loan.originalInterestRate,
            disbursementDate: disbursementDate,
            closureDate: closureDate,
            termMonths: loan.term
        });
        
        // Update loan with original calculations
        loan.monthlyPayment = muthootResult.monthlyPayment;
        loan.totalPayment = muthootResult.totalAmount;
        loan.remainingBalance = Math.max(0, muthootResult.totalAmount - loan.totalPaid);
        
        // Recreate installment schedule
        loan.installments = [];
        let currentDate = new Date(loan.createdAt);
        
        for (let i = 1; i <= loan.term; i++) {
            currentDate = new Date(currentDate);
            currentDate.setMonth(currentDate.getMonth() + 1);
            
            loan.installments.push({
                number: i,
                dueDate: new Date(currentDate),
                amount: loan.monthlyPayment,
                status: 'pending',
                amountPaid: 0
            });
        }
        
        await loan.save();
        
        res.json({
            success: true,
            message: 'Loan upgrade history reset successfully',
            loan: {
                loanId: loan.loanId,
                customerName: loan.name,
                originalInterestRate: loan.originalInterestRate,
                currentInterestRate: loan.interestRate,
                currentUpgradeLevel: loan.currentUpgradeLevel,
                upgradeHistory: loan.upgradeHistory,
                monthlyPayment: loan.monthlyPayment,
                totalPayment: loan.totalPayment
            }
        });
        
    } catch (error) {
        console.error('Error resetting loan upgrade:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while resetting loan upgrade',
            error: error.message
        });
    }
});

// @route   POST /api/admin/manual-upgrade/:loanId
// @desc    Manually trigger loan upgrade for testing
router.post('/manual-upgrade/:loanId', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId } = req.params;
        
        // Find the loan
        const loan = await Loan.findOne({ loanId: loanId });
        if (!loan) {
            return res.status(404).json({
                success: false,
                message: 'Loan not found'
            });
        }
        
        // Check if loan is eligible for upgrade
        if (loan.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: 'Loan is not active'
            });
        }
        
        if (loan.currentUpgradeLevel >= 3) {
            return res.status(400).json({
                success: false,
                message: 'Loan has reached maximum upgrade level'
            });
        }
        
        // Trigger the upgrade
        const upgradeResult = await loan.upgradeInterestRate('manual_upgrade');
        
        res.json({
            success: true,
            message: 'Loan upgraded successfully',
            upgradeDetails: upgradeResult
        });
        
    } catch (error) {
        console.error('Error in manual upgrade:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during manual upgrade',
            error: error.message
        });
    }
});

module.exports = router; 