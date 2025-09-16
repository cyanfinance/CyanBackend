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
    },
    // Interest rate upgrade tracking
    originalInterestRate: {
        type: Number,
        required: true
    },
    interestRateUpgraded: {
        type: Boolean,
        default: false
    },
    interestRateUpgradeDate: {
        type: Date
    },
    interestRateUpgradeReason: {
        type: String,
        enum: ['overdue_upgrade', 'manual_upgrade'],
        default: 'overdue_upgrade'
    },
    // Progressive upgrade tracking
    upgradeHistory: [{
        fromRate: Number,
        toRate: Number,
        upgradeDate: Date,
        reason: String,
        newTermEndDate: Date,
        calculatedFromOriginalDate: Boolean
    }],
    currentUpgradeLevel: {
        type: Number,
        default: 0 // 0 = original, 1 = first upgrade (18%→24%), 2 = second upgrade (24%→30%)
    },
    // Auction management
    auctionStatus: {
        type: String,
        enum: ['not_ready', 'ready_for_auction', 'auction_scheduled', 'auctioned', 'cancelled'],
        default: 'not_ready'
    },
    auctionReadyDate: {
        type: Date
    },
    auctionScheduledDate: {
        type: Date
    },
    auctionDate: {
        type: Date
    },
    auctionNotes: {
        type: String,
        trim: true
    },
    auctionNotifications: [{
        sentDate: {
            type: Date,
            default: Date.now
        },
        type: {
            type: String,
            enum: ['auction_warning', 'auction_scheduled', 'final_warning'],
            required: true
        },
        sentTo: {
            type: String,
            enum: ['customer', 'admin', 'both'],
            required: true
        },
        message: String,
        sentBy: {
            id: { type: String },
            name: { type: String }
        }
    }]
});

// Add index explicitly
loanSchema.index({ aadharNumber: 1 }, { unique: false });

