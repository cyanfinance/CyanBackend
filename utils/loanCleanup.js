const Notification = require('../models/Notification');
const ItemPhoto = require('../models/ItemPhoto');
const Otp = require('../models/Otp');

/**
 * Comprehensive cleanup function for loan-related data
 * @param {ObjectId} loanId - The MongoDB ObjectId of the loan
 * @param {ObjectId} customerId - The MongoDB ObjectId of the customer (optional)
 * @returns {Promise<Object>} - Cleanup results with counts
 */
async function cleanupLoanData(loanId, customerId = null) {
  const results = {
    notifications: 0,
    photos: 0,
    otps: 0,
    errors: []
  };

  try {
    // 1. Delete all notifications related to this loan
    try {
      const notificationResult = await Notification.deleteByLoanId(loanId);
      results.notifications = notificationResult.deletedCount;
      console.log(`✅ Deleted ${results.notifications} notifications for loan ${loanId}`);
    } catch (error) {
      results.errors.push(`Notification cleanup failed: ${error.message}`);
      console.error('❌ Notification cleanup failed:', error);
    }

    // 2. Delete all photos related to this loan
    try {
      const photoResult = await ItemPhoto.deleteByLoanId(loanId);
      results.photos = photoResult.deletedCount;
      console.log(`✅ Deleted ${results.photos} photos for loan ${loanId}`);
    } catch (error) {
      results.errors.push(`Photo cleanup failed: ${error.message}`);
      console.error('❌ Photo cleanup failed:', error);
    }

    // 3. Delete any OTPs related to this customer for loan creation (if customerId provided)
    if (customerId) {
      try {
        const otpResult = await Otp.deleteByCustomerAndPurpose(
          customerId.toString(), 
          'loan_creation'
        );
        results.otps = otpResult.deletedCount;
        console.log(`✅ Deleted ${results.otps} OTPs for customer ${customerId}`);
      } catch (error) {
        results.errors.push(`OTP cleanup failed: ${error.message}`);
        console.error('❌ OTP cleanup failed:', error);
      }
    }

  } catch (error) {
    results.errors.push(`General cleanup error: ${error.message}`);
    console.error('❌ General cleanup error:', error);
  }

  return results;
}

/**
 * Check for orphaned records that should be cleaned up
 * @returns {Promise<Object>} - Report of orphaned records found
 */
async function checkOrphanedRecords() {
  const report = {
    orphanedNotifications: 0,
    orphanedPhotos: 0,
    orphanedOtps: 0,
    totalOrphaned: 0
  };

  try {
    // Check for notifications pointing to non-existent loans
    const orphanedNotifications = await Notification.aggregate([
      {
        $lookup: {
          from: 'loans',
          localField: 'loanId',
          foreignField: '_id',
          as: 'loan'
        }
      },
      {
        $match: {
          loan: { $size: 0 }
        }
      },
      {
        $count: 'count'
      }
    ]);
    report.orphanedNotifications = orphanedNotifications[0]?.count || 0;

    // Check for photos pointing to non-existent loans
    const orphanedPhotos = await ItemPhoto.aggregate([
      {
        $lookup: {
          from: 'loans',
          localField: 'loanId',
          foreignField: '_id',
          as: 'loan'
        }
      },
      {
        $match: {
          loan: { $size: 0 }
        }
      },
      {
        $count: 'count'
      }
    ]);
    report.orphanedPhotos = orphanedPhotos[0]?.count || 0;

    // Check for OTPs pointing to non-existent customers
    const orphanedOtps = await Otp.aggregate([
      {
        $lookup: {
          from: 'customers',
          localField: 'customerId',
          foreignField: '_id',
          as: 'customer'
        }
      },
      {
        $match: {
          customer: { $size: 0 },
          customerId: { $exists: true, $ne: null }
        }
      },
      {
        $count: 'count'
      }
    ]);
    report.orphanedOtps = orphanedOtps[0]?.count || 0;

    report.totalOrphaned = report.orphanedNotifications + report.orphanedPhotos + report.orphanedOtps;

  } catch (error) {
    console.error('Error checking orphaned records:', error);
  }

  return report;
}

/**
 * Clean up orphaned records
 * @returns {Promise<Object>} - Cleanup results
 */
async function cleanupOrphanedRecords() {
  const results = {
    notificationsDeleted: 0,
    photosDeleted: 0,
    otpsDeleted: 0,
    errors: []
  };

  try {
    // Delete orphaned notifications
    try {
      const orphanedNotifications = await Notification.aggregate([
        {
          $lookup: {
            from: 'loans',
            localField: 'loanId',
            foreignField: '_id',
            as: 'loan'
          }
        },
        {
          $match: {
            loan: { $size: 0 }
          }
        },
        {
          $project: { _id: 1 }
        }
      ]);

      if (orphanedNotifications.length > 0) {
        const notificationIds = orphanedNotifications.map(n => n._id);
        const deleteResult = await Notification.deleteMany({ _id: { $in: notificationIds } });
        results.notificationsDeleted = deleteResult.deletedCount;
        console.log(`🧹 Cleaned up ${results.notificationsDeleted} orphaned notifications`);
      }
    } catch (error) {
      results.errors.push(`Orphaned notification cleanup failed: ${error.message}`);
    }

    // Delete orphaned photos
    try {
      const orphanedPhotos = await ItemPhoto.aggregate([
        {
          $lookup: {
            from: 'loans',
            localField: 'loanId',
            foreignField: '_id',
            as: 'loan'
          }
        },
        {
          $match: {
            loan: { $size: 0 }
          }
        },
        {
          $project: { _id: 1 }
        }
      ]);

      if (orphanedPhotos.length > 0) {
        const photoIds = orphanedPhotos.map(p => p._id);
        const deleteResult = await ItemPhoto.deleteMany({ _id: { $in: photoIds } });
        results.photosDeleted = deleteResult.deletedCount;
        console.log(`🧹 Cleaned up ${results.photosDeleted} orphaned photos`);
      }
    } catch (error) {
      results.errors.push(`Orphaned photo cleanup failed: ${error.message}`);
    }

    // Delete orphaned OTPs
    try {
      const orphanedOtps = await Otp.aggregate([
        {
          $lookup: {
            from: 'customers',
            localField: 'customerId',
            foreignField: '_id',
            as: 'customer'
          }
        },
        {
          $match: {
            customer: { $size: 0 },
            customerId: { $exists: true, $ne: null }
          }
        },
        {
          $project: { _id: 1 }
        }
      ]);

      if (orphanedOtps.length > 0) {
        const otpIds = orphanedOtps.map(o => o._id);
        const deleteResult = await Otp.deleteMany({ _id: { $in: otpIds } });
        results.otpsDeleted = deleteResult.deletedCount;
        console.log(`🧹 Cleaned up ${results.otpsDeleted} orphaned OTPs`);
      }
    } catch (error) {
      results.errors.push(`Orphaned OTP cleanup failed: ${error.message}`);
    }

  } catch (error) {
    results.errors.push(`General orphaned cleanup error: ${error.message}`);
    console.error('❌ General orphaned cleanup error:', error);
  }

  return results;
}

module.exports = {
  cleanupLoanData,
  checkOrphanedRecords,
  cleanupOrphanedRecords
};
