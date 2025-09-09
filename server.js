require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const loanRoutes = require('./routes/loans');
const adminRoutes = require('./routes/admin');
const employeeRoutes = require('./routes/employee');
const settingsRoutes = require('./routes/settings');
const contactRoutes = require('./routes/contact');
const notificationRoutes = require('./routes/notifications');
const goldReturnRoutes = require('./routes/goldReturns');

const app = express();

// Middleware
const corsOptions = {
    origin: [
        'https://cyan-frontend.vercel.app',
        'http://localhost:3000',
        'http://localhost:5173'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-auth-token']
};
app.use(cors(corsOptions));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'Server is running' });
});

// Connect to MongoDB
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cyan-finance';
mongoose.connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employee', employeeRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/gold-returns', goldReturnRoutes);

// Monitoring and Health Check Routes
app.use('/api', require('./monitoring/health-check'));
app.use('/api/monitoring', require('./monitoring/monitoring-dashboard').getRouter());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    // Handle different types of errors
    if (err.type === 'entity.parse.failed') {
        // JSON parsing error
        return res.status(400).json({ 
            message: 'Invalid JSON format',
            error: 'Bad Request'
        });
    }
    
    if (err.name === 'ValidationError') {
        // Mongoose validation error
        return res.status(422).json({ 
            message: 'Validation failed',
            errors: err.errors
        });
    }
    
    if (err.name === 'CastError') {
        // Mongoose cast error
        return res.status(400).json({ 
            message: 'Invalid data format',
            error: 'Bad Request'
        });
    }
    
    if (err.code === 11000) {
        // Duplicate key error
        return res.status(409).json({ 
            message: 'Duplicate entry',
            error: 'Conflict'
        });
    }
    
    // Default to 500 for unexpected errors
    res.status(500).json({ 
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!'
    });
});

// Initialize cron jobs for automated tasks
const { initializeCronJobs } = require('./scripts/cronJobs');

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize cron jobs after server starts
    initializeCronJobs();
}); 