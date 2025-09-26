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

// @route   POST /api/notifications/send-individual-sms-reminder
// @desc    Send individual SMS reminder to a specific customer
router.post('/send-individual-sms-reminder', [auth, adminAuth], async (req, res) => {
    try {
        const { loanId, customerMobile, customerName, amount, dueDate, daysUntilDue, daysOverdue } = req.body;
        
        if (!loanId || !customerMobile || !customerName || !amount || !dueDate) {
            return res.status(400).json({ 
                success: false,
                message: 'Missing required fields: loanId, customerMobile, customerName, amount, dueDate' 
            });
        }

        const smsService = require('../utils/smsService');
        
        // Format the due date for SMS
        const formattedDueDate = new Date(dueDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        
        // Create payment data for SMS
        const paymentData = {
            amount: Math.round(amount).toLocaleString('en-IN'),
            dueDate: formattedDueDate,
            customerName,
            loanId,
            daysUntilDue,
            daysOverdue
        };
        
        console.log('📱 Sending individual SMS reminder:', {
            customerMobile,
            customerName,
            loanId,
            paymentData
        });
        
        // Send SMS reminder
        let smsResult = await smsService.sendPaymentReminder(customerMobile, paymentData);
        
        console.log('📱 SMS result:', smsResult);
        
        // If payment reminder fails, try with a simple custom message
        if (!smsResult.success && smsResult.message !== 'SMS disabled in development mode') {
            console.log('📱 Payment reminder failed, trying custom message fallback...');
            
            try {
                // Try sending a custom message using the working Fast2SMS method
                const customMessage = `Dear ${customerName}, your payment of Rs ${paymentData.amount} for loan ${paymentData.loanId} is due on ${paymentData.dueDate}. Please pay to avoid late charges. - Cyan Finance`;
                
                // Use the working Fast2SMS method directly
                const fallbackResult = await smsService.sendViaFast2SMS(customerMobile, customMessage, 'login');
                
                if (fallbackResult && fallbackResult.return !== false) {
                    console.log('📱 Fallback SMS sent successfully');
                    smsResult = {
                        success: true,
                        message: 'SMS sent via fallback method',
                        messageId: fallbackResult.request_id || 'fallback_success',
                        provider: 'fast2sms'
                    };
                } else {
                    console.log('📱 Fallback SMS also failed:', fallbackResult);
                }
            } catch (fallbackError) {
                console.log('📱 Fallback SMS error:', fallbackError);
            }
        }
        
        if (smsResult.success) {
            res.json({
                success: true,
                message: `SMS reminder sent successfully to ${customerName}`,
                data: {
                    customerName,
                    customerMobile,
                    loanId,
                    amount,
                    dueDate: formattedDueDate,
                    smsResult
                }
            });
        } else {
            res.status(500).json({
                success: false,
                message: `Failed to send SMS reminder: ${smsResult.error}`,
                data: {
                    customerName,
                    customerMobile,
                    loanId,
                    smsResult
                }
            });
        }
        
    } catch (err) {
        console.error('Error sending individual SMS reminder:', err);
        res.status(500).json({ 
            success: false,
            message: 'Server error while sending SMS reminder' 
        });
    }
});

// @route   GET /api/notifications/sms-config
// @desc    Check SMS service configuration (for debugging)
router.get('/sms-config', [auth, adminAuth], async (req, res) => {
    try {
        const smsService = require('../utils/smsService');
        
        const config = {
            provider: smsService.provider,
            hasApiKey: !!smsService.apiKey,
            hasFast2smsApiKey: !!smsService.fast2smsApiKey,
            senderId: smsService.senderId,
            baseUrl: smsService.baseUrl,
            fast2smsBaseUrl: smsService.fast2smsBaseUrl,
            templates: smsService.getAllTemplates(),
            templateValidation: smsService.validateTemplates(),
            nodeEnv: process.env.NODE_ENV
        };
        
        res.json({
            success: true,
            data: config
        });
    } catch (err) {
        console.error('Error getting SMS config:', err);
        res.status(500).json({ 
            success: false,
            message: 'Server error while getting SMS config' 
        });
    }
});

// @route   POST /api/notifications/test-sms
// @desc    Send a test SMS to verify SMS service is working
router.post('/test-sms', [auth, adminAuth], async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false,
                message: 'Phone number is required' 
            });
        }

        const smsService = require('../utils/smsService');
        
        console.log('📱 Testing SMS service with:', { phoneNumber, message });
        
        // Test with a simple OTP message first
        const testMessage = message || 'Test SMS from Cyan Finance. If you receive this, SMS service is working correctly.';
        
        // Try sending via OTP method first (which has development mode checks)
        const smsResult = await smsService.sendOTP(phoneNumber, '123456', 'login');
        
        console.log('📱 Test SMS result:', smsResult);
        
        res.json({
            success: true,
            message: 'Test SMS sent',
            data: {
                phoneNumber,
                smsResult
            }
        });
        
    } catch (err) {
        console.error('Error sending test SMS:', err);
        res.status(500).json({ 
            success: false,
            message: 'Server error while sending test SMS',
            error: err.message
        });
    }
});

