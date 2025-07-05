require('dotenv').config();

const express = require('express');
const proxy = require('express-http-proxy');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000 // limit each IP to 1000 requests per windowMs
}));
app.use(express.json());

// A key for signing the JWT. In a real application, this should be stored securely.
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-secret-key';

// Authentication middleware
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (authHeader) {
        const token = authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).send('Access token is missing or invalid.');
        }

        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(401).send('Token expired. Please log in again.');
                }
            }

            // Attach user information to the request, including the userId
            req.user = user;
            // Pass the userId to downstream services in a custom header
            req.headers['X-User-Id'] = user.userId;
            next();
        });
    } else {
        res.status(401).send('Authorization header is missing.');
    }
};

// Public routes that do not require authentication
const publicRoutes = [
    { method: 'GET', path: '/api/auth/discord' },
    { method: 'GET', path: '/api/auth/discord/callback' },
    { method: 'GET', path: '/api/products' }
];

// Middleware to conditionally apply JWT authentication
app.use((req, res, next) => {
    const isPublic = publicRoutes.some(route => {
        // Check if the request path starts with the route's path
        const pathMatches = req.path.startsWith(route.path);
        // Check if the method matches
        const methodMatches = req.method.toUpperCase() === route.method.toUpperCase();
        return pathMatches && methodMatches;
    });

    if (isPublic) {
        return next();
    }
    // For all other routes, apply authentication
    return authenticateJWT(req, res, next);
});


// Service URLs from environment variables for flexibility
const USER_SERVICE_URL = process.env.USER_SERVICE_URL;
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL;
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL;


// Routing
app.use('/api/auth/discord', proxy(USER_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    }
}));
app.use('/api/auth/discord/callback', proxy(USER_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    }
}));
app.use('/api/users', proxy(USER_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    },
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        if (srcReq.user) {
            proxyReqOpts.headers['X-User-Id'] = srcReq.user.userId;
        }
        return proxyReqOpts;
    }
}));
app.use('/api/products', proxy(PRODUCT_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    }
}));
app.use('/api/orders', proxy(ORDER_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    },
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        if (srcReq.user) {
            proxyReqOpts.headers['X-User-Id'] = srcReq.user.userId;
        }
        return proxyReqOpts;
    }
}));
app.use('/api/cart', proxy(ORDER_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    },
    proxyReqOptDecorator: function(proxyReqOpts, srcReq) {
        if (srcReq.user) {
            proxyReqOpts.headers['X-User-Id'] = srcReq.user.userId;
        }
        return proxyReqOpts;
    }
}));
app.use('/api/payments', proxy(PAYMENT_SERVICE_URL, {
    proxyReqPathResolver: function (req) {
        return req.originalUrl;
    }
}));


// Generic error handler
app.use((err, req, res, next) => {
    console.error(`[API Gateway Error] ${err.stack}`);
    if (!res.headersSent) {
        res.status(500).send('An internal error occurred in the API Gateway.');
    }
});

// Middleware to format all numbers in JSON responses to two decimal digits
app.use((req, res, next) => {
    const oldJson = res.json;
    res.json = function (data) {
        function formatNumbers(obj) {
            if (Array.isArray(obj)) {
                return obj.map(formatNumbers);
            } else if (obj && typeof obj === 'object') {
                const newObj = {};
                for (const key in obj) {
                    if (typeof obj[key] === 'number') {
                        newObj[key] = Number.isInteger(obj[key]) ? obj[key] : Number(obj[key].toFixed(2));
                    } else {
                        newObj[key] = formatNumbers(obj[key]);
                    }
                }
                return newObj;
            }
            return obj;
        }
        return oldJson.call(this, formatNumbers(data));
    };
    next();
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`API Gateway is running on port ${PORT}`);
});

module.exports = { app, server };
