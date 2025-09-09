const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Loan = require('../models/Loan');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const { 
  processGoldReturnReminders, 
  getGoldReturnStats, 
  sendManualReminder 
} = require('../scripts/goldReturnManager');

// @route   GET /api/gold-returns/pending
// @desc    Get all pending gold returns
// @access  Admin
router.get('/pending', [auth, adminAuth], async (req, res) => {
  try {
    const pendingReturns = await Loan.find({
      status: 'closed',
      goldReturnStatus: { $in: ['pending', 'scheduled', 'overdue'] }
    }).sort({ closedDate: 1 });

    const formattedReturns = pendingReturns.map(loan => loan.getGoldReturnSummary());

    res.json({
      success: true,
      data: formattedReturns,
      count: formattedReturns.length
    });
  } catch (error) {
    console.error('Error fetching pending gold returns:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/gold-returns/stats
// @desc    Get gold return statistics
// @access  Admin
router.get('/stats', [auth, adminAuth], async (req, res) => {
  try {
    const stats = await getGoldReturnStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching gold return stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/:loanId/schedule
// @desc    Schedule gold return for a specific loan
// @access  Admin
router.post('/:loanId/schedule', [auth, adminAuth, [
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date is required'),
  body('notes').optional().isString().withMessage('Notes must be a string')
]], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { scheduledDate, notes } = req.body;
    const loan = await Loan.findOne({ loanId: req.params.loanId });

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'closed') {
      return res.status(400).json({ message: 'Gold return can only be scheduled for closed loans' });
    }

    await loan.scheduleGoldReturn(new Date(scheduledDate), notes);

    res.json({
      success: true,
      message: 'Gold return scheduled successfully',
      data: loan.getGoldReturnSummary()
    });
  } catch (error) {
    console.error('Error scheduling gold return:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/:loanId/mark-returned
// @desc    Mark gold as returned for a specific loan
// @access  Admin
router.post('/:loanId/mark-returned', [auth, adminAuth, [
  body('notes').optional().isString().withMessage('Notes must be a string')
]], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { notes } = req.body;
    const loan = await Loan.findOne({ loanId: req.params.loanId });

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'closed') {
      return res.status(400).json({ message: 'Gold return can only be marked for closed loans' });
    }

    const returnedBy = {
      id: req.user._id?.toString() || req.user.id,
      name: req.user.name || 'Admin'
    };

    await loan.markGoldReturned(returnedBy, notes);

    res.json({
      success: true,
      message: 'Gold marked as returned successfully',
      data: loan.getGoldReturnSummary()
    });
  } catch (error) {
    console.error('Error marking gold as returned:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/:loanId/send-reminder
// @desc    Send manual reminder for gold return
// @access  Admin
router.post('/:loanId/send-reminder', [auth, adminAuth, [
  body('reminderType').optional().isIn(['initial', 'followup', 'urgent', 'final']).withMessage('Invalid reminder type')
]], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { reminderType = 'urgent' } = req.body;
    const loan = await Loan.findOne({ loanId: req.params.loanId });

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'closed') {
      return res.status(400).json({ message: 'Reminders can only be sent for closed loans' });
    }

    const reminderSent = await sendManualReminder(loan.loanId, reminderType);

    if (reminderSent) {
      res.json({
        success: true,
        message: `${reminderType} reminder sent successfully`
      });
    } else {
      res.status(500).json({ message: 'Failed to send reminder' });
    }
  } catch (error) {
    console.error('Error sending gold return reminder:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/process-reminders
// @desc    Process all gold return reminders (admin trigger)
// @access  Admin
router.post('/process-reminders', [auth, adminAuth], async (req, res) => {
  try {
    await processGoldReturnReminders();
    
    res.json({
      success: true,
      message: 'Gold return reminders processed successfully'
    });
  } catch (error) {
    console.error('Error processing gold return reminders:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/gold-returns/:loanId
// @desc    Get gold return details for a specific loan
// @access  Admin
router.get('/:loanId', [auth, adminAuth], async (req, res) => {
  try {
    const loan = await Loan.findOne({ loanId: req.params.loanId });

    if (!loan) {
      return res.status(404).json({ message: 'Loan not found' });
    }

    if (loan.status !== 'closed') {
      return res.status(400).json({ message: 'Gold return details only available for closed loans' });
    }

    // Get the summary with error handling
    let summary;
    try {
      summary = loan.getGoldReturnSummary();
    } catch (summaryError) {
      console.error('Error generating gold return summary:', summaryError);
      return res.status(500).json({ 
        message: 'Error generating loan summary',
        error: summaryError.message 
      });
    }

    res.json({
      success: true,
      data: {
        ...summary,
        reminders: loan.goldReturnReminders || [],
        notes: loan.goldReturnNotes
      }
    });
  } catch (error) {
    console.error('Error fetching gold return details:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: error.message 
    });
  }
});

// @route   POST /api/gold-returns/fix-existing
// @desc    Fix gold return status for existing closed loans
// @access  Admin
router.post('/fix-existing', [auth, adminAuth], async (req, res) => {
  try {
    const closedLoans = await Loan.find({
      status: 'closed',
      $or: [
        { goldReturnStatus: { $exists: false } },
        { goldReturnStatus: null }
      ]
    });

    let fixedCount = 0;
    for (const loan of closedLoans) {
      await loan.initializeGoldReturnStatus();
      fixedCount++;
    }

    res.json({
      success: true,
      message: `Fixed gold return status for ${fixedCount} closed loans`,
      fixedCount
    });
  } catch (error) {
    console.error('Error fixing existing gold returns:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/add-test-gold
// @desc    Add test gold items to a closed loan for testing
// @access  Admin
router.post('/add-test-gold', [auth, adminAuth], async (req, res) => {
  try {
    const closedLoan = await Loan.findOne({ status: 'closed' });
    
    if (!closedLoan) {
      return res.status(404).json({ message: 'No closed loans found' });
    }

    // Add test gold items
    closedLoan.goldItems = [
      {
        description: 'Gold Chain',
        grossWeight: 25.5,
        netWeight: 24.8
      },
      {
        description: 'Gold Ring',
        grossWeight: 8.2,
        netWeight: 7.9
      }
    ];

    // Set status to pending
    closedLoan.goldReturnStatus = 'pending';
    closedLoan.goldReturnDate = null;
    closedLoan.goldReturnedBy = null;
    closedLoan.goldReturnScheduledDate = null;
    closedLoan.goldReturnNotes = '';

    await closedLoan.save();

    res.json({
      success: true,
      message: 'Test gold items added successfully',
      loanId: closedLoan.loanId,
      customerName: closedLoan.name
    });
  } catch (error) {
    console.error('Error adding test gold items:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/reset-to-actual
// @desc    Reset gold returns to use actual loan data instead of test data
// @access  Admin
router.post('/reset-to-actual', [auth, adminAuth], async (req, res) => {
  try {
    const closedLoans = await Loan.find({ status: 'closed' });
    
    if (closedLoans.length === 0) {
      return res.status(404).json({ message: 'No closed loans found' });
    }

    let processedCount = 0;
    let pendingCount = 0;

    for (const loan of closedLoans) {
      // Check if loan has actual gold items
      const hasActualGoldItems = loan.goldItems && loan.goldItems.length > 0;
      const totalGoldWeight = hasActualGoldItems ? 
        loan.goldItems.reduce((total, item) => total + (item.netWeight || 0), 0) : 0;

      if (hasActualGoldItems && totalGoldWeight > 0) {
        // Set status to pending for loans with gold items
        loan.goldReturnStatus = 'pending';
        loan.goldReturnDate = null;
        loan.goldReturnedBy = null;
        loan.goldReturnScheduledDate = null;
        loan.goldReturnNotes = '';
        pendingCount++;
      } else {
        // Set status to returned for loans without gold items
        loan.goldReturnStatus = 'returned';
        loan.goldReturnDate = new Date();
        loan.goldReturnedBy = {
          id: 'system',
          name: 'System (No Gold Items)'
        };
        loan.goldReturnScheduledDate = null;
        loan.goldReturnNotes = 'No gold items to return';
      }

      await loan.save();
      processedCount++;
    }

    res.json({
      success: true,
      message: `Reset ${processedCount} loans. ${pendingCount} loans with gold items set to pending.`,
      processedCount,
      pendingCount
    });
  } catch (error) {
    console.error('Error resetting to actual data:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/gold-returns/fix-closed-dates
// @desc    Fix missing closedDate for existing closed loans
// @access  Admin
router.post('/fix-closed-dates', [auth, adminAuth], async (req, res) => {
  try {
    const closedLoansWithoutDate = await Loan.find({
      status: 'closed',
      $or: [
        { closedDate: { $exists: false } },
        { closedDate: null }
      ]
    });

    if (closedLoansWithoutDate.length === 0) {
      return res.json({
        success: true,
        message: 'All closed loans already have closedDate set',
        fixedCount: 0
      });
    }

    let fixedCount = 0;

    for (const loan of closedLoansWithoutDate) {
      // Set closedDate to the last payment date or createdAt if no payments
      let closedDate;
      if (loan.payments && loan.payments.length > 0) {
        // Find the latest payment date
        const latestPayment = loan.payments.reduce((latest, payment) => {
          return payment.date > latest.date ? payment : latest;
        });
        closedDate = latestPayment.date;
      } else {
        // Use createdAt as fallback
        closedDate = loan.createdAt;
      }

      loan.closedDate = closedDate;
      await loan.save();
      fixedCount++;
    }

    res.json({
      success: true,
      message: `Fixed closedDate for ${fixedCount} loans`,
      fixedCount
    });
  } catch (error) {
    console.error('Error fixing closed dates:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
