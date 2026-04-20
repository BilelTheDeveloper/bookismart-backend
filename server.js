import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import connectDB from './config/db.js';

// Middlewares & Routes
import { fingerprinter } from './middleware/fingerprint.js';
import authRoutes from './routes/authRoutes.js';

// Load environment variables
dotenv.config();

const app = express();

/**
 * 1. DATABASE CONNECTION
 */
connectDB();

/**
 * 2. SECURITY & UTILITY MIDDLEWARES
 */
// CORS Configuration for Production (Render) and Development
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173", // Your Vite Frontend
  credentials: true, // Required for HttpOnly Cookies
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-fingerprint']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Extracts tokens from HttpOnly Cookies

// Apply Device Fingerprinting to all incoming requests (Security Hub)
app.use(fingerprinter);

/**
 * 3. ROUTE DEFINITIONS
 */

// Auth & Onboarding Routes
app.use('/api/auth', authRoutes);

// Basic Health Check
app.get('/', (req, res) => {
    res.send('Bookiify API is Live & Secured with Dual-Token Rotation 🛡️');
});

/**
 * 4. ERROR HANDLING (Global)
 */
app.use((err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? null : err.stack,
  });
});

/**
 * 5. SERVER START
 */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔒 Security Hub: Fingerprinting & JWT Rotation Active`);
});