import express from 'express';
import dotenv from 'dotenv';
import connectDB from './config/db.js'; // Ensure the path and .js extension are correct
import cloudinary from './config/cloudinary.js';

// Load environment variables
dotenv.config();

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());

// Basic Route
app.get('/', (req, res) => {
    res.send('Server is running with ESM imports!');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});