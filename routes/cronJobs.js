const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const CronJobHistory = require('../models/CronJobHistory');
const { processInterestRateUpgrades } = require('../scripts/interestRateUpgradeManager');
const { sendAllPaymentReminders } = require('../scripts/sendPaymentReminders');

// @route   GET /api/cron-jobs/history
// @desc    Get cron job execution history
// @access  Admin only
router.get('/history', [auth, adminAuth], async (req, res) => {
    try {
        const { jobName, limit = 10 } = req.query;
        
        const history = await CronJobHistory.getJobHistory(jobName, parseInt(limit));
        
        res.json({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Error fetching cron job history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cron job history',
            error: error.message
        });
    }
});

// @route   GET /api/cron-jobs/stats
// @desc    Get cron job statistics
// @access  Admin only
router.get('/stats', [auth, adminAuth], async (req, res) => {
    try {
        const { jobName, days = 30 } = req.query;
        
        const stats = await CronJobHistory.getJobStats(jobName, parseInt(days));
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching cron job stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cron job statistics',
            error: error.message
        });
    }
});

// @route   POST /api/cron-jobs/execute/:jobName
// @desc    Manually execute a cron job
// @access  Admin only
router.post('/execute/:jobName', [auth, adminAuth], async (req, res) => {
    try {
        const { jobName } = req.params;
        const userId = req.user.id;
        
        // Validate job name
        const validJobs = [
            'interest_rate_upgrades',
            'payment_reminders'
        ];
        
        if (!validJobs.includes(jobName)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid job name. Valid jobs: ' + validJobs.join(', ')
            });
        }
        
        // Check if there's already a running job of this type
        const runningJob = await CronJobHistory.findOne({
            jobName,
            status: 'running'
        });
        
        if (runningJob) {
            return res.status(409).json({
                success: false,
                message: `Job '${jobName}' is already running. Started at: ${runningJob.startTime}`
            });
        }
        
        // Create history record
        const historyRecord = new CronJobHistory({
            jobName,
            executionType: 'manual',
            executedBy: userId,
            status: 'running',
            startTime: new Date()
        });
        
        await historyRecord.save();
        
        // Execute the job asynchronously
        executeJobAsync(jobName, historyRecord._id);
        
        res.json({
            success: true,
            message: `Job '${jobName}' started successfully`,
            executionId: historyRecord._id,
            startTime: historyRecord.startTime
        });
        
    } catch (error) {
        console.error('Error starting cron job:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start cron job',
            error: error.message
        });
    }
});

// @route   GET /api/cron-jobs/status/:executionId
// @desc    Get status of a specific job execution
// @access  Admin only
router.get('/status/:executionId', [auth, adminAuth], async (req, res) => {
    try {
        const { executionId } = req.params;
        
        const historyRecord = await CronJobHistory.findById(executionId)
            .populate('executedBy', 'name email');
        
        if (!historyRecord) {
            return res.status(404).json({
                success: false,
                message: 'Job execution not found'
            });
        }
        
        res.json({
            success: true,
            data: historyRecord
        });
        
    } catch (error) {
        console.error('Error fetching job status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job status',
            error: error.message
        });
    }
});

// @route   GET /api/cron-jobs/list
// @desc    Get list of available cron jobs
// @access  Admin only
router.get('/list', [auth, adminAuth], async (req, res) => {
    try {
        const jobs = [
            {
                name: 'interest_rate_upgrades',
                displayName: 'Interest Rate Upgrades',
                description: 'Process automatic interest rate upgrades for eligible loans',
                schedule: 'Daily at 11:00 AM IST',
                lastExecution: null,
                status: 'unknown'
            },
            {
                name: 'payment_reminders',
                displayName: 'Payment Reminders',
                description: 'Send payment reminders to customers with upcoming due dates',
                schedule: 'Daily at 8:00 AM IST',
                lastExecution: null,
                status: 'unknown'
            }
        ];
        
        // Get last execution info for each job
        for (let job of jobs) {
            const lastExecution = await CronJobHistory.findOne({ jobName: job.name })
                .sort({ startTime: -1 });
            
            if (lastExecution) {
                job.lastExecution = lastExecution.startTime;
                job.status = lastExecution.status;
            }
        }
        
        res.json({
            success: true,
            data: jobs
        });
        
    } catch (error) {
        console.error('Error fetching job list:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch job list',
            error: error.message
        });
    }
});

// Async function to execute jobs
async function executeJobAsync(jobName, historyId) {
    const historyRecord = await CronJobHistory.findById(historyId);
    let recordsProcessed = 0;
    let recordsSuccessful = 0;
    let recordsFailed = 0;
    
    try {
        console.log(`🔄 [MANUAL] Starting execution of job: ${jobName}`);
        
        switch (jobName) {
            case 'interest_rate_upgrades':
                const upgradeResult = await processInterestRateUpgrades();
                recordsProcessed = upgradeResult?.processed || 0;
                recordsSuccessful = upgradeResult?.successful || 0;
                recordsFailed = upgradeResult?.failed || 0;
                break;
                
            case 'payment_reminders':
                const paymentResult = await sendAllPaymentReminders();
                recordsProcessed = paymentResult?.processed || 0;
                recordsSuccessful = paymentResult?.successful || 0;
                recordsFailed = paymentResult?.failed || 0;
                break;
                
            default:
                throw new Error(`Unknown job: ${jobName}`);
        }
        
        await historyRecord.markCompleted('success', null, null, {
            recordsProcessed,
            recordsSuccessful,
            recordsFailed,
            executionTime: new Date()
        });
        
        console.log(`✅ [MANUAL] Job '${jobName}' completed successfully`);
        
    } catch (error) {
        console.error(`❌ [MANUAL] Job '${jobName}' failed:`, error);
        
        await historyRecord.markCompleted('failed', error.message, error.stack, {
            recordsProcessed,
            recordsSuccessful,
            recordsFailed,
            executionTime: new Date()
        });
    }
}

module.exports = router;
