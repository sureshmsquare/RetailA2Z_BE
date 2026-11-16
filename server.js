import dotenv from 'dotenv';
dotenv.config();

import app from './src/app.js';
import { connectDB } from './src/config/db.js';
import { seedInitialData } from './src/services/seedService.js';

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  await seedInitialData();

  app.listen(PORT, () => {
    console.log(`[RetailA2Z Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Server Bootstrap Failed]', err);
  process.exit(1);
});

