import 'dotenv/config'; // 🚨 MUST BE FIRST: Loads .env variables
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import connectDB from './config/db.js';

// 🚀 REDIS SECURITY ENGINE
import './config/redis.js'; // Initialize Redis connection early

// Middlewares & Routes
import { fingerprinter } from './middleware/fingerprint.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import websiteRoutes from './routes/websiteroutes.js'; 
import publicRoutes from './routes/publicRoutes.js'; 

/**
 * 1. DATABASE CONNECTION
 */
connectDB();

const app = express();

/**
 * 🛡️ RENDER PROXY TRUST
 * Vital for Render's architecture to handle IP-based rate limiting.
 */
app.set('trust proxy', 1);

/**
 * 2. POWER SECURITY HARDENING & CORS
 */

// 🛡️ HELMET: Sets secure HTTP headers (HSTS, CSP, etc.)
app.use(helmet());

// 🛡️ CORS: THE TRIPLE-LOCK CONFIGURATION
app.use(cors({
  origin: [
    "https://bookiify.vercel.app", 
    "http://localhost:5173",
    process.env.CLIENT_URL 
  ].filter(Boolean), 
  credentials: true, // Allows HttpOnly cookies to pass through
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-device-fingerprint', // 🛡️ Explicitly allowed for our identity engine
    'Accept'
  ]
}));

// 🛡️ DATA PARSING (Foundation for all identity checks)
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); // 🚨 Required BEFORE fingerprinter

/**
 * 🛡️ THE FINGERPRINT GATE
 * Locks the identity using the UUID/Hardware combo before any other logic.
 */
app.use(fingerprinter);

/**
 * 🛡️ NO-SQL INJECTION PROTECTION (Enterprise Fix)
 * Added replaceWith to prevent the "Cannot set property query of #<IncomingMessage>" 500 error.
 */
app.use(mongoSanitize({
  replaceWith: '_',
  allowDots: true,
}));

// 🛡️ GLOBAL RATE LIMITING
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

/**
 * 3. ROUTE DEFINITIONS
 */
app.use('/api/public', publicRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant/website', websiteRoutes); 

// Global Status Check (Vitals)
app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Enterprise-Grade / Redis + Fingerprinting v2.1",
    timestamp: new Date().toISOString()
  });
});

/**
 * 4. ERROR HANDLING (Global)
 */
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  console.error(`[SERVER_ERROR]: ${err.message}`);
  
  res.status(statusCode).json({
    success: false,
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? "🛡️ Protected" : err.stack,
  });
});

/**
 * 5. SERVER START
 */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 System Online: Port ${PORT}`);
  console.log(`🔒 Security: Enterprise Redis Blacklist Active`);
  console.log(`📡 Identity: Device Fingerprinting Gateway Live`);
});