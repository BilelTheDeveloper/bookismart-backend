import 'dotenv/config';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';

// ── Startup env validation (fail fast before anything connects) ──
const REQUIRED_ENV = [
  'JWT_ACCESS_SECRET', 'MONGO_URI', 'REDIS_URL',
  'BREVO_SMTP_USER', 'BREVO_SMTP_KEY', 'CLIENT_URL',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import https from 'https';
import http from 'http';
import jwt from 'jsonwebtoken';
import connectDB from './config/db.js';
import crypto from 'crypto';

// 🚀 REDIS SECURITY ENGINE
import './config/redis.js';

// Middlewares & Routes
import { fingerprinter } from './middleware/fingerprint.js';
import { csrfProtection } from './middleware/csrfProtection.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import websiteRoutes from './routes/websiteroutes.js';
import publicRoutes from './routes/publicRoutes.js';
import calendarRoutes from './routes/calendarRoutes.js';

// 📅 BOOKING ROUTES — single import, both routers
import { publicBookingRouter, ownerBookingRouter } from './routes/bookingRoutes.js';
import { ownerConsultationRouter, customerConsultationRouter } from './routes/consultationRoutes.js';
import merchantInsightsRoutes from './routes/merchantInsightsRoutes.js';
import aiAssistantRoutes from './routes/aiAssistantRoutes.js';
import workModeRoutes from './routes/workModeRoutes.js';
import financeRoutes from './routes/financeRoutes.js';
import invoiceRoutes from './routes/invoiceRoutes.js';
import loyaltyRoutes from './routes/loyaltyRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import {
  publicCustomerRouter,
  portalCustomerRouter,
  ownerCustomerRouter,
  adminCustomerRouter,
} from './routes/customerRoutes.js';
import {
  publicRecruitmentRouter,
  ownerRecruitmentRouter,
  adminRecruitmentRouter,
} from './routes/recruitmentRoutes.js';
import {
  publicStaffRouter,
  portalStaffRouter,
  ownerStaffRouter,
  adminStaffRouter,
} from './routes/staffRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import searchRoutes       from './routes/searchRoutes.js';
import customerNoteRoutes from './routes/customerNoteRoutes.js';
import chatRoutes         from './routes/chatRoutes.js';
import paymentRoutes      from './routes/paymentRoutes.js';
import kycRoutes          from './routes/kycRoutes.js';
import branchRoutes       from './routes/branchRoutes.js';
import packageRoutes      from './routes/packageRoutes.js';
import noShowRoutes       from './routes/noShowRoutes.js';
import marketingRoutes    from './routes/marketingRoutes.js';

import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { logSecurityEvent } from './utils/securityEventLogger.js';
import { startReminderScheduler } from './utils/reminderScheduler.js';

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
const corsOptions = {
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
    'x-csrf-token',
    'Accept'
  ]
};

// Answer ALL preflight requests immediately — before CSRF, fingerprint,
// rate-limit, or any other middleware can reject them.
app.options(/(.*)/, cors(corsOptions));

app.use(compression({ level: 6, threshold: 1024 }));

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", "data:", "https://res.cloudinary.com"],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permissionsPolicy: {
    features: {
      geolocation: [],
      microphone:  [],
      camera:      [],
      payment:     [],
      usb:         [],
    },
  },
}));

// Defense-in-depth: strip MongoDB operators from body/params.
// express-mongo-sanitize tries to overwrite req.query which is a read-only
// getter in Express 5 — bypass the middleware and call sanitize() directly.
app.use((req, res, next) => {
  if (req.body)   req.body   = mongoSanitize.sanitize(req.body,   { replaceWith: '_' });
  if (req.params) req.params = mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  next();
});

// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

app.use(cors(corsOptions));

// Attach a unique request ID to every request for log correlation
app.use((req, res, next) => {
  req.id = crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Stripe webhook — raw body BEFORE express.json()
app.use('/api/payments', paymentRoutes);

// No-cache for every API response — prevents sensitive data leaking via CDN/proxy caches
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  next();
});

// 🛡️ DATA PARSING — 200kb max for JSON; file uploads go through multer (multipart)
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

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
app.use('/api/public/calendar', calendarRoutes);

