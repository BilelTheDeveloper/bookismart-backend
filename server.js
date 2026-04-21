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
import adminRoutes from './routes/adminRoutes.js'; // 🆕 New Admin Module

// Load environment variables
dotenv.config();

/**
 * 1. DATABASE CONNECTION
 */
connectDB();

const app = express();

/**
 * 2. POWER SECURITY HARDENING
 */
// Helmet: Sets various HTTP headers to protect against common attacks (XSS, Clickjacking)
app.use(helmet());

// Mongo Sanitize: Prevents NoSQL Injection by stripping $ and . from user input
app.use(mongoSanitize());

// Rate Limiting: Prevents Brute Force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// CORS Configuration
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173", 
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], // Added PATCH for Admin reviews
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-fingerprint']
}));

app.use(express.json({ limit: '10mb' })); // Limit body size for security
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); 

// Apply Device Fingerprinting (Security Hub)
app.use(fingerprinter);

/**
 * 3. ROUTE DEFINITIONS
 */

// Auth & Onboarding Module
app.use('/api/auth', authRoutes);

// Admin & Verification Module 🆕
app.use('/api/admin', adminRoutes);

// Global Status Check
app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Military-Grade / Dual-Token + Fingerprinting Active",
    version: "2026.1.0"
  });
});

/**
 * 4. ERROR HANDLING (Global)
 */
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  
  // Log internal errors but don't leak stack traces in production
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