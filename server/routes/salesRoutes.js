import express from 'express';
import { authenticate, requireStoreAccess, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import salesController from '../controllers/salesController.js';
import {
  validatePostDraft,
  validateInvoiceId,
  validateListInvoices,
} from '../validators/salesValidators.js';

const router = express.Router();

/**
 * Access Control for all Sales & Invoices routes:
 * Authenticate + requireStoreAccess.
 * Allowed roles: "admin", "salesman".
 */
router.use(authenticate, requireStoreAccess, authorize('admin', 'salesman'));

router.get('/invoices', validateListInvoices, validate, salesController.listInvoices);
router.get('/invoices/:id', validateInvoiceId, validate, salesController.getInvoice);
router.get('/invoices/:id/print', validateInvoiceId, validate, salesController.getInvoicePrint);
router.post('/invoices/post-draft/:id', validatePostDraft, validate, salesController.postDraft);

export default router;

