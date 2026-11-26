import express from 'express';
import { authenticate, requireStoreAccess, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import billingController from '../controllers/billingController.js';
import {
  validateCreateDraft,
  validateUpdateDraft,
  validateParseLines,
  validateAddLine,
  validateUpdateLine,
  validateDeleteLine,
  validateDraftId,
  validateItemSearch,
  validateCustomerId,
  validateRequestDiscount,
  validateRequestCreditOverride,
} from '../validators/billingValidators.js';
import { validatePostDraft } from '../validators/salesValidators.js';

const router = express.Router();

/**
 * Access Control for all Billing routes:
 * Authenticate + requireStoreAccess.
 * Allowed roles: "admin", "salesman".
 * Collections role receives 403 Forbidden.
 */
router.use(authenticate, requireStoreAccess, authorize('admin', 'salesman'));

// Fixed paths (defined BEFORE /:id to prevent route collisions)
router.get('/items/search', validateItemSearch, validate, billingController.searchItems);
router.get('/customers/:customerId/credit', validateCustomerId, validate, billingController.getCustomerCredit);

// Drafts endpoints
router.post('/drafts', validateCreateDraft, validate, billingController.createDraft);
router.get('/drafts', billingController.listDrafts);
router.get('/drafts/:id', validateDraftId, validate, billingController.getDraft);
router.patch('/drafts/:id', validateUpdateDraft, validate, billingController.updateDraft);
router.delete('/drafts/:id', validateDraftId, validate, billingController.discardDraft);

// Lines endpoints
router.post('/drafts/:id/lines/parse', validateParseLines, validate, billingController.parseLines);
router.post('/drafts/:id/lines', validateAddLine, validate, billingController.addLine);
router.patch('/drafts/:id/lines/:lineId', validateUpdateLine, validate, billingController.updateLine);
router.delete('/drafts/:id/lines/:lineId', validateDeleteLine, validate, billingController.deleteLine);

// Refresh prices endpoint
router.post('/drafts/:id/refresh-prices', validateDraftId, validate, billingController.refreshPrices);

// Discount request & cancel endpoints (BRD APR-01)
router.post('/drafts/:id/discount/request', validateRequestDiscount, validate, billingController.requestDiscount);
router.post('/drafts/:id/discount/cancel', validateDraftId, validate, billingController.cancelDiscount);

// Credit override request & cancel endpoints (BRD APR-04, CR-04)
router.post('/drafts/:id/credit-override/request', validateRequestCreditOverride, validate, billingController.requestCreditOverride);
router.post('/drafts/:id/credit-override/cancel', validateDraftId, validate, billingController.cancelCreditOverride);

// Post / Settle draft bill endpoint (BRD Section 06)
router.post('/drafts/:id/post', validatePostDraft, validate, billingController.postDraft);

export default router;

