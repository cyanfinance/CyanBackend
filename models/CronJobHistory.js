const mongoose = require('mongoose');

const cronJobHistorySchema = new mongoose.Schema({
    jobName: {
        type: String,
        required: true,
        enum: [
            'gold_return_reminders',
            'admin_notifications',
            'interest_rate_upgrades',
            'payment_reminders'
        ]
    },
    executionType: {
        type: String,
        required: true,
        enum: ['scheduled', 'manual'],
        default: 'scheduled'
    },
    executedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false
    },
    status: {
        type: String,
        required: true,
        enum: ['success', 'failed', 'running'],
        default: 'running'
    },
    startTime: {
        type: Date,
        required: true,
        default: Date.now
    },
    endTime: {
        type: Date,
        default: null
    },
    duration: {
        type: Number, // Duration in milliseconds
        default: null
    },
    recordsProcessed: {
        type: Number,
        default: 0
    },
    recordsSuccessful: {
        type: Number,
        default: 0
    },
    recordsFailed: {
        type: Number,
        default: 0
    },
    errorMessage: {
        type: String,
        default: null
    },
    errorStack: {
        type: String,
        default: null
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Index for efficient querying
cronJobHistorySchema.index({ jobName: 1, startTime: -1 });
cronJobHistorySchema.index({ executionType: 1, startTime: -1 });
cronJobHistorySchema.index({ status: 1, startTime: -1 });

// Virtual for duration calculation
cronJobHistorySchema.virtual('durationSeconds').get(function() {
    if (this.duration) {
        return Math.round(this.duration / 1000);
    }
    return null;
});

// Method to mark job as completed
cronJobHistorySchema.methods.markCompleted = function(status, errorMessage = null, errorStack = null, details = {}) {
    this.status = status;
    this.endTime = new Date();
    this.duration = this.endTime - this.startTime;
    
    if (errorMessage) {
        this.errorMessage = errorMessage;
    }
    
    if (errorStack) {
        this.errorStack = errorStack;
    }
    
    if (details) {
        this.details = details;
    }
    
    return this.save();
};

// Method to update progress
cronJobHistorySchema.methods.updateProgress = function(recordsProcessed, recordsSuccessful, recordsFailed, details = {}) {
    this.recordsProcessed = recordsProcessed;
    this.recordsSuccessful = recordsSuccessful;
    this.recordsFailed = recordsFailed;
    
    if (details) {
        this.details = { ...this.details, ...details };
    }
    
    return this.save();
};

// Static method to get job history
cronJobHistorySchema.statics.getJobHistory = function(jobName, limit = 5) {
    const query = jobName ? { jobName } : {};
    return this.find(query)
        .populate('executedBy', 'name email')
        .sort({ startTime: -1 })
        .limit(limit);
};

// Static method to get job statistics
cronJobHistorySchema.statics.getJobStats = function(jobName, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const query = {
        startTime: { $gte: startDate }
    };
    
    if (jobName) {
        query.jobName = jobName;
    }
    
    return this.aggregate([
        { $match: query },
        {
            $group: {
                _id: '$jobName',
                totalExecutions: { $sum: 1 },
                successfulExecutions: {
                    $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
                },
                failedExecutions: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                },
                averageDuration: { $avg: '$duration' },
                totalRecordsProcessed: { $sum: '$recordsProcessed' },
                lastExecution: { $max: '$startTime' }
            }
        },
        { $sort: { lastExecution: -1 } }
    ]);
};

module.exports = mongoose.model('CronJobHistory', cronJobHistorySchema);
