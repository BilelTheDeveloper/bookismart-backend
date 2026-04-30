import SecurityEvent from '../models/SecurityEvent.js';

const safeString = (v, max = 200) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

export const logSecurityEvent = async ({
  level = 'SECURITY',
  msg,
  code = '',
  req = null,
  userId = null,
  meta = {},
} = {}) => {
  try {
    if (!msg) return;
    const ip =
      req?.headers?.['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
      req?.socket?.remoteAddress ||
      '';

    await SecurityEvent.create({
      level,
      msg: safeString(msg, 400),
      code: safeString(code, 80),
      userId: userId || req?.user?._id || null,
      ip: safeString(ip, 80),
      path: safeString(req?.originalUrl || req?.url || '', 180),
      method: safeString(req?.method || '', 12),
      meta,
    });
  } catch {
    // best-effort logging
  }
};

