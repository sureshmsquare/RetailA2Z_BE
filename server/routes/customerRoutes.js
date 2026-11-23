import { Router } from 'express';
import customerController from '../controllers/customerController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validateCreateCustomer,
  validateUpdateCustomer,
  validateUpdateCreditTerms,
  validateSetCustomerStatus,
  validateLookupCustomer,
} from '../validators/customerValidators.js';

const router = Router();

// All customer endpoints require authenticated user and verified store access
router.use(authenticate, requireStoreAccess);

// 1. Mobile lookup suggestions (Admin, Salesman, Collections) - MUST be defined BEFORE /:id
router.get(
  '/lookup',
  authorize('admin', 'salesman', 'collections'),
  validateLookupCustomer,
  validate,
  customerController.lookupCustomers
);

// 2. Customer Directory Listing & Creation
router.get(
  '/',
  authorize('admin', 'salesman', 'collections'),
  customerController.listCustomers
);

router.post(
  '/',
  authorize('admin', 'salesman'),
  validateCreateCustomer,
  validate,
  customerController.createCustomer
);

// 3. Customer Detail & Actions
router.get(
  '/:id',
  authorize('admin', 'salesman', 'collections'),
  customerController.getCustomerById
);

router.put(
  '/:id',
  authorize('admin', 'salesman'),
  validateUpdateCustomer,
  validate,
  customerController.updateCustomer
);

router.put(
  '/:id/credit-terms',
  authorize('admin'),
  validateUpdateCreditTerms,
  validate,
  customerController.updateCreditTerms
);

router.patch(
  '/:id/status',
  authorize('admin'),
  validateSetCustomerStatus,
  validate,
  customerController.setCustomerStatus
);

router.get(
  '/:id/credit-history',
  authorize('admin', 'collections'),
  customerController.getCreditHistory
);

export default router;