// Auth & Admin
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Merchant Management
app.use('/api/merchant/website', websiteRoutes);
app.use('/api/merchant/bookings', ownerBookingRouter); // Owner dashboard management (auth required)
app.use('/api/merchant/consultations', ownerConsultationRouter);
app.use('/api/merchant/insights', merchantInsightsRoutes);
app.use('/api/merchant/smart-assistant', aiAssistantRoutes);
app.use('/api/merchant/finance', financeRoutes);
app.use('/api/merchant/invoices', invoiceRoutes);
app.use('/api/merchant/loyalty', loyaltyRoutes);
app.use('/api/merchant/settings', settingsRoutes);
app.use('/api/merchant/branches', branchRoutes);
app.use('/api/merchant/packages', packageRoutes);
app.use('/api/merchant/no-show',  noShowRoutes);
app.use('/api/merchant/marketing', marketingRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/work-mode', workModeRoutes);

// Customer Portal
app.use('/api/customer',           publicCustomerRouter);
app.use('/api/customer',           portalCustomerRouter);
app.use('/api/merchant/customers', ownerCustomerRouter);
app.use('/api/admin/customers',    adminCustomerRouter);

// Recruitment
app.use('/api/public/recruitment',    publicRecruitmentRouter);
app.use('/api/merchant/recruitment',  ownerRecruitmentRouter);
app.use('/api/admin/recruitment',     adminRecruitmentRouter);

// Staff, Notifications, Chat
app.use('/api/staff',                   publicStaffRouter);
app.use('/api/staff/portal',           portalStaffRouter);
app.use('/api/merchant/staff',         ownerStaffRouter);
app.use('/api/admin/staff',            adminStaffRouter);
app.use('/api/merchant/notifications', notificationRoutes);
app.use('/api/merchant/chat',          chatRoutes);
app.use('/api/merchant/search',        searchRoutes);
app.use('/api/merchant/notes',         customerNoteRoutes);
app.use('/api/customer/consultation',  customerConsultationRouter);

// RFC 9116 security disclosure endpoint
app.get('/.well-known/security.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(new URL('.well-known/security.txt', import.meta.url).pathname);
});

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
  console.error(`[SERVER_ERROR] ${err.name}: ${err.message}`);
  logSecurityEvent({ level: 'ERROR', msg: err.message, code: 'UNHANDLED_ERROR', req });
  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
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

// ── Socket.IO authentication middleware ──
io.use((socket, next) => {
  // Work mode sockets bypass JWT auth (capability-token flow)
  const workModeToken = socket.handshake?.auth?.workModeToken;
  if (typeof workModeToken === 'string' && workModeToken.length > 10) {
    socket.data.workModeOnly = true;
    return next();
  }

  // All other sockets must provide a valid JWT access token
  const token = socket.handshake?.auth?.token
    || socket.handshake?.headers?.cookie
        ?.split(';')
        .find(c => c.trim().startsWith('accessToken='))
        ?.split('=')[1];

  if (!token) return next(new Error('AUTH_REQUIRED'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'bookiify-api',
      audience: 'bookiify-app',
    });
    socket.data.userId = decoded.id;
    socket.data.role   = decoded.role;
    next();
  } catch {
    next(new Error('AUTH_INVALID'));
  }
});

io.on('connection', (socket) => {
  socket.data.workMode = null;

  // Work mode token resolution (after connection, non-blocking)
  const workModeToken = socket.handshake?.auth?.workModeToken;
  if (socket.data.workModeOnly && typeof workModeToken === 'string') {
    import('./middleware/workModeToken.js')
      .then(({ verifyWorkModeInvite }) => verifyWorkModeInvite(workModeToken))
      .then((verified) => { if (verified) socket.data.workMode = verified; })
      .catch(() => {});
  }

  socket.on('join', ({ room }) => {
    if (typeof room === 'string' && room.length < 200) socket.join(room);
  });
  socket.on('leave', ({ room }) => {
    if (typeof room === 'string' && room.length < 200) socket.leave(room);
  });

  // Personal notification room — only allow joining your own userId room
  socket.on('user:join', ({ userId }) => {
    if (typeof userId === 'string' && userId === socket.data.userId) {
      socket.join(`user:${userId}`);
    }
  });

  // Chat room join / leave — only authenticated users
  socket.on('chat:join', ({ roomId }) => {
    if (typeof roomId === 'string' && socket.data.userId) socket.join(`chat:${roomId}`);
  });
  socket.on('chat:leave', ({ roomId }) => {
    if (typeof roomId === 'string') socket.leave(`chat:${roomId}`);
  });

  // Typing indicator relay
  socket.on('chat:typing', ({ roomId, senderName, isTyping }) => {
    if (typeof roomId === 'string' && socket.data.userId) {
      socket.to(`chat:${roomId}`).emit('chat:typing', { senderName, isTyping });
    }
  });

  // Worker can send messages via socket without custom headers (avoids CORS preflight).
  socket.on('workmode:message', async ({ consultationId, text }) => {
    try {
      if (!socket.data.workMode?.ownerId) return;
      if (!consultationId || typeof consultationId !== 'string') return;
      if (!text || typeof text !== 'string' || !text.trim() || text.length > 5000) return;

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
  startReminderScheduler();
});

/**
 * 6. KEEP-ALIVE PINGER
 */
function startKeepAlive() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('⏸️  Keep-alive disabled (development mode)');
    return;
  }

  const SELF_URL = process.env.RENDER_EXTERNAL_URL || `https://bookismart-backend-kcnn.onrender.com`;
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