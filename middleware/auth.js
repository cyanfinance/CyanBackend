const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Customer = require('../models/Customer');

module.exports = async function(req, res, next) {
    // Get token from header
    let token = req.header('x-auth-token');
    
    // Check Authorization header if x-auth-token is not present
    if (!token) {
        const authHeader = req.header('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
    }

    // Check if no token
    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        // Verify token
        const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';
        const decoded = jwt.verify(token, jwtSecret);

        // Try to find user in User model first
        let user = await User.findById(decoded.id);
        
        // If not found in User model, try Customer model
        if (!user) {
            user = await Customer.findById(decoded.id);
        }
        
        if (!user) {
            return res.status(401).json({ message: 'Token is not valid' });
        }

        // Add user to request object
        req.user = user;
        
        // Add role information if not already present
        if (!req.user.role && decoded.role) {
            req.user.role = decoded.role;
        }

        next();
    } catch (err) {
        console.error('Token verification error:', err);
        res.status(401).json({ message: 'Token is not valid' });
    }
}; 