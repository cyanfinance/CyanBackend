const cron = require('node-cron');
const { processGoldReturnReminders } = require('./goldReturnManager');
const { processInterestRateUpgrades } = require('./interestRateUpgradeManager');

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

// Schedule interest rate upgrades to run daily at 11:00 AM
const scheduleInterestRateUpgrades = () => {
  cron.schedule('0 11 * * *', async () => {
    console.log('🕘 Running scheduled interest rate upgrades...');
    try {
      await processInterestRateUpgrades();
      console.log('✅ Scheduled interest rate upgrades completed successfully');
    } catch (error) {
      console.error('❌ Error in scheduled interest rate upgrades:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  // For testing: also run every 5 minutes (remove this in production)
  if (process.env.NODE_ENV === 'development') {
    cron.schedule('*/5 * * * *', async () => {
      console.log('🧪 [TEST] Running interest rate upgrades every 5 minutes...');
      try {
        await processInterestRateUpgrades();
        console.log('✅ [TEST] Interest rate upgrades completed successfully');
      } catch (error) {
        console.error('❌ [TEST] Error in interest rate upgrades:', error);
      }
    }, {
      scheduled: true,
      timezone: "Asia/Kolkata"
    });
    console.log('🧪 [TEST] Interest rate upgrades also scheduled to run every 5 minutes in development');
  }
  
  console.log('📅 Interest rate upgrades scheduled to run daily at 11:00 AM IST');
};

// Initialize all cron jobs
const initializeCronJobs = () => {
  console.log('🚀 Initializing cron jobs...');
  
  scheduleGoldReturnReminders();
  scheduleAdminNotifications();
  scheduleInterestRateUpgrades();
  
  console.log('✅ All cron jobs initialized successfully');
  
  // Test the interest rate upgrade process immediately on startup (for debugging)
  if (process.env.NODE_ENV === 'development') {
    console.log('🧪 [TEST] Running interest rate upgrade test on startup...');
    setTimeout(async () => {
      try {
        await processInterestRateUpgrades();
        console.log('✅ [TEST] Startup interest rate upgrade test completed');
      } catch (error) {
        console.error('❌ [TEST] Startup interest rate upgrade test failed:', error);
      }
    }, 5000); // Wait 5 seconds after server startup
  }
};

module.exports = {
  initializeCronJobs,
  scheduleGoldReturnReminders,
  scheduleAdminNotifications,
  scheduleInterestRateUpgrades
};

// Run if called directly
if (require.main === module) {
  initializeCronJobs();
}
