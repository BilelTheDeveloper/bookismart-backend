import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';

// --- Import Routes ---
import authRoutes from './routes/auth.js'; 
import loginRoutes from './routes/loginRoutes.js';
import adminVerificationRoutes from './routes/admin/userVerification.js';

// --- Domain Specific Routes ---
import adminWebVerificationRoutes from './routes/admin/webVerificationRoutes.js';
import merchantWebsiteRoutes from './routes/merchant/websiteRoutes.js';
// ✅ New: Import the Public Routes for the "Bio Link" profiles
import publicRoutes from './routes/publicRoutes.js'; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Connect to MongoDB
connectDB();

const app = express();

// 1. Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: false, 
})); 

/**
 * 🛡️ DYNAMIC CORS WHITELIST
 */
const allowedOrigins = [
  "http://localhost:5173",           // Local Development
  "https://bookiify.vercel.app",    // Production Frontend (Vercel)
  "https://bookify.tn",             // Production Domain
  process.env.CLIENT_URL            // Optional: URL set in Render environment
].filter(Boolean);

app.use(cors({ 
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 CORS Blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})); 

// 2. Body Parsers
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// 3. Route Mounting

// Auth & Identity
app.use('/api/auth', authRoutes);
app.use('/api/auth', loginRoutes);

/**
 * ✅ PUBLIC ROUTES (Bio-Link / Public Profiles)
 * This must stay above restricted routes to ensure easy access.
 */
app.use('/api/public', publicRoutes);

// Admin Control Panel (User Identity / KYC)
app.use('/api/admin/user-verification', adminVerificationRoutes);

/**
 * ✅ ADMIN WEBSITE AUDIT
 */
app.use('/api/admin/websites', adminWebVerificationRoutes); 

// Merchant Control Panel (Website Builder & Settings)
app.use('/api/merchant/website', merchantWebsiteRoutes); 

// Root Route
app.get('/', (req, res) => {
  res.send('Bookismart API is running...');
});

// 4. Global Error Handling
app.use((err, req, res, next) => {
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