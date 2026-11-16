import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import storeRoutes from './routes/storeRoutes.js';
import businessRoutes from './routes/businessRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Base healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'RetailA2Z API', timestamp: new Date() });
});

// Mount modules
app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/business', businessRoutes);

// Error handler
app.use(errorHandler);

export default app;

