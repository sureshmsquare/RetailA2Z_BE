import { Router } from 'express';
import {
  login,
  refresh,
  logout,
  me,
  switchStore,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.post('/switch-store', authenticate, switchStore);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;

