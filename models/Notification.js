const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['new_loan', 'new_repayment', 'loan_closed', 'payment_due', 'payment_overdue'],
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