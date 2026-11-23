import { Router } from 'express';
import brandController from '../controllers/brandController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validateCreateBrand,
  validateRenameBrand,
  validateSetBrandStatus,
  validateDeleteBrand,
} from '../validators/brandValidators.js';

const router = Router();

// All brand endpoints require authenticated user and verified store access
router.use(authenticate, requireStoreAccess);

// Active brand dropdown options (Admin + Salesman) - defined BEFORE /:id
router.get('/options', authorize('admin', 'salesman'), brandController.listActiveBrandOptions);

// Brand Master management (Admin only)
router.get('/', authorize('admin'), brandController.listBrands);
router.post(
  '/',
  authorize('admin'),
  validateCreateBrand,
  validate,
  brandController.createBrand
);
router.patch(
  '/:id',
  authorize('admin'),
  validateRenameBrand,
  validate,
  brandController.renameBrand
);
router.patch(
  '/:id/status',
  authorize('admin'),
  validateSetBrandStatus,
  validate,
  brandController.setBrandStatus
);
router.delete(
  '/:id',
  authorize('admin'),
  validateDeleteBrand,
  validate,
  brandController.deleteBrand
);

export default router;

