import { Router } from 'express';
import {
  listUserStores,
  createNewStore,
  getStoreDetails,
  listStoreMembers,
  addStoreMember,
} from '../controllers/storeController.js';
import { authenticate } from '../middleware/auth.js';
import { requireStoreContext } from '../middleware/storeContext.js';
import { authorize, requireRole } from '../middleware/authorize.js';

const router = Router();

// Store routes require authentication
router.use(authenticate);

// List all stores user belongs to
router.get('/', listUserStores);

// Create new store (OWNER_ADMIN only)
router.post('/', requireRole('OWNER_ADMIN'), createNewStore);

// Store-specific operations requiring store membership verification
router.get('/:storeId', requireStoreContext, getStoreDetails);
router.get('/:storeId/members', requireStoreContext, authorize('USER_VIEW'), listStoreMembers);
router.post('/:storeId/members', requireStoreContext, authorize('USER_CREATE'), addStoreMember);

export default router;