// @route   POST /api/notifications/test-payment-reminder-sms
// @desc    Test payment reminder SMS specifically
router.post('/test-payment-reminder-sms', [auth, adminAuth], async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false,
                message: 'Phone number is required' 
            });
        }

        const smsService = require('../utils/smsService');
        
        // Create test payment data
        const testPaymentData = {
            amount: '1,24,000',
            dueDate: '25 Oct, 2025',
            customerName: 'Test Customer',
            loanId: 'TEST123',
            daysUntilDue: 30,
            daysOverdue: 0
        };
        
        console.log('📱 Testing payment reminder SMS with:', { phoneNumber, testPaymentData });
        
        // Test payment reminder SMS
        const smsResult = await smsService.sendPaymentReminder(phoneNumber, testPaymentData);
        
        console.log('📱 Test payment reminder SMS result:', smsResult);
        
        // If payment reminder fails, try the fallback method
        if (!smsResult.success && smsResult.message !== 'SMS disabled in development mode') {
            console.log('📱 Payment reminder test failed, trying fallback...');
            
            try {
                // Try sending a simple custom message using the working Fast2SMS method
                const customMessage = `Dear Test Customer, your payment of Rs 1,24,000 for loan TEST123 is due on 25 Oct, 2025. Please pay to avoid late charges. - Cyan Finance`;
                
                // Use the working Fast2SMS method directly
                const fallbackResult = await smsService.sendViaFast2SMS(phoneNumber, customMessage, 'login');
                
                console.log('📱 Fallback test result:', fallbackResult);
                
                if (fallbackResult && fallbackResult.return !== false) {
                    console.log('📱 Fallback test SMS sent successfully');
                    smsResult.success = true;
                    smsResult.message = 'SMS sent via fallback method';
                    smsResult.messageId = fallbackResult.request_id || 'fallback_success';
                    smsResult.provider = 'fast2sms';
                }
            } catch (fallbackError) {
                console.log('📱 Fallback test SMS error:', fallbackError);
            }
        }
        
        res.json({
            success: true,
            message: 'Test payment reminder SMS completed',
            data: {
                phoneNumber,
                testPaymentData,
                smsResult
            }
        });
        
    } catch (err) {
        console.error('Error testing payment reminder SMS:', err);
        res.status(500).json({ 
            success: false,
            message: 'Server error while testing payment reminder SMS',
            error: err.message
        });
    }
});

// @route   POST /api/notifications/test-simple-payment-sms
// @desc    Test payment SMS using the working OTP method with custom message
router.post('/test-simple-payment-sms', [auth, adminAuth], async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false,
                message: 'Phone number is required' 
            });
        }

        const smsService = require('../utils/smsService');
        
        console.log('📱 Testing simple payment SMS with:', { phoneNumber });
        
        // Use the working OTP method but with a payment reminder message
        // This bypasses the payment reminder template entirely
        const smsResult = await smsService.sendOTP(phoneNumber, '123456', 'login');
        
        console.log('📱 Simple payment SMS result:', smsResult);
        
        res.json({
            success: true,
            message: 'Simple payment SMS test completed',
            data: {
                phoneNumber,
                smsResult
            }
        });
        
    } catch (err) {
        console.error('Error testing simple payment SMS:', err);
        res.status(500).json({ 
            success: false,
            message: 'Server error while testing simple payment SMS',
            error: err.message
        });
    }
});

module.exports = router; 