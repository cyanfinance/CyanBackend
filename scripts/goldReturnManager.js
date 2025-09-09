const mongoose = require('mongoose');
const Loan = require('../models/Loan');
const { sendBrevoEmail } = require('../utils/brevo');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cyan-finance', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Gold Return Reminder Schedule
const REMINDER_SCHEDULE = {
  initial: 3,    // 3 days after loan closure
  followup: 7,   // 7 days after loan closure
  urgent: 15,    // 15 days after loan closure
  final: 30      // 30 days after loan closure
};

// Send gold return reminder email
async function sendGoldReturnReminder(loan, reminderType) {
  const customerEmail = loan.email;
  const customerName = loan.name;
  const loanId = loan.loanId;
  const totalGoldWeight = loan.goldItems.reduce((total, item) => total + item.netWeight, 0);
  const daysSinceClosed = Math.floor((new Date() - loan.closedDate) / (1000 * 60 * 60 * 24));
  
  let subject, message;
  
  switch (reminderType) {
    case 'initial':
      subject = `Gold Return Reminder - Loan ${loanId}`;
      message = `
        <p>Dear ${customerName},</p>
        <p>Your loan <strong>${loanId}</strong> has been successfully closed. We have your gold items ready for collection.</p>
        <p><strong>Gold Details:</strong></p>
        <ul>
          <li>Total Gold Weight: ${totalGoldWeight}g</li>
          <li>Number of Items: ${loan.goldItems.length}</li>
        </ul>
        <p>Please visit our office to collect your gold items. Don't forget to bring:</p>
        <ul>
          <li>Valid ID proof</li>
          <li>Loan closure receipt</li>
        </ul>
        <p>Office Address: BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016</p>
        <p>Contact: +91-9700049444</p>
        <p>Thank you for choosing Cyan Finance!</p>
      `;
      break;
      
    case 'followup':
      subject = `Follow-up: Gold Collection Reminder - Loan ${loanId}`;
      message = `
        <p>Dear ${customerName},</p>
        <p>This is a friendly reminder that your gold items from loan <strong>${loanId}</strong> are still waiting for collection.</p>
        <p>It has been ${daysSinceClosed} days since your loan was closed.</p>
        <p><strong>Gold Details:</strong></p>
        <ul>
          <li>Total Gold Weight: ${totalGoldWeight}g</li>
          <li>Number of Items: ${loan.goldItems.length}</li>
        </ul>
        <p>Please arrange to collect your gold items at your earliest convenience.</p>
        <p>Office Address: BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016</p>
        <p>Contact: +91-9700049444</p>
      `;
      break;
      
    case 'urgent':
      subject = `URGENT: Gold Collection Required - Loan ${loanId}`;
      message = `
        <p>Dear ${customerName},</p>
        <p><strong>URGENT:</strong> Your gold items from loan <strong>${loanId}</strong> have been waiting for collection for ${daysSinceClosed} days.</p>
        <p>We strongly recommend collecting your gold items immediately to ensure their safety.</p>
        <p><strong>Gold Details:</strong></p>
        <ul>
          <li>Total Gold Weight: ${totalGoldWeight}g</li>
          <li>Number of Items: ${loan.goldItems.length}</li>
        </ul>
        <p>Please contact us immediately to schedule collection:</p>
        <p>Phone: +91-9700049444</p>
        <p>Office Address: BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016</p>
      `;
      break;
      
    case 'final':
      subject = `FINAL NOTICE: Gold Collection - Loan ${loanId}`;
      message = `
        <p>Dear ${customerName},</p>
        <p><strong>FINAL NOTICE:</strong> Your gold items from loan <strong>${loanId}</strong> have been waiting for collection for ${daysSinceClosed} days.</p>
        <p>This is our final reminder. Please collect your gold items within the next 7 days.</p>
        <p><strong>Gold Details:</strong></p>
        <ul>
          <li>Total Gold Weight: ${totalGoldWeight}g</li>
          <li>Number of Items: ${loan.goldItems.length}</li>
        </ul>
        <p>Contact us immediately:</p>
        <p>Phone: +91-9700049444</p>
        <p>Office Address: BK Towers, Akkayyapalem, Visakhapatnam, Andhra Pradesh-530016</p>
        <p>If not collected within 7 days, we may need to take additional measures for safekeeping.</p>
      `;
      break;
  }
  
  try {
    await sendBrevoEmail({
      to: customerEmail,
      subject: subject,
      html: message
    });
    
    // Record the reminder
    await loan.addGoldReturnReminder(reminderType, 'customer', message);
    
    console.log(`✅ Sent ${reminderType} reminder to ${customerName} (${customerEmail}) for loan ${loanId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send ${reminderType} reminder to ${customerEmail}:`, error);
    return false;
  }
}

// Send admin notification for overdue gold returns
async function sendAdminNotification(loan) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cyanfinance.in';
  const customerName = loan.name;
  const loanId = loan.loanId;
  const daysSinceClosed = Math.floor((new Date() - loan.closedDate) / (1000 * 60 * 60 * 24));
  const totalGoldWeight = loan.goldItems.reduce((total, item) => total + item.netWeight, 0);
  
  const subject = `ADMIN ALERT: Overdue Gold Return - Loan ${loanId}`;
  const message = `
    <p><strong>ADMIN ALERT:</strong></p>
    <p>Customer ${customerName} has not collected their gold items for ${daysSinceClosed} days.</p>
    <p><strong>Loan Details:</strong></p>
    <ul>
      <li>Loan ID: ${loanId}</li>
      <li>Customer: ${customerName}</li>
      <li>Mobile: ${loan.primaryMobile}</li>
      <li>Email: ${loan.email}</li>
      <li>Total Gold Weight: ${totalGoldWeight}g</li>
      <li>Days Since Closure: ${daysSinceClosed}</li>
    </ul>
    <p><strong>Gold Items:</strong></p>
    <ul>
      ${loan.goldItems.map(item => `<li>${item.description}: ${item.netWeight}g</li>`).join('')}
    </ul>
    <p>Please contact the customer immediately to arrange gold collection.</p>
  `;
  
  try {
    await sendBrevoEmail({
      to: adminEmail,
      subject: subject,
      html: message
    });
    
    await loan.addGoldReturnReminder('urgent', 'admin', message);
    console.log(`✅ Sent admin notification for overdue gold return - Loan ${loanId}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to send admin notification:`, error);
    return false;
  }
}

