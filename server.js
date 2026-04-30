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

// 📅 BOOKING ROUTES — single import, both routers
import { publicBookingRouter, ownerBookingRouter } from './routes/bookingRoutes.js';
import { ownerConsultationRouter } from './routes/consultationRoutes.js';
import merchantInsightsRoutes from './routes/merchantInsightsRoutes.js';
import workModeRoutes from './routes/workModeRoutes.js';

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { logSecurityEvent } from './utils/securityEventLogger.js';

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
    'x-csrf-token',
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
  // Dashboard + realtime apps can generate bursts; keep security but avoid false-positives.
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logSecurityEvent({
      level: 'SECURITY',
      msg: 'Global rate limit exceeded',
      code: 'RATE_LIMIT',
      req,
      meta: { windowMs: 15 * 60 * 1000, max: 600 },
    });
    res.status(429).json({ success: false, message: "Too many requests, please try again later.", code: "RATE_LIMIT" });
  }
});
app.use('/api/', limiter);

/**
 * 3. ROUTE DEFINITIONS
 */
// Public facing routes
app.use('/api/public', publicRoutes);
app.use('/api/public/booking', publicBookingRouter);   // Customer booking flow (no auth)

// Auth & Admin
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Merchant Management
app.use('/api/merchant/website', websiteRoutes);
app.use('/api/merchant/bookings', ownerBookingRouter); // Owner dashboard management (auth required)
app.use('/api/merchant/consultations', ownerConsultationRouter);
app.use('/api/merchant/insights', merchantInsightsRoutes);
app.use('/api/work-mode', workModeRoutes);

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
  console.error(`🚨 [SERVER_ERROR]: ${err.message}`);
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
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: [
      "https://bookiify.vercel.app",
      "http://localhost:5173",
      process.env.CLIENT_URL
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// Allow controllers to emit events without circular imports
app.set('io', io);

io.on('connection', (socket) => {
  // Optional Work Mode capability token (no login flow)
  // The client can pass `auth: { workModeToken }` in io() options.
  socket.data.workMode = null;
  const token = socket.handshake?.auth?.workModeToken;
  if (typeof token === 'string' && token.length > 10) {
    // Lazy import to avoid circular deps (middleware uses models)
    import('./middleware/workModeToken.js')
      .then(({ verifyWorkModeInvite }) => verifyWorkModeInvite(token))
      .then((verified) => {
        if (verified) socket.data.workMode = verified;
      })
      .catch(() => {});
  }

  socket.on('join', ({ room }) => {
    if (typeof room === 'string' && room.length < 200) socket.join(room);
  });
  socket.on('leave', ({ room }) => {
    if (typeof room === 'string' && room.length < 200) socket.leave(room);
  });

  // Worker can send messages via socket without custom headers (avoids CORS preflight).
  socket.on('workmode:message', async ({ consultationId, text }) => {
    try {
      if (!socket.data.workMode?.ownerId) return;
      if (!consultationId || typeof consultationId !== 'string') return;
      if (!text || typeof text !== 'string' || !text.trim()) return;

      const { default: Consultation } = await import('./models/Consultation.js');
      const c = await Consultation.findOne({ _id: consultationId, ownerId: socket.data.workMode.ownerId });
      if (!c) return;

      c.messages.push({
        senderRole: 'worker',
        // Worker is capability-based; store ownerId as senderId for now.
        senderId: socket.data.workMode.ownerId,
        text: text.trim(),
      });
      c.lastActivityAt = new Date();
      await c.save();

      io.to(`consultation:${consultationId}`).emit('consultation:message', {
        consultationId: String(c._id),
        message: c.messages[c.messages.length - 1],
      });
    } catch {
      // no-op
    }
  });
});

const server = httpServer.listen(PORT, () => {
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