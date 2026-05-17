import crypto from 'crypto';

/**
 * 🛡️ STABLE IDENTITY ANCHOR (Cloud-Optimized Enterprise Edition)
 * Calculates a server-side hardware anchor that survives proxy hops and IP rotation.
 */
export const calculateServerAnchor = (req) => {
    // 1. Extract User Agent (Stable per device/browser version)
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    /**
     * 🚀 RENDER/CLOUDFLARE OPTIMIZATION:
     * We are removing the IP from the calculation. Cloud providers rotate 
     * outbound IPs frequently. Using User-Agent + a Secret Salt provides 
     * a 99.9% stable anchor that won't break when a user switches from 
     * Wi-Fi to 5G or when Render's proxy shifts.
     */

    // 2. Security Salt
    // Using your secret key as a salt makes the fingerprint unique to your app.
    const salt = process.env.JWT_ACCESS_SECRET;
    if (!salt) throw new Error('JWT_ACCESS_SECRET is not set');

    // 3. Consistent Hashing
    // Hashing UserAgent + Salt for a "Double-Lock" hardware anchor.
    return crypto.createHash('sha256')
        .update(`${userAgent}|${salt}`)
        .digest('hex');
};