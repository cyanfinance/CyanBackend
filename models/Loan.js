const mongoose = require('mongoose');
const Notification = require('./Notification');
const { calculateMuthootGoldLoanInterest } = require('./Notification');
const { calculateMuthootGoldLoanInterest: calcMuthoot } = require('../utils/interestCalculator');

const goldItemSchema = new mongoose.Schema({
    description: String,
    grossWeight: Number,
    netWeight: Number,
    // Reference to photos for this gold item
    photos: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ItemPhoto'
    }]
});

const emergencyContactSchema = new mongoose.Schema({
    mobile: String,
    relation: String
});

const paymentSchema = new mongoose.Schema({
    amount: {
        type: Number,
        required: true
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    method: {
        type: String,
        enum: ['handcash', 'online'],
        required: true
    },
    transactionId: String,
    bankName: String,
    // Track which month's installment this payment is for
    installmentNumber: {
        type: Number,
        required: true
    },
    // Store the remaining balance after this payment
    remainingBalance: {
        type: Number,
        required: true
    },
    enteredBy: {
        id: { type: String },
        name: { type: String }
    },
    status: {
        type: String,
        enum: ['pending', 'success'],
        default: 'pending'
    }
});

const loanSchema = new mongoose.Schema({
    customerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        required: true,
        index: true
    },
    aadharNumber: {
        type: String,
        required: [true, 'Please provide Aadhar number'],
        validate: {
            validator: function(v) {
                return /^\d{12}$/.test(v);
            },
            message: props => `${props.value} is not a valid Aadhar number! It should be 12 digits.`
        },
        index: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    primaryMobile: {
        type: String,
        required: true
    },
    secondaryMobile: String,
    presentAddress: {
        type: String,
        required: true
    },
    permanentAddress: {
        type: String,
        required: true
    },
    emergencyContact: emergencyContactSchema,
    goldItems: [goldItemSchema],
    amount: {
        type: Number,
        required: [true, 'Please provide loan amount'],
        min: [100, 'Loan amount cannot be less than 100']
    },
    term: {
        type: Number,
        required: [true, 'Please provide loan term in months'],
        min: [1, 'Loan term cannot be less than 1 month']
    },
    interestRate: {
        type: Number,
        required: [true, 'Please provide interest rate'],
        min: [0, 'Interest rate cannot be negative']
    },
    status: {
        type: String,
        enum: ['approved', 'rejected', 'active', 'closed'],
        default: 'active'
    },
    closedDate: {
        type: Date
    },
    monthlyPayment: {
        type: Number,
        required: true
    },
    totalPayment: {
        type: Number,
        required: true
    },
    // New fields for daily interest calculation
    dailyInterestRate: {
        type: Number,
        required: true
    },
    totalDays: {
        type: Number,
        required: true
    },
    dailyInterestAmount: {
        type: Number,
        required: true
    },
    // Track monthly installments separately
    installments: [{
        number: Number,
        dueDate: Date,
        amount: Number,
        status: {
            type: String,
            enum: ['pending', 'partial', 'paid'],
            default: 'pending'
        },
        amountPaid: {
            type: Number,
            default: 0
        }
    }],
    actualRepaymentDate: {
        type: Date
    },
    actualAmountPaid: {
        type: Number,
        default: 0
    },
    remainingBalance: {
        type: Number,
        default: function() {
            return this.totalPayment;
        }
    },
    paymentMethod: {
        type: String,
        enum: ['handcash', 'online'],
        default: 'handcash'
    },
    transactionId: {
        type: String,
        trim: true
    },
    depositedBank: {
        type: String,
        trim: true
    },
    renewalDate: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    payments: [paymentSchema],
    totalPaid: {
        type: Number,
        default: 0
    },
    loanId: {
        type: String,
        unique: true,
        required: true
    },
    // Gold Return Tracking
    goldReturnStatus: {
        type: String,
        enum: ['pending', 'scheduled', 'returned', 'overdue'],
        default: 'pending'
    },
    goldReturnDate: {
        type: Date
    },
    goldReturnScheduledDate: {
        type: Date
    },
    goldReturnReminders: [{
        sentDate: {
            type: Date,
            default: Date.now
        },
        type: {
            type: String,
            enum: ['initial', 'followup', 'urgent', 'final'],
            required: true
        },
        sentTo: {
            type: String,
            enum: ['customer', 'admin', 'both'],
            required: true
        },
        message: String
    }],
    goldReturnNotes: {
        type: String,
        trim: true
    },
    goldReturnedBy: {
        id: { type: String },
        name: { type: String }
    }
});

// Add index explicitly
loanSchema.index({ aadharNumber: 1 }, { unique: false });

// Calculate daily interest payment and set up installments before saving
loanSchema.pre('save', function(next) {
    if (this.isNew) {
        // Convert yearly interest rate to daily
        const dailyRate = (this.interestRate / 100) / 365; // Daily interest rate from yearly
        const totalDays = this.term * 30; // Approximate days (30 days per month)
        const p = this.amount; // Principal amount
        
        // Calculate daily interest amount
        this.dailyInterestRate = dailyRate;
        this.totalDays = totalDays;
        this.dailyInterestAmount = p * dailyRate;
        
        // Calculate total interest for the loan term
        const totalInterest = p * dailyRate * totalDays;
        
        // Calculate monthly payment (principal + interest) / number of months
        this.monthlyPayment = Math.round((p + totalInterest) / this.term);
        this.totalPayment = Math.round(p + totalInterest);
        this.remainingBalance = this.totalPayment;

        // Create installment schedule
        this.installments = [];
        let currentDate = new Date(this.createdAt);
        
        for (let i = 1; i <= this.term; i++) {
            // Add one month to the date
            currentDate = new Date(currentDate);
            currentDate.setMonth(currentDate.getMonth() + 1);
            
            this.installments.push({
                number: i,
                dueDate: new Date(currentDate),
                amount: this.monthlyPayment,
                status: 'pending',
                amountPaid: 0
            });
        }
    }
    next();
});

// Create notification after loan is saved
loanSchema.post('save', async function(doc) {
    if (doc.isNew) {
        try {
            await Notification.createNewLoanNotification(doc);
        } catch (error) {
            console.error('Error creating new loan notification:', error);
        }
    }
});

// Method to record a payment
loanSchema.methods.recordPayment = async function(paymentAmount, paymentMethod, transactionId = null, enteredBy, bankName = null) {
    // Find the first unpaid or partially paid installment
    const currentInstallment = this.installments.find(inst => 
        inst.status === 'pending' || inst.status === 'partial'
    );

    if (!currentInstallment) {
        throw new Error('No pending installments found');
    }

    // --- DYNAMIC REPAYMENT LOGIC ---
    const today = new Date();
    // Always recalculate due up to today
    const earlyRepayment = this.calculateEarlyRepaymentAmount(today);
    this.totalPayment = earlyRepayment.totalAmount;
    this.remainingBalance = Math.max(0, earlyRepayment.totalAmount - (this.totalPaid + paymentAmount));

    // Calculate how much can be applied to current installment
    const remainingForInstallment = currentInstallment.amount - currentInstallment.amountPaid;
    const appliedToInstallment = Math.min(paymentAmount, remainingForInstallment);

    // Update installment
    currentInstallment.amountPaid += appliedToInstallment;
    currentInstallment.status = currentInstallment.amountPaid >= currentInstallment.amount ? 'paid' : 'partial';

    // Update loan totals
    this.totalPaid += paymentAmount;
    this.remainingBalance = Math.max(0, this.totalPayment - this.totalPaid);

    // Create payment record (after updating remainingBalance)
    const payment = {
        amount: paymentAmount,
        method: paymentMethod,
        transactionId,
        bankName,
        installmentNumber: currentInstallment.number,
        remainingBalance: this.remainingBalance,
        enteredBy: enteredBy
    };

    this.payments.push(payment);

    // Check if loan is fully paid (bullet repayment logic)
    const wasActive = this.status === 'active';
    const roundedPaid = Math.round(this.totalPaid);
    const roundedDue = Math.round(this.totalPayment);
    if (roundedPaid >= roundedDue || this.remainingBalance <= 0) {
        this.status = 'closed';
        this.closedDate = today;
        this.actualRepaymentDate = today;
        this.actualAmountPaid = this.totalPaid;
        this.remainingBalance = 0;
        // Mark all installments as paid
        this.installments.forEach(inst => {
            inst.status = 'paid';
            inst.amountPaid = inst.amount;
        });
        
        // Set gold return status based on gold items
        const hasGoldItems = this.goldItems && this.goldItems.length > 0;
        const totalGoldWeight = hasGoldItems ? 
            this.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0;
        
        if (hasGoldItems && totalGoldWeight > 0) {
            this.goldReturnStatus = 'pending';
        } else {
            this.goldReturnStatus = 'returned';
            this.goldReturnDate = today;
            this.goldReturnedBy = {
                id: 'system',
                name: 'System (No Gold Items)'
            };
        }
    }

    await this.save();
    
    // Create notifications
    try {
        // Create payment notification
        await Notification.createRepaymentNotification(this, paymentAmount);
        
        // Create loan closed notification if loan was just closed
        if (wasActive && this.status === 'closed') {
            await Notification.createLoanClosedNotification(this);
        }
    } catch (error) {
        console.error('Error creating payment notifications:', error);
    }
    
    return payment;
};

// Example static holiday list (YYYY-MM-DD)
const HOLIDAYS = [
  '2024-01-01', '2024-08-15', '2024-10-02', '2024-12-25' // Add more as needed
];

function isHolidayOrSunday(date) {
  const d = new Date(date);
  const yyyyMMdd = d.toISOString().slice(0, 10);
  return d.getDay() === 0 || HOLIDAYS.includes(yyyyMMdd);
}

// Updated early repayment calculation
loanSchema.methods.calculateEarlyRepaymentAmount = function(repaymentDate = new Date()) {
  const disbursementDate = this.createdAt;
  const principal = this.amount;
  const annualRate = this.interestRate;

  // Grace period: if repaymentDate is a holiday/Sunday, allow next working day
  let effectiveRepaymentDate = new Date(repaymentDate);
  while (isHolidayOrSunday(effectiveRepaymentDate)) {
    effectiveRepaymentDate.setDate(effectiveRepaymentDate.getDate() + 1);
  }

  // Calculate interest as per Muthoot logic
  const result = calcMuthoot({
    principal,
    annualRate,
    disbursementDate,
    closureDate: effectiveRepaymentDate
  });

  // Example rebate: 2% off interest if repaid within 30 days
  let rebate = 0;
  const days = Math.ceil((effectiveRepaymentDate - disbursementDate) / (1000 * 60 * 60 * 24));
  if (days <= 30) {
    rebate = Math.round(result.totalInterest * 0.02);
    result.totalInterest -= rebate;
    result.totalAmount -= rebate;
  }

  // Ensure all monetary values are rounded to the nearest rupee
  return {
    ...result,
    totalInterest: Math.round(result.totalInterest),
    totalAmount: Math.round(result.totalAmount),
    rebate: Math.round(rebate),
    principal: Math.round(principal),
    // Aliases for frontend compatibility
    interest: Math.round(result.totalInterest),
    minimumDays: result.effectiveDays || 0,
    minimumInterest: result.minInterestAmount || 50,
    gracePeriodDays: result.effectiveDays ? Math.max(0, result.effectiveDays - days) : 0,
    totalDue: Math.round(result.totalAmount),
    // Add rounding for any other monetary fields as needed
    effectiveDays: result.effectiveDays,
    months: result.months,
    gracePeriodApplied: effectiveRepaymentDate.getTime() !== new Date(repaymentDate).getTime(),
    minInterestApplied: result.totalInterest === 50,
    minDaysApplied: result.effectiveDays === 7 || result.effectiveDays === 15
  };
};

// Add a method to approve a payment by ID
loanSchema.methods.approvePayment = async function(paymentId) {
    const payment = this.payments.id(paymentId);
    if (!payment) throw new Error('Payment not found');
    payment.status = 'success';
    await this.save();
    return payment;
};

// Gold Return Management Methods
loanSchema.methods.scheduleGoldReturn = async function(scheduledDate, notes = '') {
    if (this.status !== 'closed') {
        throw new Error('Gold return can only be scheduled for closed loans');
    }
    
    this.goldReturnStatus = 'scheduled';
    this.goldReturnScheduledDate = scheduledDate;
    this.goldReturnNotes = notes;
    
    await this.save();
    return this;
};

loanSchema.methods.markGoldReturned = async function(returnedBy, notes = '') {
    if (this.status !== 'closed') {
        throw new Error('Gold return can only be marked for closed loans');
    }
    
    this.goldReturnStatus = 'returned';
    this.goldReturnDate = new Date();
    this.goldReturnedBy = returnedBy;
    this.goldReturnNotes = notes || this.goldReturnNotes;
    
    await this.save();
    return this;
};

loanSchema.methods.addGoldReturnReminder = async function(reminderType, sentTo, message) {
    this.goldReturnReminders.push({
        type: reminderType,
        sentTo: sentTo,
        message: message
    });
    
    await this.save();
    return this;
};

loanSchema.methods.getGoldReturnSummary = function() {
    const totalGoldWeight = this.goldItems ? this.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0;
    
    // Handle case where closedDate might not be set
    let daysSinceClosed = 0;
    if (this.status === 'closed' && this.closedDate) {
        daysSinceClosed = Math.floor((new Date() - this.closedDate) / (1000 * 60 * 60 * 24));
    }
    
    return {
        loanId: this.loanId,
        customerName: this.name,
        customerMobile: this.primaryMobile,
        customerEmail: this.email,
        totalGoldWeight: totalGoldWeight,
        goldItems: this.goldItems || [],
        closedDate: this.closedDate || null,
        daysSinceClosed: daysSinceClosed,
        goldReturnStatus: this.goldReturnStatus || 'pending',
        scheduledReturnDate: this.goldReturnScheduledDate,
        actualReturnDate: this.goldReturnDate,
        remindersSent: this.goldReturnReminders ? this.goldReturnReminders.length : 0,
        isOverdue: daysSinceClosed > 30 && this.goldReturnStatus !== 'returned'
    };
};

// Method to initialize gold return status for existing closed loans
loanSchema.methods.initializeGoldReturnStatus = async function() {
    if (this.status !== 'closed') {
        throw new Error('Gold return status can only be initialized for closed loans');
    }
    
    // Check if gold return status is already set
    if (this.goldReturnStatus) {
        return this;
    }
    
    const hasGoldItems = this.goldItems && this.goldItems.length > 0;
    const totalGoldWeight = hasGoldItems ? 
        this.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0;
    
    if (hasGoldItems && totalGoldWeight > 0) {
        this.goldReturnStatus = 'pending';
    } else {
        this.goldReturnStatus = 'returned';
        this.goldReturnDate = new Date();
        this.goldReturnedBy = {
            id: 'system',
            name: 'System (No Gold Items)'
        };
    }
    
    await this.save();
    return this;
};

module.exports = mongoose.model('Loan', loanSchema); 