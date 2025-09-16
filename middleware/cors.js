const cors = require('cors');

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://cyan-frontend.vercel.app',
            'https://cyangold.in',
            'http://localhost:3000',
            'http://localhost:5173'
        ];
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'x-auth-token',
        'Accept',
        'Origin',
        'X-Requested-With'
    ],
    optionsSuccessStatus: 200,
    preflightContinue: false
};

// Custom CORS middleware for better debugging
const customCors = (req, res, next) => {
    const origin = req.headers.origin;
    
    // Set CORS headers
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-auth-token, Accept, Origin, X-Requested-With');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        console.log('Preflight request from:', origin);
        res.status(200).end();
        return;
    }
    
    console.log(`${req.method} ${req.path} - Origin: ${origin}`);
    next();
};

module.exports = {
    corsOptions,
    customCors
};
