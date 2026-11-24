import { Router } from 'express';
import purchaseController from '../controllers/purchaseController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validatePurchaseId,
  validateCreatePurchaseDraft,
  validateUpdatePurchaseDraft,
  validatePostPurchase,
  validateCancelPurchase,
  validateListPurchases,
} from '../validators/purchaseValidators.js';

const router = Router();

// All purchase endpoints require authentication, verified store access, and Admin authorization.
// Salesman and collections receive 403 on all purchase endpoints.
router.use(authenticate, requireStoreAccess, authorize('admin'));

// List purchases with search, filter, and pagination
router.get('/', validateListPurchases, validate, purchaseController.listPurchases);

// Create draft purchase
router.post('/', validateCreatePurchaseDraft, validate, purchaseController.createDraft);

// Get single purchase
router.get('/:id', validatePurchaseId, validate, purchaseController.getPurchase);

// Update draft purchase
router.put('/:id', validateUpdatePurchaseDraft, validate, purchaseController.updateDraft);

// Post purchase (moves stock, assigns purchaseNumber)
router.post('/:id/post', validatePostPurchase, validate, purchaseController.postPurchase);

// Cancel posted purchase (creates reverse movements)
router.post('/:id/cancel', validateCancelPurchase, validate, purchaseController.cancelPurchase);

// Delete draft purchase
router.delete('/:id', validatePurchaseId, validate, purchaseController.deleteDraft);

export default router;

