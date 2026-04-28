import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import https from 'https';
import http from 'http';
import connectDB from './config/db.js';

// 🚀 REDIS SECURITY ENGINE
import './config/redis.js';

// Middlewares & Routes
import { fingerprinter } from './middleware/fingerprint.js';
import { csrfProtection } from './middleware/csrfProtection.js';
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
 * Necessary for secure cookies and accurate IP fingerprinting behind a load balancer.
 */
app.set('trust proxy', 1);

/**
 * 2. SECURITY HARDENING & CORS
 */
// 🚨 UPDATE: Configured Helmet to allow Cross-Origin Resource Sharing for cookies
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: [
    "https://bookiify.vercel.app",
    "http://localhost:5173",
    process.env.CLIENT_URL
  ].filter(Boolean),
  credentials: true, // Required for HttpOnly cookies
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
 * 🛡️ CUSTOM ENTERPRISE SANITIZER
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
            if (obj[sanitizedKey] instanceof Object) sanitize(obj[sanitizedKey]);
          } else {
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
app.use(csrfProtection);

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

// Health check endpoint (used by keep-alive pinger)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    status: "online",
    security: "Enterprise-Grade / Redis + Fingerprinting v2.3",
    timestamp: new Date().toISOString()
  });
});

/**
 * 4. ERROR HANDLING
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
const server = app.listen(PORT, () => {
  console.log(`🚀 System Online: Port ${PORT}`);
  console.log(`🔒 Security: Enterprise Redis Blacklist Active`);
  console.log(`📡 Identity: Device Fingerprinting Gateway Live`);

  // Start keep-alive after server is ready
  startKeepAlive();
});

/**
 * 6. KEEP-ALIVE PINGER
 */
function startKeepAlive() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('⏸️  Keep-alive disabled (development mode)');
    return;
  }

  // 🚨 UPDATE: Force HTTPS for the keep-alive ping on production
  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `https://bookismart-backend.onrender.com`;
  const INTERVAL  = 10 * 60 * 1000; // 10 minutes

  const ping = () => {
    const url = `${SELF_URL}/health`;
    const lib = url.startsWith('https') ? https : http;

    const req = lib.get(url, (res) => {
      if (res.statusCode === 200) {
        console.log(`💓 Keep-alive OK [${new Date().toLocaleTimeString()}]`);
      } else {
        console.warn(`⚠️  Keep-alive got status ${res.statusCode}`);
      }
      res.resume(); 
    });

    req.on('error', (err) => {
      console.warn(`⚠️  Keep-alive error: ${err.message}`);
    });

    req.setTimeout(10000, () => {
      req.destroy();
      console.warn('⚠️  Keep-alive timed out');
    });
  };

  setTimeout(() => {
    ping();
    setInterval(ping, INTERVAL);
  }, 60 * 1000);

  console.log(`💓 Keep-alive active → pinging ${SELF_URL}/health every 10 min`);
}

/**
 * 7. UNHANDLED REJECTION GUARD
 */
process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});