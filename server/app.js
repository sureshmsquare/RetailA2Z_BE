import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import categoryRoutes from './routes/categoryRoutes.js';
import brandRoutes from './routes/brandRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';
import itemRoutes from './routes/itemRoutes.js';
import stockRoutes from './routes/stockRoutes.js';
import purchaseRoutes from './routes/purchaseRoutes.js';
import customerRoutes from './routes/customerRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import salesRoutes from './routes/salesRoutes.js';
import approvalsRoutes from './routes/approvalsRoutes.js';
import collectionsRoutes from './routes/collectionsRoutes.js';
import { authenticate, requireStoreAccess, scopeToStore } from './middleware/auth.js';
import errorHandler from './middleware/errorHandler.js';

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Base healthcheck
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'RetailA2Z Backend API',
    timestamp: new Date(),
  });
});

// Mount modules
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/approvals', approvalsRoutes);
app.use('/api/collections', collectionsRoutes);

// Store-scoped endpoint for testing store isolation & scopeToStore helper
app.get('/api/test/store-scoped', authenticate, requireStoreAccess, (req, res) => {
  const simulatedDbQuery = scopeToStore({ itemCategory: 'hardware' }, req.storeId);
  return res.status(200).json({
    success: true,
    message: `Access granted to store: ${req.store.name}`,
    storeId: req.storeId,
    store: {
      id: req.store._id,
      name: req.store.name,
      gstin: req.store.gstin,
    },
    scopedQuery: simulatedDbQuery,
  });
});

// Central Error Handler (registered LAST)
app.use(errorHandler);

export default app;
