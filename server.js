import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import cookieParser from 'cookie-parser'; // ✅ NEW: Required for HttpOnly cookies
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';

// --- Import Routes ---
import authRoutes from './routes/auth.js'; 
import loginRoutes from './routes/loginRoutes.js';
import adminVerificationRoutes from './routes/admin/userVerification.js';

// --- Domain Specific Routes ---
import adminWebVerificationRoutes from './routes/admin/webVerificationRoutes.js';
import merchantWebsiteRoutes from './routes/merchant/websiteRoutes.js';
import publicRoutes from './routes/publicRoutes.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

/**
 * ⚡ SUPER POWER UPGRADES
 */

// A. Trust Proxy (Essential for Render/Vercel/Cloudflare deployments)
app.set('trust proxy', 1);

// B. Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: false, 
})); 

// ✅ NEW: Cookie Parser Middleware
// This allows the server to read cookies sent by the browser
app.use(cookieParser());

/**
 * 🛡️ DYNAMIC CORS WHITELIST
 */
const allowedOrigins = [
  "http://localhost:5173",           // Local Development
  "https://bookiify.vercel.app",    // Production Frontend (Vercel)
  "https://bookify.tn",             // Production Domain
  process.env.CLIENT_URL             // Optional: URL set in environment
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 CORS Blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // ✅ CRITICAL: Must be true to allow HttpOnly cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  optionsSuccessStatus: 200 
};

// C. Apply CORS and Global Preflight Handler
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions)); 

// 2. Body Parsers
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// 3. Route Mounting

// Auth & Identity
app.use('/api/auth', authRoutes);
app.use('/api/auth', loginRoutes);

/**
 * ✅ PUBLIC ROUTES
 */
app.use('/api/public', publicRoutes);

// Admin Control Panel
app.use('/api/admin/user-verification', adminVerificationRoutes);

/**
 * ✅ ADMIN WEBSITE AUDIT
 */
app.use('/api/admin/websites', adminWebVerificationRoutes); 

// Merchant Control Panel
app.use('/api/merchant/website', merchantWebsiteRoutes); 

// Root Route
app.get('/', (req, res) => {
  res.send('Bookismart API is running with Secure Cookies... 🚀');
});

// 4. Global Error Handling
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: "CORS Policy Restriction" });
  }

  console.error("❌ [Global Error]:", err.stack);
  res.status(err.status || 500).json({ 
    error: err.message || "Something went wrong on the server." 
  });
});

// 5. Server Initialization
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Whitelisted Origins: ${allowedOrigins.join(', ')}`);
});