// Main function to process gold return reminders
async function processGoldReturnReminders() {
  try {
    console.log('🔄 Starting Gold Return Reminder Process...');
    
    // Find all closed loans with pending gold returns
    const closedLoans = await Loan.find({
      status: 'closed',
      goldReturnStatus: { $in: ['pending', 'scheduled'] }
    });
    
    console.log(`Found ${closedLoans.length} closed loans with pending gold returns`);
    
    let remindersSent = 0;
    let adminNotificationsSent = 0;
    
    for (const loan of closedLoans) {
      const daysSinceClosed = Math.floor((new Date() - loan.closedDate) / (1000 * 60 * 60 * 24));
      
      // Check if overdue (more than 30 days)
      if (daysSinceClosed > 30) {
        loan.goldReturnStatus = 'overdue';
        await loan.save();
        
        // Send admin notification for overdue returns
        const adminNotified = await sendAdminNotification(loan);
        if (adminNotified) adminNotificationsSent++;
      }
      
      // Check reminder schedule
      for (const [reminderType, daysRequired] of Object.entries(REMINDER_SCHEDULE)) {
        if (daysSinceClosed >= daysRequired) {
          // Check if this reminder was already sent
          const reminderAlreadySent = loan.goldReturnReminders.some(
            reminder => reminder.type === reminderType
          );
          
          if (!reminderAlreadySent) {
            const reminderSent = await sendGoldReturnReminder(loan, reminderType);
            if (reminderSent) remindersSent++;
          }
        }
      }
    }
    
    console.log(`✅ Gold Return Reminder Process Complete:`);
    console.log(`   - Customer reminders sent: ${remindersSent}`);
    console.log(`   - Admin notifications sent: ${adminNotificationsSent}`);
    console.log(`   - Total loans processed: ${closedLoans.length}`);
    
  } catch (error) {
    console.error('❌ Error in gold return reminder process:', error);
  }
}

// Function to get gold return statistics
async function getGoldReturnStats() {
  try {
    const stats = await Loan.aggregate([
      {
        $match: { status: 'closed' }
      },
      {
        $group: {
          _id: '$goldReturnStatus',
          count: { $sum: 1 },
          totalGoldWeight: { $sum: { $reduce: { input: '$goldItems', initialValue: 0, in: { $add: ['$$value', '$$this.netWeight'] } } } }
        }
      }
    ]);
    
    const totalClosedLoans = await Loan.countDocuments({ status: 'closed' });
    const overdueLoans = await Loan.countDocuments({ 
      status: 'closed', 
      goldReturnStatus: 'overdue' 
    });
    
    console.log('📊 Gold Return Statistics:');
    console.log(`   - Total closed loans: ${totalClosedLoans}`);
    console.log(`   - Overdue returns: ${overdueLoans}`);
    
    stats.forEach(stat => {
      console.log(`   - ${stat._id}: ${stat.count} loans (${stat.totalGoldWeight}g gold)`);
    });
    
    return { stats, totalClosedLoans, overdueLoans };
  } catch (error) {
    console.error('❌ Error getting gold return stats:', error);
    return null;
  }
}

// Function to manually trigger reminders for a specific loan
async function sendManualReminder(loanId, reminderType = 'urgent') {
  try {
    const loan = await Loan.findOne({ loanId, status: 'closed' });
    if (!loan) {
      console.error(`❌ Loan ${loanId} not found or not closed`);
      return false;
    }
    
    const reminderSent = await sendGoldReturnReminder(loan, reminderType);
    return reminderSent;
  } catch (error) {
    console.error(`❌ Error sending manual reminder for loan ${loanId}:`, error);
    return false;
  }
}

// Export functions for use in other modules
module.exports = {
  processGoldReturnReminders,
  getGoldReturnStats,
  sendManualReminder,
  sendGoldReturnReminder,
  sendAdminNotification
};

// Run the script if called directly
if (require.main === module) {
  const command = process.argv[2];
  
  switch (command) {
    case 'reminders':
      processGoldReturnReminders().then(() => {
        mongoose.connection.close();
        process.exit(0);
      });
      break;
      
    case 'stats':
      getGoldReturnStats().then(() => {
        mongoose.connection.close();
        process.exit(0);
      });
      break;
      
    case 'manual':
      const loanId = process.argv[3];
      const reminderType = process.argv[4] || 'urgent';
      if (!loanId) {
        console.error('❌ Please provide loan ID: node goldReturnManager.js manual <loanId> [reminderType]');
        process.exit(1);
      }
      sendManualReminder(loanId, reminderType).then(() => {
        mongoose.connection.close();
        process.exit(0);
      });
      break;
      
    default:
      console.log('Usage:');
      console.log('  node goldReturnManager.js reminders  - Process all gold return reminders');
      console.log('  node goldReturnManager.js stats      - Get gold return statistics');
      console.log('  node goldReturnManager.js manual <loanId> [reminderType] - Send manual reminder');
      process.exit(0);
  }
}