// Calculate daily interest payment and set up installments before saving
loanSchema.pre('save', function(next) {
    if (this.isNew) {
        // Store original interest rate
        this.originalInterestRate = this.interestRate;
        
        // Use Muthoot calculation method for consistency with frontend
        const disbursementDate = this.createdAt || new Date();
        const closureDate = new Date(disbursementDate);
        closureDate.setMonth(closureDate.getMonth() + this.term);
        
        const muthootResult = calcMuthoot({
            principal: this.amount,
            annualRate: this.interestRate,
            disbursementDate: disbursementDate,
            closureDate: closureDate
        });
        
        // Calculate daily interest amount for tracking
        const dailyRate = (this.interestRate / 100) / 365;
        const totalDays = this.term * 30; // Approximate days (30 days per month)
        
        this.dailyInterestRate = dailyRate;
        this.totalDays = totalDays;
        this.dailyInterestAmount = this.amount * dailyRate;
        
        // Use Muthoot calculation results
        this.monthlyPayment = Math.round(muthootResult.totalAmount / this.term);
        this.totalPayment = muthootResult.totalAmount;
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

// Method to upgrade interest rate for overdue loans (Progressive System)
loanSchema.methods.upgradeInterestRate = async function(reason = 'overdue_upgrade') {
    if (this.status === 'closed') {
        throw new Error('Cannot upgrade interest rate for closed loans');
    }
    
    // Determine the next upgrade level
    let newRate;
    let newUpgradeLevel;
    
    if (this.currentUpgradeLevel === 0 && this.originalInterestRate === 18) {
        // First upgrade: 18% → 24%
        newRate = 24;
        newUpgradeLevel = 1;
    } else if (this.currentUpgradeLevel === 1 && this.interestRate === 24) {
        // Second upgrade: 24% → 30%
        newRate = 30;
        newUpgradeLevel = 2;
    } else {
        throw new Error('No further upgrades available for this loan');
    }
    
    const oldRate = this.interestRate;
    const oldTotalPayment = this.totalPayment;
    const oldRemainingBalance = this.remainingBalance;
    const today = new Date();
    const loanStartDate = this.createdAt;
    
    // Calculate new term end date (3 months from original loan date for each upgrade)
    const newTermEndDate = new Date(loanStartDate);
    newTermEndDate.setMonth(newTermEndDate.getMonth() + (3 * (newUpgradeLevel + 1))); // 3, 6, or 9 months from start
    
    // Calculate total interest from original loan date with new rate
    const totalDaysFromStart = Math.floor((newTermEndDate - loanStartDate) / (1000 * 60 * 60 * 24));
    const newDailyRate = (newRate / 100) / 365;
    const newTotalInterest = this.amount * newDailyRate * totalDaysFromStart;
    const newTotalPayment = Math.round(this.amount + newTotalInterest);
    
    // Update loan properties
    this.interestRate = newRate;
    this.interestRateUpgraded = true;
    this.interestRateUpgradeDate = today;
    this.interestRateUpgradeReason = reason;
    this.currentUpgradeLevel = newUpgradeLevel;
    
    // Update daily interest calculations
    this.dailyInterestRate = newDailyRate;
    this.dailyInterestAmount = this.amount * newDailyRate;
    
    // Update total payment and remaining balance
    this.totalPayment = newTotalPayment;
    this.remainingBalance = Math.max(0, newTotalPayment - this.totalPaid);
    
    // Calculate new monthly payment for remaining period
    const monthsRemaining = Math.max(1, Math.ceil((newTermEndDate - today) / (1000 * 60 * 60 * 24 * 30)));
    this.monthlyPayment = Math.round(this.remainingBalance / monthsRemaining);
    
    // Update term to reflect new end date
    this.term = Math.ceil(totalDaysFromStart / 30);
    
    // Create new installment schedule from today to new end date
    this.installments = [];
    let currentDate = new Date(today);
    
    for (let i = 1; i <= monthsRemaining; i++) {
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
    
    // Add to upgrade history
    this.upgradeHistory.push({
        fromRate: oldRate,
        toRate: newRate,
        upgradeDate: today,
        reason: reason,
        newTermEndDate: newTermEndDate,
        calculatedFromOriginalDate: true
    });
    
    await this.save();
    
    return {
        oldRate,
        newRate,
        oldTotalPayment,
        newTotalPayment: this.totalPayment,
        oldRemainingBalance,
        newRemainingBalance: this.remainingBalance,
        upgradeDate: this.interestRateUpgradeDate,
        newTermEndDate: newTermEndDate,
        upgradeLevel: newUpgradeLevel,
        monthsRemaining: monthsRemaining,
        totalDaysFromStart: totalDaysFromStart
    };
};

// Method to mark loan as ready for auction
loanSchema.methods.markReadyForAuction = async function(notes = '', markedBy) {
    if (this.status === 'closed') {
        throw new Error('Cannot mark closed loans for auction');
    }
    
    if (this.auctionStatus === 'auctioned') {
        throw new Error('Loan has already been auctioned');
    }
    
    this.auctionStatus = 'ready_for_auction';
    this.auctionReadyDate = new Date();
    this.auctionNotes = notes;
    
    // Add notification record
    this.auctionNotifications.push({
        type: 'auction_warning',
        sentTo: 'customer',
        message: `Loan ${this.loanId} has been marked as ready for auction due to non-payment. Please pay the full amount to avoid auction.`,
        sentBy: markedBy
    });
    
    await this.save();
    return this;
};

// Method to schedule auction
loanSchema.methods.scheduleAuction = async function(auctionDate, notes = '', scheduledBy) {
    if (this.auctionStatus !== 'ready_for_auction') {
        throw new Error('Loan must be marked as ready for auction before scheduling');
    }
    
    this.auctionStatus = 'auction_scheduled';
    this.auctionScheduledDate = auctionDate;
    this.auctionNotes = notes || this.auctionNotes;
    
    // Add notification record
    this.auctionNotifications.push({
        type: 'auction_scheduled',
        sentTo: 'customer',
        message: `Auction for loan ${this.loanId} has been scheduled for ${auctionDate.toDateString()}. Please pay the full amount before this date to avoid auction.`,
        sentBy: scheduledBy
    });
    
    await this.save();
    return this;
};

// Method to mark loan as auctioned
loanSchema.methods.markAsAuctioned = async function(auctionDate, notes = '', auctionedBy) {
    if (this.auctionStatus !== 'auction_scheduled' && this.auctionStatus !== 'ready_for_auction') {
        throw new Error('Loan must be scheduled or ready for auction before marking as auctioned');
    }
    
    this.auctionStatus = 'auctioned';
    this.auctionDate = auctionDate || new Date();
    this.auctionNotes = notes || this.auctionNotes;
    this.status = 'closed';
    this.closedDate = this.auctionDate;
    
    // Add notification record
    this.auctionNotifications.push({
        type: 'final_warning',
        sentTo: 'customer',
        message: `Loan ${this.loanId} has been auctioned on ${this.auctionDate.toDateString()}. The gold items have been sold to recover the outstanding amount.`,
        sentBy: auctionedBy
    });
    
    await this.save();
    return this;
};

// Method to cancel auction
loanSchema.methods.cancelAuction = async function(notes = '', cancelledBy) {
    if (this.auctionStatus === 'auctioned') {
        throw new Error('Cannot cancel already auctioned loans');
    }
    
    this.auctionStatus = 'cancelled';
    this.auctionNotes = notes || this.auctionNotes;
    
    // Add notification record
    this.auctionNotifications.push({
        type: 'auction_warning',
        sentTo: 'customer',
        message: `Auction for loan ${this.loanId} has been cancelled. Please continue with regular payments.`,
        sentBy: cancelledBy
    });
    
    await this.save();
    return this;
};

// Method to get auction summary
loanSchema.methods.getAuctionSummary = function() {
    const daysSinceReady = this.auctionReadyDate ? 
        Math.floor((new Date() - this.auctionReadyDate) / (1000 * 60 * 60 * 24)) : 0;
    
    return {
        loanId: this.loanId,
        customerName: this.name,
        customerMobile: this.primaryMobile,
        customerEmail: this.email,
        auctionStatus: this.auctionStatus,
        auctionReadyDate: this.auctionReadyDate,
        auctionScheduledDate: this.auctionScheduledDate,
        auctionDate: this.auctionDate,
        daysSinceReady: daysSinceReady,
        totalGoldWeight: this.goldItems ? this.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0,
        outstandingAmount: this.remainingBalance,
        notificationsSent: this.auctionNotifications ? this.auctionNotifications.length : 0,
        notes: this.auctionNotes
    };
};

module.exports = mongoose.model('Loan', loanSchema); 