const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const Customer = require('../models/Customer');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { sendBrevoEmail } = require('../utils/brevo');
const Otp = require('../models/Otp');
const { calculateMuthootGoldLoanInterest: calcMuthoot, calculateClientInterestMethod } = require('../utils/interestCalculator');

// @route   GET /api/employee/check-aadhar/:aadharNumber
// @desc    Check if an Aadhar number exists and get customer details (employee access)
router.get('/check-aadhar/:aadharNumber', auth, async (req, res) => {
    try {
        const loan = await Loan.findOne({
            $or: [
                { aadharNumber: req.params.aadharNumber },
                { customerId: req.params.aadharNumber }
            ]
        });
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
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/employee/loans
// @desc    Get all loans (employee access)
router.get('/loans', auth, async (req, res) => {
    try {
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        // Show all except loans closed > 1 month ago
        const loans = await Loan.find({
            $or: [
                { status: { $ne: 'closed' } },
                { status: 'closed', $or: [ { closedDate: { $exists: false } }, { closedDate: { $gte: oneMonthAgo } } ] }
            ]
        }).sort({ createdAt: -1 }).populate('createdBy', 'name email role').populate('customerId', 'aadharNumber name mobile email');
        
        // Add upgrade history information to each loan
        const loansWithUpgradeInfo = loans.map(loan => {
            const loanObj = loan.toObject();
            const hasUpgradeHistory = loan.upgradeHistory && loan.upgradeHistory.length > 0;
            
            return {
                ...loanObj,
                hasUpgradeHistory,
                upgradeHistory: hasUpgradeHistory ? loan.upgradeHistory : []
            };
        });
        
        res.json({
            success: true,
            data: loansWithUpgradeInfo
        });
    } catch (err) {
        console.error('Error fetching loans:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/employee/customers
// @desc    Get all customers who have taken at least one loan (employee access)
router.get('/customers', auth, async (req, res) => {
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
                $project: {
                    aadharNumber: '$_id',
                    mongoId: 1,
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
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/employee/loans
// @desc    Create a new loan as employee
router.post('/loans', [
    auth,
    body('aadharNumber').matches(/^[0-9]{12}$/).withMessage('Aadhar number must be exactly 12 digits'),
    body('amount').isNumeric().withMessage('Loan amount must be a number').isFloat({ min: 100 }).withMessage('Loan amount must be at least 100'),
    body('term').isIn([3, 6, 12]).withMessage('Duration must be 3, 6, or 12 months'),
    body('interestRate').isIn([18, 24, 30, 36]).withMessage('Interest rate must be 18%, 24%, 30%, or 36%'),
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
            loanAmount,
            term,
            duration,
            monthlyPayment,
            totalPayment
        } = req.body;

        // Use the correct field names, falling back to alternates if needed
        const finalAmount = amount || loanAmount;
        const finalTerm = term || duration;

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

// @route   POST /api/employee/customers
// @desc    Add or verify a customer and send OTP for email verification (employee access)
router.post('/customers', auth, async (req, res) => {
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
        let isNewCustomer = false;
        if (!customer) {
            // Create customer with verified: false
            customer = new Customer({
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
        }
        // Generate OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
        console.log(`[EMPLOYEE] Generated OTP ${otp} for mobile ${primaryMobile}, expires at ${expiresAt}`);
        
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
            
            console.log(`[EMPLOYEE] SMS OTP sent successfully to ${primaryMobile}`);
        } catch (smsErr) {
            console.error('Failed to send SMS OTP:', smsErr);
            return res.status(500).json({ errors: [{ msg: 'Failed to send SMS OTP. Please check the mobile number or try again later.' }] });
        }
        
        // Save customer
        if (isNewCustomer) {
            await customer.save();
        } else {
            await customer.save();
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
        if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
            return res.status(400).json({ errors: [{ msg: 'This email is already registered. Please use a different email.' }] });
        }
        console.error('Error adding customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/employee/verify-customer-otp
// @desc    Verify customer OTP (SMS-based, employee access)
router.post('/verify-customer-otp', auth, async (req, res) => {
    try {
        const { email, otp, phoneNumber } = req.body;
        console.log(`[EMPLOYEE] Verifying OTP for email: ${email}, phone: ${phoneNumber}, OTP: ${otp}`);
        
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
        
        console.log(`[EMPLOYEE] OTP document found:`, otpDoc ? 'Yes' : 'No');
        
        if (!otpDoc) {
            return res.status(400).json({ message: 'Invalid OTP. Please check the OTP and try again.' });
        }
        
        if (otpDoc.expiresAt < new Date()) {
            console.log(`[EMPLOYEE] OTP expired. Expires at: ${otpDoc.expiresAt}, Current time: ${new Date()}`);
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
        
        console.log(`[EMPLOYEE] Customer verified successfully: ${customer.name}`);
        res.json({ success: true, message: 'Customer verified successfully', customer });
    } catch (err) {
        console.error('Error verifying OTP:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/employee/customers/:aadharNumber
// @desc    Update customer details (employee access)
router.put('/customers/:aadharNumber', auth, async (req, res) => {
    try {
        const { aadharNumber } = req.params;
        const updateData = req.body;
        
        // Find customer by aadharNumber
        const customer = await Customer.findOne({ aadharNumber });
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found' });
        }
        
        // Update customer fields
        Object.assign(customer, updateData);
        await customer.save();
        
        res.json({ 
            success: true, 
            message: 'Customer updated successfully',
            data: customer
        });
    } catch (err) {
        console.error('Error updating customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/employee/loans/:loanId/upgrade-history
// @desc    Get upgrade history for a specific loan (employee access)
router.get('/loans/:loanId/upgrade-history', auth, async (req, res) => {
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

// @route   GET /api/employee/loans-with-upgrades
// @desc    Get all loans with upgrade history (employee access)
router.get('/loans-with-upgrades', auth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const status = req.query.status || 'active';
        
        const skip = (page - 1) * limit;
        
        // Build query
        const query = {
            status: status,
            upgradeHistory: { $exists: true, $ne: [] }
        };
        
        // Find loans with upgrade history
        const loans = await Loan.find(query)
            .populate('customerId', 'name email mobile aadharNumber')
            .populate('createdBy', 'name email role')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);
        
        // Get total count for pagination
        const totalLoans = await Loan.countDocuments(query);
        const totalPages = Math.ceil(totalLoans / limit);
        
        // Add upgrade history summary to each loan
        const loansWithUpgradeInfo = loans.map(loan => {
            const upgradeHistory = loan.getUpgradeHistory();
            return {
                _id: loan._id,
                loanId: loan.loanId,
                customerName: loan.customerId?.name || loan.name,
                customerEmail: loan.customerId?.email || loan.email,
                customerMobile: loan.customerId?.mobile || loan.primaryMobile,
                amount: loan.amount,
                currentInterestRate: loan.interestRate,
                originalInterestRate: loan.originalInterestRate,
                currentUpgradeLevel: loan.currentUpgradeLevel,
                status: loan.status,
                createdAt: loan.createdAt,
                createdBy: loan.createdBy,
                totalUpgrades: upgradeHistory.totalUpgrades,
                lastUpgradeDate: upgradeHistory.lastUpgradeDate,
                nextUpgradeInfo: upgradeHistory.nextUpgradeInfo,
                isAtFinalLevel: upgradeHistory.isAtFinalLevel,
                highlightReason: `Upgraded ${upgradeHistory.totalUpgrades} time(s) - Current: ${loan.interestRate}%`,
                upgradeHistory: loan.upgradeHistory
            };
        });
        
        res.json({
            success: true,
            data: {
                loans: loansWithUpgradeInfo,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalLoans: totalLoans,
                    hasNext: page < totalPages,
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

// @route   POST /api/employee/loans/:loanId/renew
// @desc    Renew a closed loan
// @access  Private (Employee only)
router.post('/loans/:loanId/renew', [auth, [
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
        const Notification = require('../models/Notification');
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

module.exports = router; 