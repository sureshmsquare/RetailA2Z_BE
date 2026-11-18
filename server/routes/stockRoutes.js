import { Router } from 'express';
import stockController from '../controllers/stockController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validateOpeningStock,
  validateStockAdjustment,
} from '../validators/itemValidators.js';

const router = Router();

// All stock routes require authenticated user and verified store access
router.use(authenticate, requireStoreAccess);

// POST /api/stock/opening (Admin only)
router.post(
  '/opening',
  authorize('admin'),
  validateOpeningStock,
  validate,
  stockController.postOpeningStock
);

// POST /api/stock/adjustment (Admin only)
router.post(
  '/adjustment',
  authorize('admin'),
  validateStockAdjustment,
  validate,
  stockController.postAdjustment
);

export default router;

