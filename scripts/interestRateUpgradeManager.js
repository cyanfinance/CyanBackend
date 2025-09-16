const Loan = require('../models/Loan');
const Notification = require('../models/Notification');
const { sendBrevoEmail } = require('../utils/brevo');
const { sendSMS } = require('../utils/smsService');

/**
 * Process overdue loans and upgrade interest rates progressively (18% → 24% → 30%)
 * This function checks for loans that:
 * 1. Have 18% interest rate (original)
 * 2. Are overdue (past their current term duration)
 * 3. Are still active (not closed)
 * 4. Can be upgraded to the next level
 */
const processInterestRateUpgrades = async () => {
    console.log('🔄 Starting progressive interest rate upgrade process...');
    
    try {
        const today = new Date();
        
        // Find loans that need first upgrade (18% → 24%)
        // These are loans that were originally 18% for 3 months and are now past their term
        const firstUpgradeLoans = await Loan.find({
            status: 'active',
            originalInterestRate: 18,
            currentUpgradeLevel: 0,
            term: 3, // Only 3-month loans at 18% should be upgraded
            $expr: {
                $gte: [
                    { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
                    90 // 3 months = 90 days
                ]
            }
        }).populate('createdBy', 'name email');

        // Find loans that need second upgrade (24% → 30%)
        const secondUpgradeLoans = await Loan.find({
            status: 'active',
            originalInterestRate: 18,
            currentUpgradeLevel: 1,
            interestRate: 24,
            $expr: {
                $gte: [
                    { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
                    180 // 6 months = 180 days
                ]
            }
        }).populate('createdBy', 'name email');

        const overdueLoans = [...firstUpgradeLoans, ...secondUpgradeLoans];

        console.log(`📊 Found ${overdueLoans.length} loans eligible for interest rate upgrade`);
        console.log(`   - First upgrade candidates (18% → 24%): ${firstUpgradeLoans.length}`);
        console.log(`   - Second upgrade candidates (24% → 30%): ${secondUpgradeLoans.length}`);
        
        // Log details of eligible loans
        if (firstUpgradeLoans.length > 0) {
            console.log('🔍 First upgrade candidates:');
            firstUpgradeLoans.forEach(loan => {
                const daysSinceCreated = Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24));
                console.log(`   - ${loan.loanId}: ${loan.name}, ${daysSinceCreated} days old, ${loan.term} months term`);
            });
        }
        
        if (secondUpgradeLoans.length > 0) {
            console.log('🔍 Second upgrade candidates:');
            secondUpgradeLoans.forEach(loan => {
                const daysSinceCreated = Math.floor((new Date() - loan.createdAt) / (1000 * 60 * 60 * 24));
                console.log(`   - ${loan.loanId}: ${loan.name}, ${daysSinceCreated} days old, ${loan.term} months term`);
            });
        }

        let upgradedCount = 0;
        let errorCount = 0;

        for (const loan of overdueLoans) {
            try {
                console.log(`🔄 Processing loan ${loan.loanId} for ${loan.name}...`);
                
                // Calculate days since loan start
                const loanStartDate = loan.createdAt;
                const daysSinceStart = Math.floor((today - loanStartDate) / (1000 * 60 * 60 * 24));
                
                // Upgrade interest rate (progressive system)
                const upgradeDetails = await loan.upgradeInterestRate('overdue_upgrade');
                
                console.log(`✅ Upgraded loan ${loan.loanId}: ${upgradeDetails.oldRate}% → ${upgradeDetails.newRate}%`);
                console.log(`   Upgrade Level: ${upgradeDetails.upgradeLevel}`);
                console.log(`   Old total: ₹${upgradeDetails.oldTotalPayment.toLocaleString()}`);
                console.log(`   New total: ₹${upgradeDetails.newTotalPayment.toLocaleString()}`);
                console.log(`   New term end: ${upgradeDetails.newTermEndDate.toDateString()}`);
                console.log(`   Days since start: ${daysSinceStart}`);
                console.log(`   Total days from start: ${upgradeDetails.totalDaysFromStart}`);
                
                // Create notification
                await Notification.createInterestRateUpgradeNotification(
                    loan, 
                    upgradeDetails.oldRate, 
                    upgradeDetails.newRate, 
                    upgradeDetails
                );
                
                // Send email notification to customer
                try {
                    const upgradeLevelText = upgradeDetails.upgradeLevel === 1 ? 'First' : 'Second';
                    const nextUpgradeText = upgradeDetails.upgradeLevel === 1 ? 'If not paid within the next 3 months, the interest rate will be upgraded to 30%.' : 'This is the final upgrade level.';
                    
                    await sendBrevoEmail({
                        to: loan.email,
                        subject: `${upgradeLevelText} Interest Rate Upgrade - Cyan Finance`,
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                                <h2 style="color: #1e40af;">${upgradeLevelText} Interest Rate Upgrade Notice</h2>
                                <p>Dear ${loan.name},</p>
                                <p>We are writing to inform you that your loan interest rate has been upgraded due to overdue payment.</p>
                                
                                <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                                    <h3 style="color: #1e40af; margin-top: 0;">Loan Details:</h3>
                                    <p><strong>Loan ID:</strong> ${loan.loanId}</p>
                                    <p><strong>Previous Interest Rate:</strong> ${upgradeDetails.oldRate}%</p>
                                    <p><strong>New Interest Rate:</strong> ${upgradeDetails.newRate}%</p>
                                    <p><strong>Previous Total Amount:</strong> ₹${upgradeDetails.oldTotalPayment.toLocaleString()}</p>
                                    <p><strong>New Total Amount:</strong> ₹${upgradeDetails.newTotalPayment.toLocaleString()}</p>
                                    <p><strong>New Term End Date:</strong> ${upgradeDetails.newTermEndDate.toDateString()}</p>
                                    <p><strong>Months Remaining:</strong> ${upgradeDetails.monthsRemaining}</p>
                                    <p><strong>Days Since Loan Start:</strong> ${daysSinceStart} days</p>
                                </div>
                                
                                <div style="background-color: #e0f2fe; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                    <p style="margin: 0; color: #0277bd;"><strong>Important:</strong> The new interest rate is calculated from your original loan start date (${loanStartDate.toDateString()}) for the entire period until the new term end date.</p>
                                </div>
                                
                                <p>Please contact us immediately to discuss payment options and avoid further penalties.</p>
                                
                                <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                    <p style="margin: 0; color: #92400e;"><strong>Warning:</strong> ${nextUpgradeText}</p>
                                </div>
                                
                                <p>If you have any questions, please contact us at:</p>
                                <ul>
                                    <li>Phone: +91-9700049444</li>
                                    <li>Email: support@cyanfinance.in</li>
                                </ul>
                                
                                <p>Best regards,<br/>Cyan Finance Team</p>
                            </div>
                        `
                    });
                    console.log(`📧 Email notification sent to ${loan.email}`);
                } catch (emailError) {
                    console.error(`❌ Failed to send email to ${loan.email}:`, emailError.message);
                }
                
                // Send SMS notification
                try {
                    const smsMessage = `Dear ${loan.name}, your loan ${loan.loanId} interest rate has been upgraded from ${upgradeDetails.oldRate}% to ${upgradeDetails.newRate}% due to overdue payment. New total: ₹${upgradeDetails.newTotalPayment.toLocaleString()}. Please contact us immediately. - Cyan Finance`;
                    await sendSMS(loan.primaryMobile, smsMessage);
                    console.log(`📱 SMS notification sent to ${loan.primaryMobile}`);
                } catch (smsError) {
                    console.error(`❌ Failed to send SMS to ${loan.primaryMobile}:`, smsError.message);
                }
                
                upgradedCount++;
                
            } catch (error) {
                console.error(`❌ Error processing loan ${loan.loanId}:`, error.message);
                errorCount++;
            }
        }
        
        console.log(`✅ Interest rate upgrade process completed:`);
        console.log(`   📈 Loans upgraded: ${upgradedCount}`);
        console.log(`   ❌ Errors: ${errorCount}`);
        console.log(`   📊 Total processed: ${overdueLoans.length}`);
        
        return {
            success: true,
            totalProcessed: overdueLoans.length,
            upgradedCount,
            errorCount
        };
        
    } catch (error) {
        console.error('❌ Error in interest rate upgrade process:', error);
        return {
            success: false,
            error: error.message
        };
    }
};

/**
 * Get statistics about loans eligible for interest rate upgrade (Progressive System)
 */
const getUpgradeStatistics = async () => {
    try {
        const today = new Date();
        
        // Find loans eligible for first upgrade (18% → 24%)
        const firstUpgradeEligible = await Loan.find({
            status: 'active',
            originalInterestRate: 18,
            currentUpgradeLevel: 0,
            $expr: {
                $gte: [
                    { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
                    90 // 3 months = 90 days
                ]
            }
        });

        // Find loans eligible for second upgrade (24% → 30%)
        const secondUpgradeEligible = await Loan.find({
            status: 'active',
            originalInterestRate: 18,
            currentUpgradeLevel: 1,
            interestRate: 24,
            $expr: {
                $gte: [
                    { $divide: [{ $subtract: [today, '$createdAt'] }, 1000 * 60 * 60 * 24] },
                    180 // 6 months = 180 days
                ]
            }
        });

        const allEligibleLoans = [...firstUpgradeEligible, ...secondUpgradeEligible];
        
        const stats = {
            totalEligible: allEligibleLoans.length,
            firstUpgradeEligible: firstUpgradeEligible.length,
            secondUpgradeEligible: secondUpgradeEligible.length,
            byUpgradeLevel: {
                'level0': firstUpgradeEligible.length, // 18% → 24%
                'level1': secondUpgradeEligible.length  // 24% → 30%
            },
            totalAmount: 0,
            averageDaysSinceStart: 0,
            upgradeHistory: {
                '18to24': 0,
                '24to30': 0
            }
        };
        
        let totalDaysSinceStart = 0;
        
        allEligibleLoans.forEach(loan => {
            // Calculate days since loan start
            const loanStartDate = loan.createdAt;
            const daysSinceStart = Math.floor((today - loanStartDate) / (1000 * 60 * 60 * 24));
            totalDaysSinceStart += daysSinceStart;
            
            stats.totalAmount += loan.amount;
        });
        
        // Get upgrade history statistics
        const upgradeHistoryStats = await Loan.aggregate([
            {
                $match: {
                    status: 'active',
                    originalInterestRate: 18,
                    'upgradeHistory.0': { $exists: true }
                }
            },
            {
                $unwind: '$upgradeHistory'
            },
            {
                $group: {
                    _id: {
                        fromRate: '$upgradeHistory.fromRate',
                        toRate: '$upgradeHistory.toRate'
                    },
                    count: { $sum: 1 }
                }
            }
        ]);
        
        upgradeHistoryStats.forEach(stat => {
            if (stat._id.fromRate === 18 && stat._id.toRate === 24) {
                stats.upgradeHistory['18to24'] = stat.count;
            } else if (stat._id.fromRate === 24 && stat._id.toRate === 30) {
                stats.upgradeHistory['24to30'] = stat.count;
            }
        });
        
        stats.averageDaysSinceStart = allEligibleLoans.length > 0 ? Math.round(totalDaysSinceStart / allEligibleLoans.length) : 0;
        
        return stats;
        
    } catch (error) {
        console.error('Error getting upgrade statistics:', error);
        return null;
    }
};

module.exports = {
    processInterestRateUpgrades,
    getUpgradeStatistics
};

// Run if called directly
if (require.main === module) {
    processInterestRateUpgrades()
        .then(result => {
            console.log('Process completed:', result);
            process.exit(0);
        })
        .catch(error => {
            console.error('Process failed:', error);
            process.exit(1);
        });
}
