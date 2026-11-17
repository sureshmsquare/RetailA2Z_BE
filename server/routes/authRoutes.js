import { Router } from 'express';
import { body } from 'express-validator';
import authController from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rateLimiter.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// POST /api/auth/login (with 5 attempts / 15 mins rate limit)
router.post(
  '/login',
  loginRateLimiter,
  [
    body('identifier')
      .notEmpty()
      .withMessage('Identifier (email or 10-digit mobile number) is required')
      .trim(),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
    validate,
  ],
  authController.login
);

// POST /api/auth/logout
router.post('/logout', authController.logout);

// GET /api/auth/me (used on page refresh to get user + assigned stores)
router.get('/me', authenticate, authController.me);

// POST /api/auth/refresh (sliding session refresh)
router.post('/refresh', authenticate, authController.refresh);

export default router;

