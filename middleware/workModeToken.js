import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * Work Mode invite token verifier.
 * This is NOT a role; it's a capability token with expiry + owner rotation nonce.
 */
export const verifyWorkModeInvite = async (token) => {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
    if (decoded?.typ !== 'workmode_invite') return null;
    if (!decoded?.ownerId) return null;
    if (typeof decoded?.nonce !== 'number') return null;

    const owner = await User.findById(decoded.ownerId).select('_id workModeInviteNonce role accountStatus');
    if (!owner) return null;
    if (owner.role !== 'owner') return null;
    if (owner.accountStatus !== 'active') return null;
    if (Number(owner.workModeInviteNonce || 0) !== Number(decoded.nonce)) return null;

    return { ownerId: owner._id, nonce: owner.workModeInviteNonce };
  } catch {
    return null;
  }
};

export const workModeInviteGuard = async (req, res, next) => {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
  const token = bearer || req.query.token || req.body?.token;
  const verified = await verifyWorkModeInvite(token);
  if (!verified) {
    return res.status(401).json({ success: false, message: 'Invalid or expired work mode link.' });
  }
  req.workMode = verified;
  next();
};

