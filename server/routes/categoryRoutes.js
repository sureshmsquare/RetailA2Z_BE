import { Router } from 'express';
import categoryController from '../controllers/categoryController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validateCreateCategory,
  validateRenameCategory,
  validateSetCategoryStatus,
} from '../validators/categoryValidators.js';

const router = Router();

// All category endpoints require authenticated user and verified store access
router.use(authenticate, requireStoreAccess);

// Active category dropdown options (Admin + Salesman) - defined BEFORE /:id
router.get('/options', authorize('admin', 'salesman'), categoryController.listActiveCategoryOptions);

// Category Master management (Admin only; no DELETE endpoint)
router.get('/', authorize('admin'), categoryController.listCategories);
router.post(
  '/',
  authorize('admin'),
  validateCreateCategory,
  validate,
  categoryController.createCategory
);
router.patch(
  '/:id',
  authorize('admin'),
  validateRenameCategory,
  validate,
  categoryController.renameCategory
);
router.patch(
  '/:id/status',
  authorize('admin'),
  validateSetCategoryStatus,
  validate,
  categoryController.setCategoryStatus
);

export default router;

