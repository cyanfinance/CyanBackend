const cron = require('node-cron');
const CronJobHistory = require('../models/CronJobHistory');
const { processInterestRateUpgrades } = require('./interestRateUpgradeManager');
const { sendAllPaymentReminders } = require('./sendPaymentReminders');

// Helper function to execute jobs with logging
async function executeJobWithLogging(jobName, jobFunction) {
    const historyRecord = new CronJobHistory({
        jobName,
        executionType: 'scheduled',
        status: 'running',
        startTime: new Date()
    });
    
    await historyRecord.save();
    
    try {
        const result = await jobFunction();
        
        await historyRecord.markCompleted('success', null, null, {
            recordsProcessed: result?.processed || 0,
            recordsSuccessful: result?.successful || 0,
            recordsFailed: result?.failed || 0,
            executionTime: new Date()
        });
        
        return result;
    } catch (error) {
        await historyRecord.markCompleted('failed', error.message, error.stack, {
            executionTime: new Date()
        });
        throw error;
    }
}


// Schedule interest rate upgrades to run daily at 11:00 AM
const scheduleInterestRateUpgrades = () => {
  cron.schedule('0 11 * * *', async () => {
    console.log('🕘 Running scheduled interest rate upgrades...');
    try {
      await executeJobWithLogging('interest_rate_upgrades', processInterestRateUpgrades);
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

// Schedule payment reminders to run daily at 8:00 AM
const schedulePaymentReminders = () => {
  cron.schedule('0 8 * * *', async () => {
    console.log('🕘 Running scheduled payment reminders...');
    try {
      await executeJobWithLogging('payment_reminders', sendAllPaymentReminders);
      console.log('✅ Scheduled payment reminders completed successfully');
    } catch (error) {
      console.error('❌ Error in scheduled payment reminders:', error);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kolkata"
  });
  
  console.log('📅 Payment reminders scheduled to run daily at 8:00 AM IST');
};

// Initialize all cron jobs
const initializeCronJobs = () => {
  console.log('🚀 Initializing cron jobs...');
  
  scheduleInterestRateUpgrades();
  schedulePaymentReminders();
  
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
  scheduleInterestRateUpgrades,
  schedulePaymentReminders
};

// Run if called directly
if (require.main === module) {
  initializeCronJobs();
}
