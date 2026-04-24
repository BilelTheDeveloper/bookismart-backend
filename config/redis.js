import { createClient } from 'redis';

/**
 * 🛰️ REDIS ENGINE INITIALIZATION
 * This connects your backend to the Upstash "Security Guard".
 * It uses the REDIS_URL from your .env file.
 */
const redis = createClient({
  url: process.env.REDIS_URL
});

// 1. Monitor for errors to prevent your server from crashing if Redis is down
redis.on('error', (err) => console.error('❌ Redis Client Error:', err));

// 2. The connection function
const connectRedis = async () => {
  try {
    await redis.connect();
    console.log('✅ Security Engine: Redis Connected Successfully');
  } catch (err) {
    console.error('⚠️ Redis Connection Failed. Security Blacklist is offline:', err.message);
  }
};

// 3. Start the connection
connectRedis();

// 4. Export the client so your Auth Middleware can use it
export { redis };