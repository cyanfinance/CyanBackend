const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const auth = require('../middleware/auth');
const sib = require('sib-api-v3-sdk');
const defaultClient = sib.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;
const nodemailer = require('nodemailer');
const path = require('path');
const { calculateMuthootGoldLoanInterest, calculateClientInterestMethod } = require('../utils/interestCalculator');
const { sendBrevoEmail } = require('../utils/brevo');
const Otp = require('../models/Otp');
const Customer = require('../models/Customer');
const Notification = require('../models/Notification');
const ItemPhoto = require('../models/ItemPhoto');
const { cleanupLoanData, checkOrphanedRecords, cleanupOrphanedRecords } = require('../utils/loanCleanup');
const smsService = require('../utils/smsService');
const { sendOtpEmail } = require('../utils/brevo');
const adminAuth = require('../middleware/adminAuth');

const otpWindowMinutes = 10;

// @route   POST /api/loans
// @desc    Create a new loan application
router.post('/', [auth, [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('purpose').notEmpty().withMessage('Purpose is required'),
    body('term').isIn([3, 6, 12]).withMessage('Term must be 3, 6, or 12 months'),
    // body('interestRate').isIn([18, 24, 30, 36]).withMessage('Interest rate must be 18%, 24%, 30%, or 36%'),
    body('customerId').notEmpty().withMessage('customerId is required'),
    body('email').optional().isEmail().withMessage('Valid email is required')
]], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { amount, purpose, term, interestRate, customerId, email } = req.body;
        // Enforce OTP verification for loan creation (only if email is provided)
        if (email && email.trim()) {
            const now = new Date();
            const otpVerified = await Otp.findOne({
                email,
                customerId,
                purpose: 'loan_creation',
                expiresAt: { $gte: now }
            });
            if (!otpVerified) {
                return res.status(400).json({ errors: [{ msg: 'OTP verification required for loan creation. Please verify OTP sent to customer email.' }] });
            }
            // OTP is valid, delete it to prevent reuse
            await otpVerified.deleteOne();
        }

        // Generate custom loanId
        const year = now.getFullYear() % 1000; // last 3 digits
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        // Count loans for this month
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        const loanCount = await Loan.countDocuments({ createdAt: { $gte: monthStart, $lte: monthEnd } }) + 1;
        const loanId = `CY${year}${month}${loanCount.toString().padStart(2, '0')}`;

        // Calculate daily interest fields
        const dailyInterestRate = (interestRate / 100) / 365;
        const totalDays = term * 30;
        const dailyInterestAmount = amount * dailyInterestRate;

        const loan = await Loan.create({
            user: req.user.id,
            amount,
            purpose,
            term,
            interestRate,
            originalInterestRate: interestRate, // Add this required field
            loanId,
            dailyInterestRate,
            totalDays,
            dailyInterestAmount,
            totalPayment: amount // Only principal at creation
        });

        res.status(201).json({
            success: true,
            data: loan
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans
// @desc    Get all loans for a user
router.get('/', auth, async (req, res) => {
    try {
        const loans = await Loan.find({ user: req.user.id });

        res.json({
            success: true,
            data: loans
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/customer
// @desc    Get all loans for the logged-in customer
router.get('/customer', auth, async (req, res) => {
  try {
    // Only allow customers to access this endpoint
    if (!req.user || (req.user.role && req.user.role !== 'customer')) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Find loans where customerId matches the logged-in customer
    // Include payment information and calculate totals
    const loans = await Loan.find({ customerId: req.user._id });
    
    // Process each loan to include payment totals and remaining balance
    const processedLoans = loans.map(loan => {
      const loanObj = loan.toObject();
      
      // Calculate total paid from payments (include both success and pending payments)
      const totalPaid = loan.payments ? loan.payments.reduce((sum, payment) => {
        return sum + payment.amount; // Include all payments regardless of status
      }, 0) : 0;
      
      // Calculate remaining balance based on loan amount
      const remainingBalance = Math.max(0, loan.amount - totalPaid);
      
      // Determine loan status based on payments
      let loanStatus = loan.status;
      if (totalPaid >= loan.amount) {
        loanStatus = 'closed';
      } else if (totalPaid > 0) {
        loanStatus = 'active';
      }
      
      return {
        ...loanObj,
        totalPaid,
        remainingBalance,
        status: loanStatus,
        monthlyPayment: loan.monthlyPayment || 0
      };
    });
    
    res.json({ success: true, data: processedLoans });
  } catch (err) {
    console.error('Error fetching customer loans:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/loans/pending-repayments
// @desc    Get all unpaid installments for active loans, with filter for upcoming/unpaid
// @access  Admin
router.get('/pending-repayments', auth, adminAuth, async (req, res) => {
  try {
    const filter = req.query.filter || 'all'; // 'all', 'upcoming', 'unpaid'
    const now = new Date();
    // Find all active loans with at least one unpaid installment
    const loans = await Loan.find({ status: 'active', 'installments.status': { $ne: 'paid' } })
      .populate('customerId');
    const pendingList = [];
    for (const loan of loans) {
      // Get all unpaid installments for this loan
      const unpaid = loan.installments.filter(inst => inst.status !== 'paid');
      // Sort by dueDate ascending
      unpaid.sort((a, b) => a.dueDate - b.dueDate);
      // Find the next matching unpaid installment for the filter
      let nextInst = null;
      if (filter === 'all') {
        nextInst = unpaid[0];
      } else if (filter === 'unpaid') {
        nextInst = unpaid.find(inst => inst.dueDate < now);
      } else if (filter === 'upcoming') {
        nextInst = unpaid.find(inst => inst.dueDate >= now);
      }
      if (nextInst) {
        const isOverdue = nextInst.dueDate < now;
        const status = isOverdue ? 'unpaid' : 'upcoming';
        const daysUnpaid = isOverdue ? Math.floor((now - nextInst.dueDate) / (1000 * 60 * 60 * 24)) : 0;
        pendingList.push({
          loanId: loan.loanId,
          customer: loan.customerId ? {
            name: loan.customerId.name || loan.name,
            email: loan.customerId.email || loan.email,
            primaryMobile: loan.customerId.primaryMobile || loan.primaryMobile,
            aadharNumber: loan.customerId.aadharNumber || loan.aadharNumber
          } : {
            name: loan.name,
            email: loan.email,
            primaryMobile: loan.primaryMobile,
            aadharNumber: loan.aadharNumber
          },
          dueDate: nextInst.dueDate,
          amount: nextInst.amount,
          status,
          daysUnpaid,
          loanCreatedDate: loan.createdAt
        });
      }
    }
    res.json({ success: true, data: pendingList });
  } catch (err) {
    console.error('Error fetching pending repayments:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/loans/:id
// @desc    Get loan by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);

        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        // Make sure user owns loan
        if (loan.user.toString() !== req.user.id) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        res.json({
            success: true,
            data: loan
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/loans/:id/payments
// @desc    Get payment history for a loan
router.get('/:id/payments', auth, async (req, res) => {
    try {
        const loan = await Loan.findById(req.params.id);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }
        // Optionally, check if the user is authorized to view this loan's payments
        // if (loan.user.toString() !== req.user.id) {
        //     return res.status(401).json({ message: 'Not authorized' });
        // }
        res.json({ success: true, data: loan.payments || [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
});

async function sendRepaymentEmail({ to, name, amountPaid, totalPaid, totalLoan, toBePaid }) {
  const apiInstance = new sib.TransactionalEmailsApi();
  await apiInstance.sendTransacEmail({
    sender: { email: process.env.EMAIL_FROM, name: 'Cyan Finance' },
    to: [{ email: to, name }],
    subject: 'Loan Repayment Confirmation',
    htmlContent: `
      <p>Dear ${name},</p>
      <p>We have received your repayment of <b>₹${amountPaid}</b>.</p>
      <p><b>Loan Details:</b></p>
      <ul>
        <li>Total Loan Amount: ₹${totalLoan}</li>
        <li>Total Paid: ₹${totalPaid}</li>
        <li>To Be Paid: ₹${toBePaid}</li>
      </ul>
      <p>Thank you for your payment.<br/>Cyan Finance</p>
    `
  });
}

// @route   POST /api/loans/:id/payment
// @desc    Make a payment for a specific loan with receipt and email notification
router.post('/:id/payment', [auth, [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('paymentMethod').isIn(['handcash', 'online']).withMessage('Invalid payment method'),
    body('transactionId').if(body('paymentMethod').equals('online')).notEmpty().withMessage('Transaction ID is required for online payments'),
    body('bankName').if(body('paymentMethod').equals('online')).notEmpty().withMessage('Bank name is required for online payments')
]], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const loan = await Loan.findById(req.params.id);
        if (!loan) {
            return res.status(404).json({ message: 'Loan not found' });
        }

        if (loan.status === 'closed') {
            return res.status(400).json({ message: 'Loan is already closed' });
        }

        const { amount, paymentMethod, transactionId, bankName } = req.body;

        // Record the payment using the new method
        const payment = await loan.recordPayment(
          amount,
          paymentMethod,
          transactionId,
          { id: req.user._id?.toString?.() || req.user.id, name: req.user.name || '' },
          bankName
        );

        // Reload the loan to get updated totals
        await loan.populate();
        await loan.reload && loan.reload(); // for mongoose 7+, otherwise re-query
        const updatedLoan = await Loan.findById(loan._id);

        // Note: PDF receipt generation is now handled on the frontend

        /* Messaging disabled temporarily (only OTPs allowed)
        // Send repayment email with PDF attachment
        try {
            const transporter = nodemailer.createTransport({
                host: 'smtp-relay.brevo.com',
                port: 587,
                auth: {
                    user: process.env.BREVO_SMTP_USER,
                    pass: process.env.BREVO_SMTP_PASS
                }
            });

            // Enhanced email content with installment details
            const emailContent = `
                <p>Dear ${updatedLoan.name},</p>
                <p>We have received your payment of <b>₹${amount}</b> for Loan ID: ${updatedLoan.loanId}</p>
                <p><b>Payment Details:</b></p>
                <ul>
                    <li>Installment Number: ${payment.installmentNumber} of ${updatedLoan.term}</li>
                    <li>Payment Method: ${paymentMethod}</li>
                    ${transactionId ? `<li>Transaction ID: ${transactionId}</li>` : ''}
                </ul>
                <p><b>Loan Status:</b></p>
                <ul>
                    <li>Total Loan Amount: ₹${updatedLoan.amount}</li>
                    <li>Total Paid: ₹${updatedLoan.totalPaid}</li>
                    <li>Remaining Balance: ₹${updatedLoan.remainingBalance}</li>
                </ul>
                <p><b>Next Payment Details:</b></p>
                <ul>
                    ${updatedLoan.status !== 'closed' ? `
                        <li>Next Installment Due: ${updatedLoan.installments.find(i => i.status !== 'paid')?.dueDate.toLocaleDateString()}</li>
                        <li>Amount Due: ₹${updatedLoan.monthlyPayment}</li>
                    ` : `<li>Loan has been fully paid</li><li>Please contact our office to schedule an appointment to collect your items. Thank you.</li>`}
                </ul>
                <p>Thank you for your payment.</p>
                <p>Best regards,<br/>Cyan Finance</p>
            `;

            await transporter.sendMail({
                from: `Cyan Finance <${process.env.EMAIL_FROM}>`,
                to: updatedLoan.email,
                subject: `Payment Confirmation - Loan ${updatedLoan.loanId}`,
                html: emailContent
            });
        } catch (emailErr) {
            console.error('Failed to send repayment email:', emailErr);
        }

        // Send payment update SMS notification
        try {
            if (updatedLoan.primaryMobile) {
                const paymentData = {
                    customerName: updatedLoan.name,
                    amount: amount,
                    status: 'processed',
                    transactionId: transactionId,
                    loanId: updatedLoan.loanId
                };
                
                const smsResult = await smsService.sendPaymentUpdate(updatedLoan.primaryMobile, paymentData);
                console.log('Payment update SMS result:', smsResult);
            }
        } catch (smsErr) {
            console.error('Failed to send payment update SMS:', smsErr);
        }
        */

        // Send response with comprehensive details
        res.json({
            success: true,
            message: updatedLoan.status === 'closed' ? 'Loan repaid and closed successfully' : 'Payment recorded successfully',
            data: {
                payment,
                loanStatus: {
                    loanId: updatedLoan.loanId,
                    totalPaid: updatedLoan.totalPaid,
                    remainingBalance: updatedLoan.remainingBalance,
                    status: updatedLoan.status,
                    installments: updatedLoan.installments.map(inst => ({
                        number: inst.number,
                        dueDate: inst.dueDate,
                        amount: inst.amount,
                        status: inst.status,
                        amountPaid: inst.amountPaid
                    }))
                },
                nextPayment: updatedLoan.status !== 'closed' ? {
                    dueDate: updatedLoan.installments.find(i => i.status !== 'paid')?.dueDate,
                    amount: updatedLoan.monthlyPayment
                } : null
            }
        });
    } catch (err) {
        console.error('Error processing payment:', err);
        res.status(500).json({ message: err.message });
    }
});

// @route   GET /api/loans/customer/:customerId
// @desc    Get all loans for a specific customer
router.get('/customer/:customerId', auth, async (req, res) => {
    try {
        const loans = await Loan.find({ customerId: req.params.customerId });
        res.json({ success: true, data: loans });
    } catch (err) {
        console.error('Error fetching loans for customer:', err);
        res.status(500).json({ message: 'Server error' });
    }
});


// PATCH /api/loans/:loanId/payments/:paymentId/approve
router.patch('/:loanId/payments/:paymentId/approve', auth, async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.loanId);
    if (!loan) return res.status(404).send('Loan not found');
    const payment = loan.payments.id(req.params.paymentId);
    if (!payment) return res.status(404).send('Payment not found');
    if (payment.status === 'success') return res.status(400).send('Payment already approved');

    // Approve the payment
    await loan.approvePayment(payment._id);

    // Reload the loan to get updated totals
    await loan.populate();
    await loan.reload && loan.reload(); // for mongoose 7+, otherwise re-query
    const updatedLoan = await Loan.findById(loan._id);

    // Note: PDF receipt generation is now handled on the frontend

    /* Messaging disabled temporarily (only OTPs allowed)
    // Send repayment email with PDF attachment
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        auth: {
          user: process.env.BREVO_SMTP_USER,
          pass: process.env.BREVO_SMTP_PASS
        }
      });
      const emailContent = `
        <p>Dear ${updatedLoan.name},</p>
        <p>We have received your payment of <b>₹${payment.amount}</b> for Loan ID: ${updatedLoan.loanId}</p>
        <p><b>Payment Details:</b></p>
        <ul>
          <li>Installment Number: ${payment.installmentNumber} of ${updatedLoan.term}</li>
          <li>Payment Method: ${payment.method}</li>
          ${payment.transactionId ? `<li>Transaction ID: ${payment.transactionId}</li>` : ''}
        </ul>
        <p><b>Loan Status:</b></p>
        <ul>
          <li>Total Loan Amount: ₹${updatedLoan.amount}</li>
          <li>Total Paid: ₹${updatedLoan.totalPaid}</li>
          <li>Remaining Balance: ₹${updatedLoan.remainingBalance}</li>
        </ul>
        <p>Thank you for your payment.</p>
        <p>Best regards,<br/>Cyan Finance</p>
      `;
      await transporter.sendMail({
        from: `Cyan Finance <${process.env.EMAIL_FROM}>`,
        to: updatedLoan.email,
        subject: `Payment Approved - Loan ${updatedLoan.loanId}`,
        html: emailContent
      });
    } catch (emailErr) {
      console.error('Failed to send repayment email:', emailErr);
    }

    // Send payment update SMS notification
    try {
      if (updatedLoan.primaryMobile) {
        const paymentData = {
          customerName: updatedLoan.name,
          amount: payment.amount,
          status: 'approved',
          transactionId: payment.transactionId,
          loanId: updatedLoan.loanId
        };
        
        const smsResult = await smsService.sendPaymentUpdate(updatedLoan.primaryMobile, paymentData);
        console.log('Payment approval SMS result:', smsResult);
      }
    } catch (smsErr) {
      console.error('Failed to send payment approval SMS:', smsErr);
    }
    */

    res.json({ success: true, message: 'Payment approved and customer notified.' });
  } catch (err) {
    console.error('Error approving payment:', err);
    res.status(500).json({ message: err.message });
  }
});

// Note: Payment receipt generation is now handled on the frontend using jsPDF

// Calculate interest as per Muthoot policy
router.post('/calculate-interest', (req, res) => {
  const { principal, annualRate, disbursementDate, closureDate, termMonths } = req.body;
  if (!principal || !annualRate || !disbursementDate || !closureDate) {
    return res.status(400).json({ message: 'Missing required fields' });
  }
  
  // Use termMonths from request body, or calculate from dates if not provided
  let calculatedTermMonths = termMonths;
  if (!calculatedTermMonths) {
    const startDate = new Date(disbursementDate);
    const endDate = new Date(closureDate);
    calculatedTermMonths = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44)); // Use average days per month
  }
  
  const result = calculateClientInterestMethod({
    principal,
    annualRate,
    disbursementDate: new Date(disbursementDate),
    closureDate: new Date(closureDate),
    termMonths: calculatedTermMonths
  });
  res.json(result);
});

// Calculate early repayment amount for a loan
router.post('/:id/calculate-early-repayment', async (req, res) => {
  const { id } = req.params;
  const { repaymentDate } = req.body;
  const loan = await Loan.findById(id);
  if (!loan) return res.status(404).json({ message: 'Loan not found' });
  const result = loan.calculateEarlyRepaymentAmount(repaymentDate ? new Date(repaymentDate) : new Date());
  res.json(result);
});

// Send OTP for loan creation (Dual-channel: Email + SMS)
router.post('/send-otp', auth, async (req, res) => {
  try {
    const { customerId, email } = req.body;
    if (!customerId) {
      return res.status(400).json({ errors: [{ msg: 'customerId is required' }] });
    }
    
    if (!email || !email.trim()) {
      return res.status(400).json({ errors: [{ msg: 'Email is required for OTP verification' }] });
    }

    // Find customer to get phone number
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ errors: [{ msg: 'Customer not found' }] });
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min expiry
    
    // Remove any previous unused OTPs for this customer/email/purpose
    await Otp.deleteMany({ email, customerId, purpose: 'loan_creation' });
    
    // Create OTP record with phone number
    const otpData = {
      email,
      otp,
      expiresAt,
      purpose: 'loan_creation',
      customerId
    };
    
    // Add phone number if available
    if (customer.primaryMobile) {
      otpData.phoneNumber = customer.primaryMobile;
    }
    
    const otpDoc = await Otp.create(otpData);
    
    // Send SMS-only OTP for loan creation
    if (!customer.primaryMobile) {
      return res.status(400).json({ 
        success: false, 
        message: 'Customer mobile number is required for SMS verification' 
      });
    }
    
    const smsResult = await smsService.sendOTP(customer.primaryMobile, otp, 'customer_verification');
    
    // Update OTP record with delivery status
    if (smsResult.success) {
      await otpDoc.markSMSSent(smsResult.messageId || 'sms_sent');
    }
    
    // Return appropriate response
    if (smsResult.success) {
      res.json({ 
        success: true, 
        message: 'OTP sent successfully via SMS to customer mobile number',
        channels: {
          email: false,
          sms: true
        },
        phoneNumber: customer.primaryMobile,
        expiresAt
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: 'Failed to send SMS OTP. Please try again.',
        error: smsResult.error
      });
    }
    
  } catch (err) {
    console.error('Error sending loan OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify OTP for loan creation
router.post('/verify-otp', auth, async (req, res) => {
  try {
    const { customerId, email, otp } = req.body;
    if (!customerId || !otp) {
      return res.status(400).json({ errors: [{ msg: 'customerId and otp are required' }] });
    }
    
    if (!email || !email.trim()) {
      return res.status(400).json({ errors: [{ msg: 'Email is required for OTP verification' }] });
    }
    const otpDoc = await Otp.findOne({ email, customerId, otp, purpose: 'loan_creation' });
    if (!otpDoc) {
      return res.status(400).json({ errors: [{ msg: 'Invalid OTP' }] });
    }
    if (otpDoc.expiresAt < new Date()) {
      await otpDoc.deleteOne();
      return res.status(400).json({ errors: [{ msg: 'OTP expired' }] });
    }
    // OTP is valid, delete it to prevent reuse
    await otpDoc.deleteOne();
    // Optionally, you can set a flag in DB or cache to mark this customer as verified for loan creation (for a short time window)
    res.json({ success: true, message: 'OTP verified. You may proceed with loan creation.' });
  } catch (err) {
    console.error('Error verifying loan OTP:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/loans/weekly-dues
// @desc    Get all loan installments due this week
// @access  Admin
router.get('/weekly-dues', auth, adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0 (Sun) - 6 (Sat)
    // Calculate Monday (start) and Sunday (end) of this week
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    // Find all active loans with at least one installment due this week
    const loans = await Loan.find({ status: 'active', 'installments.dueDate': { $gte: monday, $lte: sunday } })
      .populate('customerId');

    // Collect all due installments for this week
    const dueList = [];
    for (const loan of loans) {
      for (const inst of loan.installments) {
        if (
          inst.dueDate >= monday &&
          inst.dueDate <= sunday &&
          inst.status !== 'paid'
        ) {
          dueList.push({
            loanId: loan.loanId,
            customer: {
              name: loan.name,
              email: loan.email,
              primaryMobile: loan.primaryMobile,
              aadharNumber: loan.aadharNumber
            },
            dueDate: inst.dueDate,
            amount: inst.amount,
            status: inst.status
          });
        }
      }
    }
    res.json({ success: true, data: dueList });
  } catch (err) {
    console.error('Error fetching weekly due installments:', err);
    res.status(500).json({ message: 'Server error' });
  }
});


// @route   GET /api/loans/debug-auth
// @desc    Debug endpoint to check authentication
router.get('/debug-auth', [adminAuth], async (req, res) => {
  res.json({
    success: true,
    message: 'Admin authentication working',
    user: {
      id: req.user._id,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// @route   DELETE /api/loans/:id
// @desc    Delete a loan (admin only) - can delete any loan regardless of payments
router.delete('/:id', [adminAuth], async (req, res) => {
  try {
    const loan = await Loan.findById(req.params.id);
    
    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    // Admin can delete any loan, even with payments
    // Log the deletion for audit purposes
    console.log(`Admin ${req.user.email} deleting loan ${loan.loanId} with ${loan.payments?.length || 0} payments`);

    // Clean up related records before deleting the loan
    const cleanupResults = await cleanupLoanData(loan._id, loan.customerId);

    // Delete the loan itself
    await Loan.findByIdAndDelete(req.params.id);
    
    res.json({ 
      success: true, 
      message: 'Loan and all related data deleted successfully',
      deletedLoanId: loan.loanId,
      hadPayments: loan.payments && loan.payments.length > 0,
      paymentCount: loan.payments?.length || 0,
      cleanupResults: cleanupResults
    });
  } catch (err) {
    console.error('Error deleting loan:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/loans/check-upgrades
// @desc    Check for loans that need interest rate upgrades
// @access  Admin only
router.get('/check-upgrades', adminAuth, async (req, res) => {
  try {
    const today = new Date();
    
    // Find loans that need first upgrade (18% → 24%)
    const firstUpgradeLoans = await Loan.find({
      status: 'active',
      originalInterestRate: 18,
      currentUpgradeLevel: 0,
      $expr: {
        $gte: [
          { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
          { $multiply: ['$term', 30] }
        ]
      }
    }).populate('customerId', 'name email mobile').sort({ createdAt: 1 });

    // Find loans that need second upgrade (24% → 30%)
    const secondUpgradeLoans = await Loan.find({
      status: 'active',
      originalInterestRate: 18,
      currentUpgradeLevel: 1,
      interestRate: 24,
      $expr: {
        $gte: [
          { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
          180
        ]
      }
    }).populate('customerId', 'name email mobile').sort({ createdAt: 1 });

    // Find loans that need third upgrade (30% → 36%)
    const thirdUpgradeLoans = await Loan.find({
      status: 'active',
      originalInterestRate: 18,
      currentUpgradeLevel: 2,
      interestRate: 30,
      $expr: {
        $gte: [
          { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
          270
        ]
      }
    }).populate('customerId', 'name email mobile').sort({ createdAt: 1 });

    // Find loans ready for auction (36% rate)
    const auctionReadyLoans = await Loan.find({
      status: 'active',
      originalInterestRate: 18,
      currentUpgradeLevel: 3,
      interestRate: 36,
      $expr: {
        $gte: [
          { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
          360
        ]
      }
    }).populate('customerId', 'name email mobile').sort({ createdAt: 1 });

    const allUpgradeLoans = [...firstUpgradeLoans, ...secondUpgradeLoans, ...thirdUpgradeLoans];

    // Format response
    const response = {
      timestamp: today,
      summary: {
        firstUpgrade: firstUpgradeLoans.length,
        secondUpgrade: secondUpgradeLoans.length,
        thirdUpgrade: thirdUpgradeLoans.length,
        auctionReady: auctionReadyLoans.length,
        totalEligible: allUpgradeLoans.length
      },
      loans: {
        firstUpgrade: firstUpgradeLoans.map(loan => ({
          loanId: loan.loanId,
          customerName: loan.customerId?.name || 'N/A',
          customerMobile: loan.customerId?.mobile || 'N/A',
          amount: loan.amount,
          currentRate: loan.interestRate,
          term: loan.term,
          createdAt: loan.createdAt,
          daysSinceCreated: Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24)),
          remainingBalance: loan.remainingBalance
        })),
        secondUpgrade: secondUpgradeLoans.map(loan => ({
          loanId: loan.loanId,
          customerName: loan.customerId?.name || 'N/A',
          customerMobile: loan.customerId?.mobile || 'N/A',
          amount: loan.amount,
          currentRate: loan.interestRate,
          term: loan.term,
          createdAt: loan.createdAt,
          daysSinceCreated: Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24)),
          remainingBalance: loan.remainingBalance
        })),
        thirdUpgrade: thirdUpgradeLoans.map(loan => ({
          loanId: loan.loanId,
          customerName: loan.customerId?.name || 'N/A',
          customerMobile: loan.customerId?.mobile || 'N/A',
          amount: loan.amount,
          currentRate: loan.interestRate,
          term: loan.term,
          createdAt: loan.createdAt,
          daysSinceCreated: Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24)),
          remainingBalance: loan.remainingBalance
        })),
        auctionReady: auctionReadyLoans.map(loan => ({
          loanId: loan.loanId,
          customerName: loan.customerId?.name || 'N/A',
          customerMobile: loan.customerId?.mobile || 'N/A',
          amount: loan.amount,
          currentRate: loan.interestRate,
          term: loan.term,
          createdAt: loan.createdAt,
          daysSinceCreated: Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24)),
          remainingBalance: loan.remainingBalance,
          auctionReady: loan.auctionReady
        }))
      }
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error checking upgrades:', error);
    res.status(500).json({ error: 'Failed to check loan upgrades' });
  }
});

// @route   GET /api/loans/upgrade-stats
// @desc    Get upgrade statistics
// @access  Admin only
router.get('/upgrade-stats', adminAuth, async (req, res) => {
  try {
    const stats = {
      totalActiveLoans: await Loan.countDocuments({ status: 'active' }),
      totalClosedLoans: await Loan.countDocuments({ status: 'closed' }),
      loansByRate: {
        rate18: await Loan.countDocuments({ status: 'active', interestRate: 18 }),
        rate24: await Loan.countDocuments({ status: 'active', interestRate: 24 }),
        rate30: await Loan.countDocuments({ status: 'active', interestRate: 30 }),
        rate36: await Loan.countDocuments({ status: 'active', interestRate: 36 })
      },
      loansWithUpgrades: await Loan.countDocuments({
        status: 'active',
        upgradeHistory: { $exists: true, $ne: [] }
      })
    };

    res.json(stats);

  } catch (error) {
    console.error('❌ Error getting upgrade stats:', error);
    res.status(500).json({ error: 'Failed to get upgrade statistics' });
  }
});

// @route   GET /api/loans/cleanup/check-orphaned
// @desc    Check for orphaned records (admin only)
// @access  Admin only
router.get('/cleanup/check-orphaned', adminAuth, async (req, res) => {
  try {
    const report = await checkOrphanedRecords();
    
    res.json({
      success: true,
      message: 'Orphaned records check completed',
      report: report
    });
  } catch (error) {
    console.error('❌ Error checking orphaned records:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to check orphaned records' 
    });
  }
});

// @route   POST /api/loans/cleanup/clean-orphaned
// @desc    Clean up orphaned records (admin only)
// @access  Admin only
router.post('/cleanup/clean-orphaned', adminAuth, async (req, res) => {
  try {
    const results = await cleanupOrphanedRecords();
    
    res.json({
      success: true,
      message: 'Orphaned records cleanup completed',
      results: results
    });
  } catch (error) {
    console.error('❌ Error cleaning up orphaned records:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to clean up orphaned records' 
    });
  }
});

module.exports = router; 