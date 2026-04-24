import 'dotenv/config'; // 🚨 MUST BE FIRST: Loads .env variables
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
 */
app.set('trust proxy', 1);

/**
 * 2. POWER SECURITY HARDENING & CORS
 */
app.use(helmet());

app.use(cors({
  origin: [
    "https://bookiify.vercel.app", 
    "http://localhost:5173",
    process.env.CLIENT_URL 
  ].filter(Boolean), 
  credentials: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'x-device-fingerprint', 
    'Accept'
  ]
}));

// 🛡️ DATA PARSING
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * 🛡️ CUSTOM ENTERPRISE SANITIZER (Final Fixed Version)
 * Purpose: Manually scrubs $ and . from keys to prevent NoSQL injection.
 * Fix: Properly scopes 'sanitizedKey' to prevent ReferenceErrors during recursion.
 */
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj instanceof Object && !Buffer.isBuffer(obj)) {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          if (key.startsWith('$') || key.includes('.')) {
            const sanitizedKey = key.replace(/\$/g, '_').replace(/\./g, '_');
            obj[sanitizedKey] = obj[key];
            delete obj[key];
            // Recurse into the new key
            if (obj[sanitizedKey] instanceof Object) sanitize(obj[sanitizedKey]);
          } else {
            // Recurse into existing key
            if (obj[key] instanceof Object) sanitize(obj[key]);
          }
        }
      }
    }
  };
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);
  next();
});

// 🛡️ COOKIES & IDENTITY
app.use(cookieParser()); 
app.use(fingerprinter);

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

app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Enterprise-Grade / Redis + Fingerprinting v2.3",
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