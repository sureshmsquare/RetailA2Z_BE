import { Router } from 'express';
import itemController from '../controllers/itemController.js';
import importController from '../controllers/importController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import upload from '../middleware/upload.js';
import {
  validateCreateItem,
  validateUpdateItem,
  validateSetPrice,
  validateSetStatus,
  validateApproveImport,
  validateCancelImport,
} from '../validators/itemValidators.js';

const router = Router();

// All item endpoints require authenticated user and verified store context
router.use(authenticate, requireStoreAccess);

// 1. Active Item Search (Admin + Salesman) & Preview Next Code (Admin only) - defined BEFORE /:id
router.get('/search', authorize('admin', 'salesman'), itemController.searchItems);
router.get('/next-code', authorize('admin'), itemController.getNextProductCode);

// 2. Staged Import Endpoints (Admin only) - defined BEFORE /:id
router.post(
  '/import/stage',
  authorize('admin'),
  upload.single('file'),
  importController.stageImport
);

router.get(
  '/import/:batchId',
  authorize('admin'),
  importController.getImportBatch
);

router.post(
  '/import/:batchId/approve',
  authorize('admin'),
  validateApproveImport,
  validate,
  importController.approveImport
);

router.post(
  '/import/:batchId/cancel',
  authorize('admin'),
  validateCancelImport,
  validate,
  importController.cancelImport
);

// 3. Admin Item Master Listing & Creation
router.get('/', authorize('admin'), itemController.listItems);
router.post('/', authorize('admin'), validateCreateItem, validate, itemController.createItem);

// 4. Item Detail & Sub-resources
router.get('/:id', authorize('admin', 'salesman'), itemController.getItemById);
router.patch('/:id', authorize('admin'), validateUpdateItem, validate, itemController.updateItem);
router.patch('/:id/price', authorize('admin'), validateSetPrice, validate, itemController.setSellingPrice);
router.patch('/:id/status', authorize('admin'), validateSetStatus, validate, itemController.setStatus);
router.get('/:id/price-history', authorize('admin'), itemController.getPriceHistory);
router.get('/:id/stock-movements', authorize('admin'), itemController.getStockMovements);

export default router;

