// Load environment variables first
require('dotenv').config();

const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const Customer = require('../models/Customer');
const { sendPaymentReminderEmail } = require('../utils/brevo');
const paymentNotificationService = require('../utils/paymentNotificationService');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Function to send upcoming payment reminders (3 days, 1 day, and day of)
async function sendUpcomingPaymentReminders() {
  try {
    console.log('Starting upcoming payment reminder emails...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Find all active loans with upcoming installments
    const loans = await Loan.find({
      status: 'active',
      'installments.status': { $in: ['pending', 'partial'] }
    }).populate('customerId');
    
    console.log(`Found ${loans.length} active loans to check for upcoming payments`);
    
    let emailsSent = 0;
    
    for (const loan of loans) {
      // Get the next unpaid installment
      const nextInstallment = loan.installments.find(inst => 
        inst.status === 'pending' || inst.status === 'partial'
      );
      
      if (!nextInstallment) continue;
      
      const dueDate = new Date(nextInstallment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      // Send reminders for payments due in 3 days, 1 day, and today
      if (daysUntilDue === 3 || daysUntilDue === 1 || daysUntilDue === 0) {
        // Check if we already sent a reminder for this installment today
        const reminderKey = `reminder_${loan._id}_${nextInstallment.number}_${daysUntilDue}`;
        
        // For now, we'll send reminders without duplicate checking
        // In production, you might want to add a field to track sent reminders
        
        try {
          // Prepare customer data
          const customerData = {
            name: loan.customerId?.name || loan.name || 'Customer',
            email: loan.customerId?.email || loan.email,
            primaryMobile: loan.customerId?.primaryMobile || loan.customerId?.mobile || loan.mobile
          };

          // Prepare payment data
          const paymentData = {
            loanId: loan.loanId,
            amount: nextInstallment.amount,
            dueDate: nextInstallment.dueDate,
            daysUntilDue: daysUntilDue,
            isOverdue: false,
            totalPaid: loan.totalPaid,
            remainingBalance: loan.remainingBalance,
            installmentNumber: nextInstallment.number,
            totalInstallments: loan.term,
            customerName: customerData.name
          };

          // Send both email and SMS reminders
          const result = await paymentNotificationService.sendPaymentReminder(customerData, paymentData);
          
          if (result.overall.success) {
            emailsSent++;
            console.log(`Sent ${daysUntilDue === 0 ? 'due today' : `${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''} advance`} reminder to ${customerData.name} for loan ${loan.loanId}`);
            console.log(`  Email: ${result.email.success ? '✅' : '❌'}, SMS: ${result.sms.success ? '✅' : '❌'}`);
          }
        } catch (error) {
          console.error(`Failed to send reminder for loan ${loan.loanId}:`, error);
        }
      }
    }
    
    console.log(`Sent ${emailsSent} upcoming payment reminder emails`);
    return emailsSent;
  } catch (error) {
    console.error('Error sending upcoming payment reminders:', error);
    throw error;
  }
}

// Function to send overdue payment reminders
async function sendOverduePaymentReminders() {
  try {
    console.log('Starting overdue payment reminder emails...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Find all active loans with overdue installments
    const loans = await Loan.find({
      status: 'active',
      'installments.dueDate': { $lt: today },
      'installments.status': { $in: ['pending', 'partial'] }
    }).populate('customerId');
    
    console.log(`Found ${loans.length} loans with overdue payments`);
    
    let emailsSent = 0;
    
    for (const loan of loans) {
      const overdueInstallments = loan.installments.filter(inst => 
        inst.dueDate < today && inst.status !== 'paid'
      );
      
      for (const installment of overdueInstallments) {
        const daysOverdue = Math.floor((today - installment.dueDate) / (1000 * 60 * 60 * 24));
        
        // Send overdue reminders for any overdue payment (removed specific day restrictions)
        if (daysOverdue > 0) {
          try {
            // Prepare customer data
            const customerData = {
              name: loan.customerId?.name || loan.name || 'Customer',
              email: loan.customerId?.email || loan.email,
              primaryMobile: loan.customerId?.primaryMobile || loan.customerId?.mobile || loan.mobile
            };

            // Prepare payment data
            const paymentData = {
              loanId: loan.loanId,
              amount: installment.amount,
              dueDate: installment.dueDate,
              daysUntilDue: 0,
              isOverdue: true,
              daysOverdue: daysOverdue,
              totalPaid: loan.totalPaid,
              remainingBalance: loan.remainingBalance,
              installmentNumber: installment.number,
              totalInstallments: loan.term,
              customerName: customerData.name
            };

            // Send both email and SMS reminders
            const result = await paymentNotificationService.sendPaymentReminder(customerData, paymentData);
            
            if (result.overall.success) {
              emailsSent++;
              console.log(`Sent overdue reminder (${daysOverdue} days) to ${customerData.name} for loan ${loan.loanId}`);
              console.log(`  Email: ${result.email.success ? '✅' : '❌'}, SMS: ${result.sms.success ? '✅' : '❌'}`);
            }
          } catch (error) {
            console.error(`Failed to send overdue reminder for loan ${loan.loanId}:`, error);
          }
        }
      }
    }
    
    console.log(`Sent ${emailsSent} overdue payment reminder emails`);
    return emailsSent;
  } catch (error) {
    console.error('Error sending overdue payment reminders:', error);
    throw error;
  }
}

// Function to send weekly summary reminders
async function sendWeeklySummaryReminders() {
  try {
    console.log('Starting weekly summary reminder emails...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Only send on Mondays (day 1)
    if (today.getDay() !== 1) {
      console.log('Not Monday, skipping weekly summary reminders');
      return 0;
    }
    
    // Find all active loans
    const loans = await Loan.find({
      status: 'active',
      'installments.status': { $in: ['pending', 'partial'] }
    });
    
    console.log(`Found ${loans.length} active loans for weekly summary`);
    
    let emailsSent = 0;
    
    for (const loan of loans) {
      const nextInstallment = loan.installments.find(inst => 
        inst.status === 'pending' || inst.status === 'partial'
      );
      
      if (!nextInstallment) continue;
      
      const dueDate = new Date(nextInstallment.dueDate);
      dueDate.setHours(0, 0, 0, 0);
      
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
      
      // Send weekly summary if payment is due within 7 days
      if (daysUntilDue <= 7) {
        try {
          // Prepare customer data
          const customerData = {
            name: loan.customerId?.name || loan.name || 'Customer',
            email: loan.customerId?.email || loan.email,
            primaryMobile: loan.customerId?.primaryMobile || loan.customerId?.mobile || loan.mobile
          };

          // Prepare payment data
          const paymentData = {
            loanId: loan.loanId,
            amount: nextInstallment.amount,
            dueDate: nextInstallment.dueDate,
            daysUntilDue: daysUntilDue,
            isOverdue: false,
            totalPaid: loan.totalPaid,
            remainingBalance: loan.remainingBalance,
            installmentNumber: nextInstallment.number,
            totalInstallments: loan.term,
            customerName: customerData.name
          };

          // Send both email and SMS reminders
          const result = await paymentNotificationService.sendPaymentReminder(customerData, paymentData);
          
          if (result.overall.success) {
            emailsSent++;
            console.log(`Sent weekly summary to ${customerData.name} for loan ${loan.loanId}`);
            console.log(`  Email: ${result.email.success ? '✅' : '❌'}, SMS: ${result.sms.success ? '✅' : '❌'}`);
          }
        } catch (error) {
          console.error(`Failed to send weekly summary for loan ${loan.loanId}:`, error);
        }
      }
    }
    
    console.log(`Sent ${emailsSent} weekly summary reminder emails`);
    return emailsSent;
  } catch (error) {
    console.error('Error sending weekly summary reminders:', error);
    throw error;
  }
}

// Main function to run all reminder types
async function sendAllPaymentReminders() {
  try {
    console.log('=== Starting Payment Reminder Email System ===');
    console.log(`Time: ${new Date().toISOString()}`);
    
    // Send upcoming payment reminders
    const upcomingCount = await sendUpcomingPaymentReminders();
    
    // Send overdue payment reminders
    const overdueCount = await sendOverduePaymentReminders();
    
    // Send weekly summary reminders
    const weeklyCount = await sendWeeklySummaryReminders();
    
    console.log('=== Payment Reminder Email System Complete ===');
    console.log(`Total emails sent: ${upcomingCount + overdueCount + weeklyCount}`);
    console.log(`- Upcoming reminders: ${upcomingCount}`);
    console.log(`- Overdue reminders: ${overdueCount}`);
    console.log(`- Weekly summaries: ${weeklyCount}`);
    
    // Close database connection
    await mongoose.connection.close();
    console.log('Database connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Error in payment reminder system:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  sendAllPaymentReminders();
}

module.exports = {
  sendUpcomingPaymentReminders,
  sendOverduePaymentReminders,
  sendWeeklySummaryReminders,
  sendAllPaymentReminders
}; 