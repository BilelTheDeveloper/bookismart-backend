import ActivityLog from '../models/ActivityLog.js';

const getIp = (req) =>
  req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || 'unknown';

const getUa = (req) =>
  String(req?.headers?.['user-agent'] || '').slice(0, 200);

/**
 * Fire-and-forget activity logger — never throws.
 */
export const logActivity = (userId, action, req, opts = {}) => {
  ActivityLog.create({
    userId,
    action,
    ip:        getIp(req),
    userAgent: getUa(req),
    success:   opts.success !== false,
    meta:      opts.meta || {},
  }).catch(() => {});
};
