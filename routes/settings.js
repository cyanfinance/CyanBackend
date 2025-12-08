const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const Settings = require('../models/Settings');

// @route   GET /settings/gold-rate
// @desc    Get current gold rate
// @access  Public
router.get('/gold-rate', async (req, res) => {
  try {
    // First try to find existing Settings document
    let settings = await Settings.findOne();
    
    // If no Settings document exists, create one with default value
    if (!settings) {
      console.log('No Settings document found, creating default Settings...');
      settings = await Settings.create({
        goldRate: 7000,
        lastUpdated: new Date()
      });
      console.log('✅ Created default Settings document with gold rate: ₹7000');
    }
    
    res.json({ 
      rate: settings.goldRate || 7000,
      lastUpdated: settings.lastUpdated || new Date()
    });
  } catch (error) {
    console.error('Error fetching gold rate:', error);
    // Return default value if there's an error
    res.json({ 
      rate: 7000,
      lastUpdated: new Date()
    });
  }
});

// @route   POST /settings/update-gold-rate
// @desc    Update gold rate
// @access  Admin only
router.post('/update-gold-rate', auth, adminAuth, async (req, res) => {
  try {
    const { rate } = req.body;
    
    if (!rate || rate <= 0) {
      return res.status(400).json({ message: 'Invalid gold rate' });
    }

    // Use findOneAndUpdate with upsert to ensure Settings document always exists
    const settings = await Settings.findOneAndUpdate(
      {}, // Empty filter to find any document
      { 
        goldRate: rate,
        lastUpdated: new Date()
      },
      { 
        upsert: true, // Create if doesn't exist
        new: true, // Return the updated document
        setDefaultsOnInsert: true // Apply defaults when creating
      }
    );

    console.log(`Gold rate updated to ₹${rate} per gram at ${settings.lastUpdated}`);
    res.json({ 
      message: 'Gold rate updated successfully', 
      rate: settings.goldRate,
      lastUpdated: settings.lastUpdated
    });
  } catch (error) {
    console.error('Error updating gold rate:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 