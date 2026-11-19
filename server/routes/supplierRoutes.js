import { Router } from 'express';
import supplierController from '../controllers/supplierController.js';
import { authenticate, authorize, requireStoreAccess } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  validateCreateSupplier,
  validateUpdateSupplier,
  validateSetSupplierStatus,
  validateSupplierId,
} from '../validators/supplierValidators.js';

const router = Router();

// All supplier endpoints require authentication, verified store access, and Admin authorization.
// Salesman and collections receive 403 on all supplier endpoints.
router.use(authenticate, requireStoreAccess, authorize('admin'));

// Active supplier dropdown options - must be defined BEFORE /:id
router.get('/options', supplierController.listActiveSupplierOptions);

// List suppliers with search, status filter, and pagination
router.get('/', supplierController.listSuppliers);

// Get single supplier
router.get('/:id', validateSupplierId, validate, supplierController.getSupplier);

// Create supplier
router.post('/', validateCreateSupplier, validate, supplierController.createSupplier);

// Update supplier
router.patch('/:id', validateUpdateSupplier, validate, supplierController.updateSupplier);

// Activate / Deactivate supplier
router.patch('/:id/status', validateSetSupplierStatus, validate, supplierController.setSupplierStatus);

// Delete supplier
router.delete('/:id', validateSupplierId, validate, supplierController.deleteSupplier);

export default router;

