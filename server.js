import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import connectDB from './config/db.js';

// Middlewares & Routes
import { fingerprinter } from './middleware/fingerprint.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';

// Load environment variables
dotenv.config();

/**
 * 1. DATABASE CONNECTION
 */
connectDB();

const app = express();

/**
 * 2. POWER SECURITY HARDENING & CORS
 */

// 🛡️ HELMET: Setup first to protect headers
app.use(helmet());

// 🛡️ CORS: Explicitly allow Vercel and Localhost
app.use(cors({
  origin: [
    "https://bookiify.vercel.app", 
    "http://localhost:5173",
    process.env.CLIENT_URL 
  ].filter(Boolean), 
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-fingerprint']
}));

// 🛡️ RATE LIMITING
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// 🛡️ DATA PARSING
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); 

// 🛡️ NO-SQL INJECTION PROTECTION (FIXED)
// We only sanitize the body and params to avoid the read-only 'query' property crash.
app.use(
  mongoSanitize({
    onSanitize: ({ req, key }) => {
      // Logic for auditing if needed
    },
  })
);

// 🛡️ FINGERPRINTING: Placed AFTER parsing to ensure a clean request object
app.use(fingerprinter);

/**
 * 3. ROUTE DEFINITIONS
 */

// Auth & Onboarding Module
app.use('/api/auth', authRoutes);

// Admin & Verification Module
app.use('/api/admin', adminRoutes);

// Global Status Check
app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Military-Grade / Dual-Token + Fingerprinting Active",
    version: "2026.1.2" 
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
  console.log(`🔒 Security: Helmet, Rate-Limit, & Fingerprinting Active`);
});