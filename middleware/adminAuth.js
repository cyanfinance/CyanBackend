const auth = require('./auth');

module.exports = [auth, async function(req, res, next) {
    // Debug logging
    console.log('AdminAuth middleware - User:', req.user ? {
        id: req.user._id,
        email: req.user.email,
        role: req.user.role
    } : 'No user found');
    
    // Check if user is admin
    if (req.user && req.user.role === 'admin') {
        console.log('Admin access granted for:', req.user.email);
        next();
    } else {
        console.log('Admin access denied. User role:', req.user?.role || 'No role');
        res.status(403).json({ message: 'Access denied. Admin only.' });
    }
}]; 