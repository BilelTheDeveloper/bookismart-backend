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

// 1. Setup for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 2. Load Environment Variables
dotenv.config();

// 3. Connect to MongoDB (Ultra Secure)
connectDB();

const app = express();

// 4. Security & Parser Middleware
app.use(helmet({
  // Allows Cloudinary images to be loaded and displayed in your Admin/Merchant dashboards
  crossOriginResourcePolicy: false, 
})); 

app.use(cors({ 
  origin: process.env.CLIENT_URL || "http://localhost:5173", 
  credentials: true 
})); 

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 

// 5. Cloudinary Note
// We no longer need app.use('/uploads', express.static...) 
// because all images are now served via Cloudinary URLs.

// 6. Route Mounting
// Both signup steps and login are now unified under /api/auth
app.use('/api/auth', authRoutes);
app.use('/api/auth', loginRoutes);

// Admin Verification Routes
app.use('/api/admin/user-verification', adminVerificationRoutes);

// 7. Basic Test Route
app.get('/', (req, res) => {
  res.send('Bookismart API is running with Cloudinary & Ultra Security...');
});

// 8. Error Handling Middleware (The "Safety Net")
app.use((err, req, res, next) => {
  console.error(`🔥 [Global Error]: ${err.message}`);
  res.status(err.status || 500).json({ 
    error: err.message || "Something went wrong on the server." 
  });
});

// 9. Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  console.log(`📡 Accepting requests from: ${process.env.CLIENT_URL}`);
});