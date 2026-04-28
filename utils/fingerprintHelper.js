import crypto from 'crypto';

/**
 * 🛡️ ADVANCED IDENTITY ANCHOR (Enterprise Edition)
 * Calculates a stable server-side hardware anchor that survives proxy hops.
 */
export const calculateServerAnchor = (req) => {
    // 1. Extract User Agent
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    // 2. Robust IP Extraction
    // We trim and pick the first IP, ensuring no whitespace or port noise interferes.
    let ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
             req.socket.remoteAddress || 
             'unknown_ip';

    // 🛡️ IPv6 Normalization: Fixes issues where local vs remote addresses 
    // are represented differently (e.g., ::ffff:127.0.0.1)
    if (ip.includes('::ffff:')) {
        ip = ip.split(':').pop();
    }

    // 3. Security Salt
    // Using your secret key as a salt makes the fingerprint unique to your app.
    const salt = process.env.JWT_ACCESS_SECRET || 'fallback_salt_321';

    // 4. Consistent Hashing
    // Hashing IP + UserAgent + Salt for a "Triple-Lock" anchor.
    return crypto.createHash('sha256')
        .update(`${ip}|${userAgent}|${salt}`)
        .digest('hex');
};