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

// --- NEW: Added Domain Specific Routes ---
import adminWebVerificationRoutes from './routes/admin/webVerificationRoutes.js';
import merchantWebsiteRoutes from './routes/merchant/websiteRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
connectDB();

const app = express();

// 4. Security Middleware
app.use(helmet({
  crossOriginResourcePolicy: false, 
})); 

/**
 * 🛡️ DYNAMIC CORS WHITELIST
 * This solves the "Blocked by CORS policy" error by allowing 
 * multiple trusted origins simultaneously.
 */
const allowedOrigins = [
  "http://localhost:5173",          // Local Development
  "https://bookiify.vercel.app",    // Production Frontend
  "https://bookify.tn",             // Future Domain
  process.env.CLIENT_URL            // URL from Render Dashboard
].filter(Boolean); // Clean up any empty values

app.use(cors({ 
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or server-to-server)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`🚫 CORS Blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  // ✅ PATCH is included for status updates
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
})); 

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// 6. Route Mounting

// Auth & Identity
app.use('/api/auth', authRoutes);
app.use('/api/auth', loginRoutes);

// Admin Control Panel (KYC & Web Audit)
app.use('/api/admin/user-verification', adminVerificationRoutes);
app.use('/api/admin/web-verification', adminWebVerificationRoutes); // ✅ Added Web Audit Route

// Merchant Control Panel (Website Builder)
app.use('/api/merchant/website', merchantWebsiteRoutes); // ✅ Added Merchant Website Route

app.get('/', (req, res) => {
  res.send('Bookismart API is running...');
});

// 8. Error Handling
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({ 
    error: err.message || "Something went wrong." 
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Whitelisted: ${allowedOrigins.join(', ')}`);
});