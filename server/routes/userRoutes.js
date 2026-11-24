import { Router } from 'express';
import { body } from 'express-validator';
import userController from '../controllers/userController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// All user management routes require admin role and verified store access
router.use(authenticate, authorize('admin'), requireStoreAccess);

// POST /api/users - Create user
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('User name is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('role').optional().isIn(['admin', 'salesman', 'collections']).withMessage('Role must be admin, salesman, or collections'),
    validate,
  ],
  userController.createUser
);

// GET /api/users - List users
router.get('/', userController.listUsers);

// GET /api/users/:id - View user details
router.get('/:id', userController.getUserById);

// PATCH /api/users/:id - Edit name, role, storeIds
router.patch(
  '/:id',
  [
    body('role').optional().isIn(['admin', 'salesman', 'collections']).withMessage('Invalid role'),
    validate,
  ],
  userController.updateUser
);

// PATCH /api/users/:id/status - Activate / deactivate
router.patch(
  '/:id/status',
  [
    body('isActive').isBoolean().withMessage('Field isActive must be boolean'),
    validate,
  ],
  userController.toggleUserStatus
);

// PATCH /api/users/:id/password - Admin resets a user's password
router.patch(
  '/:id/password',
  [
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
    validate,
  ],
  userController.resetPassword
);

export default router;

