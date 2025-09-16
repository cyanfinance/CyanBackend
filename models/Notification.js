const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['new_loan', 'new_repayment', 'loan_closed', 'payment_due', 'payment_overdue', 'interest_rate_upgrade', 'auction_warning', 'auction_scheduled', 'auction_final_warning'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    loanId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Loan',
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    customerMobile: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    dueDate: {
        type: Date
    },
    isRead: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    readAt: {
        type: Date
    }
});

// Index for efficient queries
notificationSchema.index({ isRead: 1, isActive: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ dueDate: 1, isActive: 1 });

// Method to mark notification as read
notificationSchema.methods.markAsRead = function() {
    this.isRead = true;
    this.readAt = new Date();
    return this.save();
};

// Method to deactivate notification
notificationSchema.methods.deactivate = function() {
    this.isActive = false;
    return this.save();
};

// Static method to create notification for new loan
notificationSchema.statics.createNewLoanNotification = function(loan) {
    return this.create({
        type: 'new_loan',
        title: 'New Loan Approved',
        message: `New loan of ₹${loan.amount.toLocaleString()} has been approved for ${loan.name}`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.amount
    });
};

// Static method to create notification for new repayment
notificationSchema.statics.createRepaymentNotification = function(loan, paymentAmount) {
    return this.create({
        type: 'new_repayment',
        title: 'Payment Received',
        message: `Payment of ₹${paymentAmount.toLocaleString()} received from ${loan.name}`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: paymentAmount
    });
};

// Static method to create notification for closed loan
notificationSchema.statics.createLoanClosedNotification = function(loan) {
    return this.create({
        type: 'loan_closed',
        title: 'Loan Closed',
        message: `Loan of ${loan.name} has been fully paid and closed`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.totalPayment
    });
};

// Static method to create payment due notification
notificationSchema.statics.createPaymentDueNotification = function(loan, dueDate) {
    return this.create({
        type: 'payment_due',
        title: 'Payment Due Today',
        message: `Payment of ₹${loan.monthlyPayment.toLocaleString()} is due today for ${loan.name}`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.monthlyPayment,
        dueDate: dueDate
    });
};

// Static method to create overdue payment notification
notificationSchema.statics.createOverdueNotification = function(loan, daysOverdue) {
    return this.create({
        type: 'payment_overdue',
        title: 'Payment Overdue',
        message: `Payment of ₹${loan.monthlyPayment.toLocaleString()} is ${daysOverdue} days overdue for ${loan.name}`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.monthlyPayment
    });
};

// Static method to create interest rate upgrade notification
notificationSchema.statics.createInterestRateUpgradeNotification = function(loan, oldRate, newRate, upgradeDetails) {
    const upgradeLevelText = upgradeDetails.upgradeLevel === 1 ? 'First' : 'Second';
    return this.create({
        type: 'interest_rate_upgrade',
        title: `${upgradeLevelText} Interest Rate Upgrade`,
        message: `Interest rate for ${loan.name}'s loan has been upgraded from ${oldRate}% to ${newRate}% due to overdue payment. New total amount: ₹${upgradeDetails.newTotalPayment.toLocaleString()}. New term end: ${upgradeDetails.newTermEndDate.toDateString()}`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: upgradeDetails.newTotalPayment
    });
};

// Static method to create auction warning notification
notificationSchema.statics.createAuctionWarningNotification = function(loan, auctionDetails) {
    return this.create({
        type: 'auction_warning',
        title: 'Loan Ready for Auction - Urgent Payment Required',
        message: `Due to non-payment of loan ${loan.loanId}, we are preparing for auction of your gold items. Please pay the full outstanding amount of ₹${loan.remainingBalance.toLocaleString()} immediately to avoid auction.`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.remainingBalance
    });
};

// Static method to create auction scheduled notification
notificationSchema.statics.createAuctionScheduledNotification = function(loan, auctionDate) {
    return this.create({
        type: 'auction_scheduled',
        title: 'Auction Scheduled - Final Warning',
        message: `Auction for loan ${loan.loanId} has been scheduled for ${auctionDate.toDateString()}. Please pay the full outstanding amount of ₹${loan.remainingBalance.toLocaleString()} before this date to avoid auction of your gold items.`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.remainingBalance
    });
};

// Static method to create auction final warning notification
notificationSchema.statics.createAuctionFinalWarningNotification = function(loan, auctionDate) {
    return this.create({
        type: 'auction_final_warning',
        title: 'Gold Items Auctioned',
        message: `Loan ${loan.loanId} has been auctioned on ${auctionDate.toDateString()}. Your gold items have been sold to recover the outstanding amount of ₹${loan.remainingBalance.toLocaleString()}.`,
        loanId: loan._id,
        customerName: loan.name,
        customerMobile: loan.primaryMobile,
        amount: loan.remainingBalance
    });
};

// Static method to get unread notifications count
notificationSchema.statics.getUnreadCount = function() {
    return this.countDocuments({ isRead: false, isActive: true });
};

// Static method to get today's due payments
notificationSchema.statics.getTodaysDuePayments = function() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    return this.find({
        type: 'payment_due',
        dueDate: {
            $gte: today,
            $lt: tomorrow
        },
        isActive: true
    }).sort({ dueDate: 1 });
};

module.exports = mongoose.model('Notification', notificationSchema); 