import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Customer from '../models/Customer.js';
import { redis } from '../config/redis.js';

export const customerProtect = async (req, res, next) => {
  const token = req.cookies?.customerAccessToken;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — token missing', code: 'TOKEN_MISSING' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token', code: 'TOKEN_INVALID' });
  }

  if (decoded.role !== 'customer') {
    return res.status(403).json({ success: false, message: 'Access denied', code: 'FORBIDDEN' });
  }

  if (!decoded.jti) {
    return res.status(401).json({ success: false, message: 'Invalid token structure', code: 'TOKEN_INVALID' });
  }

  try {
    const revoked = await redis.get(`blacklist:${decoded.jti}`);
    if (revoked) {
      return res.status(401).json({ success: false, message: 'Token has been revoked', code: 'TOKEN_REVOKED' });
    }
  } catch {
    // Redis hiccup — proceed (fail-open for availability)
  }

  let customer;
  try {
    customer = await Customer.findById(decoded.id).select('-password -otpCode -registrationToken -refreshTokens');
  } catch {
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable', code: 'DB_ERROR' });
  }

  if (!customer) {
    return res.status(401).json({ success: false, message: 'Account not found', code: 'USER_NOT_FOUND' });
  }

  if (customer.status !== 'active') {
    return res.status(403).json({ success: false, message: 'Account is not active', code: 'ACCOUNT_INACTIVE' });
  }

  req.customer = customer;
  next();
};

export const issueCustomerTokens = async (customer, res) => {
  const jti = crypto.randomBytes(16).toString('hex');

  const accessToken = jwt.sign(
    { id: customer._id, role: 'customer', jti },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m', algorithm: 'HS256' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshHash  = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  customer.refreshTokens.push({ tokenHash: refreshHash, deviceId: jti, expiresAt });
  // Keep at most 5 active sessions
  if (customer.refreshTokens.length > 5) {
    customer.refreshTokens = customer.refreshTokens.slice(-5);
  }
  customer.lastLogin = new Date();
  await customer.save();

  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  };

  res.cookie('customerAccessToken', accessToken, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
  res.cookie('customerRefreshToken', refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 });

  return { accessToken };
};
