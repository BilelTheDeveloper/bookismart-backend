import crypto from 'crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_SKIP_EXACT = new Set([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/send-otp',
  '/api/auth/verify-otp',
  '/api/auth/refresh',
]);

const CSRF_SKIP_PREFIX = ['/api/public/'];

export const generateCsrfToken = () => crypto.randomBytes(32).toString('hex');

export const csrfProtection = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const path = req.path || '';
  if (CSRF_SKIP_EXACT.has(path) || CSRF_SKIP_PREFIX.some((prefix) => path.startsWith(prefix))) {
    return next();
  }

  const cookieToken = req.cookies?.csrfToken;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      success: false,
      message: 'CSRF validation failed: token missing.',
      code: 'CSRF_MISSING',
    });
  }

  try {
    const a = Buffer.from(cookieToken);
    const b = Buffer.from(headerToken);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: 'CSRF validation failed: token mismatch.',
        code: 'CSRF_INVALID',
      });
    }
  } catch {
    return res.status(403).json({
      success: false,
      message: 'CSRF validation failed.',
      code: 'CSRF_INVALID',
    });
  }

  next();
};
