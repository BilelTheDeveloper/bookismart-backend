import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  let token;

  // 1. Check if token exists in Headers (Bearer token)
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // 2. Verify Token
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

      // 3. Attach User to request (excluding password)
      req.user = await User.findById(decoded.id).select('-password');
      
      // 4. Advanced: Check if the token's fingerprint matches current request
      // (This prevents token theft from one device to another)
      const currentFingerprint = req.headers['x-device-fingerprint']; 
      if (decoded.fingerprint && decoded.fingerprint !== currentFingerprint) {
          return res.status(401).json({ message: "Security Breach: Device Mismatch" });
      }

      next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token expired or invalid' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }
};

// Check if Role is Admin
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Access denied: Requires Admin role' });
  }
};