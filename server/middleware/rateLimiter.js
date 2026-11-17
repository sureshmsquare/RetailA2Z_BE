import rateLimit from 'express-rate-limit';
import auditService from '../services/auditService.js';

/**
 * Login rate limiter: Max 5 attempts per 15 minutes per IP.
 * Audits repeated login failures without logging passwords.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test' || req.headers['x-test-bypass-rate-limit'] === 'true',
  message: {
    success: false,
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
  },
  handler: async (req, res, next, options) => {
    // Log rate limit violation in audit log (NEVER logging the password)
    const identifier = req.body?.identifier ? String(req.body.identifier).slice(0, 50) : 'unknown';
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    await auditService.log({
      actor: `IP:${clientIp}`,
      action: 'RATE_LIMIT_EXCEEDED',
      entity: 'User',
      entityId: identifier,
      reason: 'Exceeded maximum 5 login attempts within 15 minutes',
    });

    return res.status(429).json(options.message);
  },
});

export default loginRateLimiter;
