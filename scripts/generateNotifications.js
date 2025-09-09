require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const Loan = require('../models/Loan');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB for notification generation'))
.catch(err => console.error('MongoDB connection error:', err));

// Function to generate payment due notifications
async function generatePaymentDueNotifications() {
    try {
        console.log('Starting payment due notification generation...');
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
        
        console.log(`Found ${loans.length} loans with payments due today`);
        
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
                console.log(`Created payment due notification for ${loan.name} - ${loan.loanId}`);
            }
        }
        
        console.log(`Generated ${notifications.length} new payment due notifications`);
        return notifications;
    } catch (error) {
        console.error('Error generating payment due notifications:', error);
        throw error;
    }
}

// Function to generate overdue payment notifications
async function generateOverdueNotifications() {
    try {
        console.log('Starting overdue notification generation...');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Find all active loans with overdue installments
        const loans = await Loan.find({
            status: 'active',
            'installments.dueDate': { $lt: today },
            'installments.status': { $in: ['pending', 'partial'] }
        });
        
        console.log(`Found ${loans.length} loans with overdue payments`);
        
        const notifications = [];
        
        for (const loan of loans) {
            const overdueInstallments = loan.installments.filter(inst => 
                inst.dueDate < today && inst.status !== 'paid'
            );
            
            for (const installment of overdueInstallments) {
                const daysOverdue = Math.floor((today - installment.dueDate) / (1000 * 60 * 60 * 24));
                
                // Check if notification already exists for this installment (within last 24 hours)
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
                    console.log(`Created overdue notification for ${loan.name} - ${daysOverdue} days overdue`);
                }
            }
        }
        
        console.log(`Generated ${notifications.length} new overdue notifications`);
        return notifications;
    } catch (error) {
        console.error('Error generating overdue notifications:', error);
        throw error;
    }
}

// Main function to run all notification generation
async function generateAllNotifications() {
    try {
        console.log('=== Starting Daily Notification Generation ===');
        console.log(`Time: ${new Date().toISOString()}`);
        
        // Generate payment due notifications
        const dueNotifications = await generatePaymentDueNotifications();
        
        // Generate overdue notifications
        const overdueNotifications = await generateOverdueNotifications();
        
        console.log('=== Notification Generation Complete ===');
        console.log(`Total notifications generated: ${dueNotifications.length + overdueNotifications.length}`);
        console.log(`- Payment due: ${dueNotifications.length}`);
        console.log(`- Overdue: ${overdueNotifications.length}`);
        
        // Close database connection
        await mongoose.connection.close();
        console.log('Database connection closed');
        
        process.exit(0);
    } catch (error) {
        console.error('Error in notification generation:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

// Run the script if called directly
if (require.main === module) {
    generateAllNotifications();
}

module.exports = {
    generatePaymentDueNotifications,
    generateOverdueNotifications,
    generateAllNotifications
}; 