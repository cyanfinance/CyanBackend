const cron = require('node-cron');
const { processGoldReturnReminders } = require('./goldReturnManager');

// Schedule gold return reminders to run daily at 9:00 AM
const scheduleGoldReturnReminders = () => {
  cron.schedule('0 9 * * *', async () => {
    console.log('🕘 Running scheduled gold return reminders...');
    try {
      await processGoldReturnReminders();
      console.log('✅ Scheduled gold return reminders completed successfully');
    } catch (error) {
      console.error('❌ Error in scheduled gold return reminders:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata" // Indian Standard Time
  });
  
  console.log('📅 Gold return reminders scheduled to run daily at 9:00 AM IST');
};

// Schedule admin notifications for overdue returns to run daily at 10:00 AM
const scheduleAdminNotifications = () => {
  cron.schedule('0 10 * * *', async () => {
    console.log('🕘 Running scheduled admin notifications for overdue gold returns...');
    try {
      // This will be handled by the main processGoldReturnReminders function
      await processGoldReturnReminders();
      console.log('✅ Scheduled admin notifications completed successfully');
    } catch (error) {
      console.error('❌ Error in scheduled admin notifications:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  console.log('📅 Admin notifications scheduled to run daily at 10:00 AM IST');
};

// Initialize all cron jobs
const initializeCronJobs = () => {
  console.log('🚀 Initializing cron jobs...');
  
  scheduleGoldReturnReminders();
  scheduleAdminNotifications();
  
  console.log('✅ All cron jobs initialized successfully');
};

module.exports = {
  initializeCronJobs,
  scheduleGoldReturnReminders,
  scheduleAdminNotifications
};

// Run if called directly
if (require.main === module) {
  initializeCronJobs();
}
