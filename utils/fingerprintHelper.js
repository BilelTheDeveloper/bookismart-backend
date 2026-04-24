import crypto from 'crypto';

export const calculateServerAnchor = (req) => {
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown_ip';
    
    // Consistent hashing: IP then UA with a separator
    return crypto.createHash('sha256')
        .update(`${ip}|${userAgent}`)
        .digest('hex');
};