import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireStoreContext } from '../middleware/storeContext.js';
import { authorize } from '../middleware/authorize.js';

const router = Router();

router.use(authenticate);
router.use(requireStoreContext);

// Bills (Accessible to OWNER_ADMIN and CASHIER)
router.get('/bills', authorize('BILL_VIEW'), (req, res) => {
  res.json({
    success: true,
    message: `Fetched bills for store: ${req.store.storeName}`,
    storeId: req.store._id,
    bills: [],
  });
});

router.post('/bills', authorize('BILL_CREATE'), (req, res) => {
  res.status(201).json({
    success: true,
    message: `Bill generated in store: ${req.store.storeName}`,
    storeId: req.store._id,
  });
});

// Products (Viewable by all roles, Create/Update by OWNER_ADMIN)
router.get('/products', authorize('PRODUCT_VIEW'), (req, res) => {
  res.json({
    success: true,
    message: `Products list for store: ${req.store.storeName}`,
    storeId: req.store._id,
    products: [],
  });
});

router.post('/products', authorize('PRODUCT_CREATE'), (req, res) => {
  res.status(201).json({
    success: true,
    message: `Product added to store inventory: ${req.store.storeName}`,
    storeId: req.store._id,
  });
});

// Reports (Restricted to OWNER_ADMIN)
router.get('/reports', authorize('REPORT_VIEW'), (req, res) => {
  res.json({
    success: true,
    message: `Financial and business reports for store: ${req.store.storeName}`,
    storeId: req.store._id,
    data: { revenue: 0, totalOrders: 0 },
  });
});

export default router;

