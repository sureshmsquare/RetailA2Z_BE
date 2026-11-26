import express from 'express';
import { authenticate, requireStoreAccess, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import collectionsController from '../controllers/collectionsController.js';
import {
  validateListCollectionCustomers,
  validateCustomerIdParam,
  validateRecordReceipt,
} from '../validators/collectionsValidators.js';

const router = express.Router();

/**
 * Access Control for Credit & Collections:
 * Authenticate + requireStoreAccess.
 * Allowed roles: "admin", "salesman", "collections".
 */
router.use(
  authenticate,
  requireStoreAccess,
  authorize('admin', 'salesman', 'collections')
);

router.get(
  '/customers',
  validateListCollectionCustomers,
  validate,
  collectionsController.listCustomers
);

router.get(
  '/customers/:customerId/invoices',
  validateCustomerIdParam,
  validate,
  collectionsController.listCustomerInvoices
);

router.post(
  '/receipts',
  validateRecordReceipt,
  validate,
  collectionsController.recordReceipt
);

export default router;

