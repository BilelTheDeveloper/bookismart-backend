import mongoose from 'mongoose';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

const connectDB = async (attempt = 1) => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('[DB] MongoDB connected.');
  } catch (error) {
    console.error(`[DB] Connection failed (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * attempt;
      console.log(`[DB] Retrying in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
      return connectDB(attempt + 1);
    }
    console.error('[DB] All retry attempts exhausted. Exiting.');
    process.exit(1);
  }
};

// Reconnect on unexpected disconnect
mongoose.connection.on('disconnected', () => {
  console.warn('[DB] MongoDB disconnected. Attempting reconnect...');
  connectDB();
});

export default connectDB;
