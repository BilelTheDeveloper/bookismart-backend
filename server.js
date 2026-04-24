import 'dotenv/config'; // 🚨 MUST BE FIRST: Loads .env variables before anything else
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import connectDB from './config/db.js';

// 🚀 REDIS SECURITY ENGINE
import './config/redis.js'; // 🆕 Initialize Redis connection early

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
 * Required for express-rate-limit and secure cookie "Secure" flag 
 * to function correctly behind a proxy like Render.
 */
app.set('trust proxy', 1);

/**
 * 2. POWER SECURITY HARDENING & CORS
 */

// 🛡️ HELMET: Protects HTTP headers
app.use(helmet());

// 🛡️ CORS: THE TRIPLE-LOCK CONFIGURATION
app.use(cors({
  origin: [
    "https://bookiify.vercel.app", 
    "http://localhost:5173",
    process.env.CLIENT_URL 
  ].filter(Boolean), 
  credentials: true, // 🚨 CRITICAL: Allows browser to send/receive HttpOnly cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-device-fingerprint', 
    'Accept'
  ]
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
app.use(cookieParser()); // 🚨 CRITICAL: Allows Express to read req.cookies

/**
 * 🛡️ NO-SQL INJECTION PROTECTION
 */
app.use((req, res, next) => {
  if (req.body) req.body = mongoSanitize.sanitize(req.body);
  if (req.params) req.params = mongoSanitize.sanitize(req.params);
  next();
});

// 🛡️ FINGERPRINTING
app.use(fingerprinter);

/**
 * 3. ROUTE DEFINITIONS
 */
app.use('/api/public', publicRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/merchant/website', websiteRoutes); 

// Global Status Check
app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Enterprise-Grade / Redis + HttpOnly Cookies + Fingerprinting",
    version: "2026.1.5" 
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
});