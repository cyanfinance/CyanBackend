const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const Notification = require('../models/Notification');
const Loan = require('../models/Loan');

// @route   GET /api/notifications
// @desc    Get all notifications for admin
router.get('/', [auth, adminAuth], async (req, res) => {
    try {
        const { page = 1, limit = 20, type, isRead } = req.query;
        
        // Build filter object
        const filter = { isActive: true };
        if (type) filter.type = type;
        if (isRead !== undefined) filter.isRead = isRead === 'true';
        
        const notifications = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .populate('loanId', 'loanId amount term interestRate status');
            
        const total = await Notification.countDocuments(filter);
        
        res.json({
            success: true,
            data: notifications,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/notifications/unread-count
// @desc    Get unread notifications count
router.get('/unread-count', [auth, adminAuth], async (req, res) => {
    try {
        const count = await Notification.getUnreadCount();
        res.json({
            success: true,
            count
        });
    } catch (err) {
        console.error('Error fetching unread count:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/notifications/todays-due
// @desc    Get today's due payments
router.get('/todays-due', [auth, adminAuth], async (req, res) => {
    try {
        const duePayments = await Notification.getTodaysDuePayments();
        res.json({
            success: true,
            data: duePayments
        });
    } catch (err) {
        console.error('Error fetching today\'s due payments:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/notifications/:id/read
// @desc    Mark notification as read
router.put('/:id/read', [auth, adminAuth], async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        await notification.markAsRead();
        res.json({
            success: true,
            data: notification
        });
    } catch (err) {
        console.error('Error marking notification as read:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/notifications/read-all
// @desc    Mark all notifications as read
router.put('/read-all', [auth, adminAuth], async (req, res) => {
    try {
        await Notification.updateMany(
            { isRead: false, isActive: true },
            { 
                isRead: true, 
                readAt: new Date() 
            }
        );
        
        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (err) {
        console.error('Error marking all notifications as read:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/notifications/:id
// @desc    Delete notification
router.delete('/:id', [auth, adminAuth], async (req, res) => {
    try {
        const notification = await Notification.findById(req.params.id);
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        await notification.deactivate();
        res.json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (err) {
        console.error('Error deleting notification:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/notifications/generate-due-notifications
// @desc    Generate payment due notifications for today
router.post('/generate-due-notifications', [auth, adminAuth], async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Find all active loans with installments due today
        const loans = await Loan.find({
            status: 'active',
            'installments.dueDate': {
                $gte: today,
                $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
            }
        });
        
        const notifications = [];
        
        for (const loan of loans) {
            // Check if notification already exists for today
            const existingNotification = await Notification.findOne({
                loanId: loan._id,
                type: 'payment_due',
                dueDate: {
                    $gte: today,
                    $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                },
                isActive: true
            });
            
            if (!existingNotification) {
                const notification = await Notification.createPaymentDueNotification(loan, today);
                notifications.push(notification);
            }
        }
        
        res.json({
            success: true,
            message: `${notifications.length} due payment notifications generated`,
            count: notifications.length
        });
    } catch (err) {
        console.error('Error generating due notifications:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/notifications/generate-overdue-notifications
// @desc    Generate overdue payment notifications
router.post('/generate-overdue-notifications', [auth, adminAuth], async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Find all active loans with overdue installments
        const loans = await Loan.find({
            status: 'active',
            'installments.dueDate': { $lt: today },
            'installments.status': { $in: ['pending', 'partial'] }
        });
        
        const notifications = [];
        
        for (const loan of loans) {
            const overdueInstallments = loan.installments.filter(inst => 
                inst.dueDate < today && inst.status !== 'paid'
            );
            
            for (const installment of overdueInstallments) {
                const daysOverdue = Math.floor((today - installment.dueDate) / (1000 * 60 * 60 * 24));
                
                // Check if notification already exists for this installment
                const existingNotification = await Notification.findOne({
                    loanId: loan._id,
                    type: 'payment_overdue',
                    amount: installment.amount,
                    createdAt: {
                        $gte: new Date(today.getTime() - 24 * 60 * 60 * 1000)
                    },
                    isActive: true
                });
                
                if (!existingNotification) {
                    const notification = await Notification.createOverdueNotification(loan, daysOverdue);
                    notifications.push(notification);
                }
            }
        }
        
        res.json({
            success: true,
            message: `${notifications.length} overdue payment notifications generated`,
            count: notifications.length
        });
    } catch (err) {
        console.error('Error generating overdue notifications:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/notifications/send-payment-reminders
// @desc    Manually trigger payment reminder emails
router.post('/send-payment-reminders', [auth, adminAuth], async (req, res) => {
    try {
        const { type = 'all' } = req.body; // 'upcoming', 'overdue', 'weekly', 'all'
        
        const { 
            sendUpcomingPaymentReminders, 
            sendOverduePaymentReminders, 
            sendWeeklySummaryReminders 
        } = require('../scripts/sendPaymentReminders');
        
        let results = {};
        
        if (type === 'all' || type === 'upcoming') {
            results.upcoming = await sendUpcomingPaymentReminders();
        }
        
        if (type === 'all' || type === 'overdue') {
            results.overdue = await sendOverduePaymentReminders();
        }
        
        if (type === 'all' || type === 'weekly') {
            results.weekly = await sendWeeklySummaryReminders();
        }
        
        const totalSent = Object.values(results).reduce((sum, count) => sum + count, 0);
        
        res.json({
            success: true,
            message: `Payment reminder emails sent successfully`,
            data: {
                type,
                results,
                totalSent
            }
        });
    } catch (err) {
        console.error('Error sending payment reminders:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/notifications/send-test-reminder
// @desc    Send a test payment reminder email
router.post('/send-test-reminder', [auth, adminAuth], async (req, res) => {
    try {
        const { email, name, loanId, amount, dueDate, daysUntilDue = 3, isOverdue = false, daysOverdue = 0 } = req.body;
        
        if (!email || !name || !loanId || !amount || !dueDate) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        
        const { sendPaymentReminderEmail } = require('../utils/brevo');
        
        const emailSent = await sendPaymentReminderEmail({
            to: email,
            name,
            loanId,
            amount: parseFloat(amount),
            dueDate: new Date(dueDate),
            daysUntilDue: parseInt(daysUntilDue),
            isOverdue: Boolean(isOverdue),
            daysOverdue: parseInt(daysOverdue),
            totalPaid: 50000,
            remainingBalance: 150000,
            installmentNumber: 3,
            totalInstallments: 12
        });
        
        if (emailSent) {
            res.json({
                success: true,
                message: 'Test payment reminder email sent successfully',
                data: { email, name, loanId }
            });
        } else {
            res.status(500).json({ message: 'Failed to send test email' });
        }
    } catch (err) {
        console.error('Error sending test reminder:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/notifications/upcoming-payments
// @desc    Get list of upcoming payments for reminder emails
router.get('/upcoming-payments', [auth, adminAuth], async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const futureDate = new Date(today);
        futureDate.setDate(futureDate.getDate() + parseInt(days));
        
        // Find all active loans with installments due within the specified days
        const loans = await Loan.find({
            status: 'active',
            'installments.dueDate': {
                $gte: today,
                $lte: futureDate
            },
            'installments.status': { $in: ['pending', 'partial'] }
        });
        
        const upcomingPayments = [];
        
        for (const loan of loans) {
            const upcomingInstallments = loan.installments.filter(inst => 
                inst.dueDate >= today && 
                inst.dueDate <= futureDate && 
                (inst.status === 'pending' || inst.status === 'partial')
            );
            
            for (const installment of upcomingInstallments) {
                const daysUntilDue = Math.ceil((installment.dueDate - today) / (1000 * 60 * 60 * 24));
                
                upcomingPayments.push({
                    loanId: loan.loanId,
                    customerName: loan.name,
                    customerEmail: loan.email,
                    customerMobile: loan.primaryMobile,
                    installmentNumber: installment.number,
                    totalInstallments: loan.term,
                    amount: installment.amount,
                    dueDate: installment.dueDate,
                    daysUntilDue,
                    totalPaid: loan.totalPaid,
                    remainingBalance: loan.remainingBalance,
                    status: installment.status
                });
            }
        }
        
        // Sort by days until due
        upcomingPayments.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
        
        res.json({
            success: true,
            data: upcomingPayments,
            count: upcomingPayments.length
        });
    } catch (err) {
        console.error('Error fetching upcoming payments:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/notifications/overdue-payments
// @desc    Get list of overdue payments for reminder emails
router.get('/overdue-payments', [auth, adminAuth], async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Find all active loans with overdue installments
        const loans = await Loan.find({
            status: 'active',
            'installments.dueDate': { $lt: today },
            'installments.status': { $in: ['pending', 'partial'] }
        });
        
        const overduePayments = [];
        
        for (const loan of loans) {
            const overdueInstallments = loan.installments.filter(inst => 
                inst.dueDate < today && inst.status !== 'paid'
            );
            
            for (const installment of overdueInstallments) {
                const daysOverdue = Math.floor((today - installment.dueDate) / (1000 * 60 * 60 * 24));
                
                overduePayments.push({
                    loanId: loan.loanId,
                    customerName: loan.name,
                    customerEmail: loan.email,
                    customerMobile: loan.primaryMobile,
                    installmentNumber: installment.number,
                    totalInstallments: loan.term,
                    amount: installment.amount,
                    dueDate: installment.dueDate,
                    daysOverdue,
                    totalPaid: loan.totalPaid,
                    remainingBalance: loan.remainingBalance,
                    status: installment.status
                });
            }
        }
        
        // Sort by days overdue (most overdue first)
        overduePayments.sort((a, b) => b.daysOverdue - a.daysOverdue);
        
        res.json({
            success: true,
            data: overduePayments,
            count: overduePayments.length
        });
    } catch (err) {
        console.error('Error fetching overdue payments:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router; 