import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import cookieParser from 'cookie-parser'; 
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';

// --- Import Routes ---
import authRoutes from './routes/auth.js'; 
import loginRoutes from './routes/loginRoutes.js';
import adminVerificationRoutes from './routes/admin/userVerification.js';
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
 * ⚡ INFRASTRUCTURE UPGRADES
 */

// A. Trust Proxy: Essential for secure cookies on Render/Vercel
app.set('trust proxy', 1);

// B. Security Headers: Hardening the app
app.use(helmet({
  crossOriginResourcePolicy: false, 
})); 

// C. Cookie Parser: Crucial for Zero-LocalStorage HttpOnly flow
app.use(cookieParser());

/**
 * 🛡️ DYNAMIC CORS CONFIGURATION
 */
const allowedOrigins = [
  "http://localhost:5173",
  "https://bookiify.vercel.app",
  "https://bookify.tn",
  process.env.CLIENT_URL 
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 CORS Blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // ✅ MUST BE TRUE for cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-XSRF-TOKEN'],
  exposedHeaders: ['set-cookie'] // ✅ Helps browsers handle the secure cookie better
};

app.use(cors(corsOptions));


// 2. Body Parsers (With limits to prevent Denial of Service)
app.use(express.json({ limit: '10kb' })); 
app.use(express.urlencoded({ extended: true, limit: '10kb' })); 

// 3. Route Mounting

// Auth & Identity (Identity Check & Login)
app.use('/api/auth', authRoutes);
app.use('/api/auth', loginRoutes);

// Public Features
app.use('/api/public', publicRoutes);

// Admin Operations
app.use('/api/admin/user-verification', adminVerificationRoutes);
app.use('/api/admin/websites', adminWebVerificationRoutes); 

// Merchant/Owner Operations
app.use('/api/merchant/website', merchantWebsiteRoutes); 

// Root Health Check
app.get('/', (req, res) => {
  res.status(200).json({ status: "success", message: "Bookismart Secure API is live 🚀" });
});

// 4. Global Error Handling
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: "Access denied by security policy (CORS)." });
  }

  console.error("🔥 [Global Error]:", err.stack);
  res.status(err.status || 500).json({ 
    success: false,
    error: err.message || "Internal server error." 
  });
});

// 5. Server Initialization
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Secure Session Handshake enabled for: ${allowedOrigins.join(', ')}`);
});