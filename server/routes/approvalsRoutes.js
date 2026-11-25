import express from 'express';
import { authenticate, requireStoreAccess, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import approvalsController from '../controllers/approvalsController.js';
import {
  validateDecideDiscount,
  validateDecideCreditOverride,
  validateRequestId,
} from '../validators/approvalsValidators.js';

const router = express.Router();

/**
 * Access Control for Approvals:
 * Authenticate + requireStoreAccess.
 * Allowed roles: "admin" only.
 * Salesman and collections receive 403 Forbidden.
 */
router.use(authenticate, requireStoreAccess, authorize('admin'));

// Pending count endpoints
router.get('/pending-counts', approvalsController.getPendingCounts);
router.get('/discounts/pending-count', approvalsController.getPendingCounts);
router.get('/credit-overrides/pending-count', approvalsController.getPendingCreditCount);

// Discount approvals endpoints
router.get('/discounts', approvalsController.listDiscountApprovals);
router.get('/discounts/:id', validateRequestId, validate, approvalsController.getDiscountApproval);
router.post('/discounts/:id/decide', validateDecideDiscount, validate, approvalsController.decideDiscount);

// Credit override approvals endpoints (BRD APR-04, CR-04, CR-05)
router.get('/credit-overrides', approvalsController.listCreditOverrides);
router.get('/credit-overrides/:id', validateRequestId, validate, approvalsController.getCreditOverride);
router.post('/credit-overrides/:id/decide', validateDecideCreditOverride, validate, approvalsController.decideCreditOverride);

export default router;

