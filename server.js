import dotenv from 'dotenv';
dotenv.config();

import app from './server/app.js';
import { connectDB } from './server/config/db.js';
import { seedInitialData } from './server/services/seedService.js';

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();
  await seedInitialData();

  app.listen(PORT, () => {
    console.log(`✅ Server running on PORT ${PORT}`);
    console.log('✅ Database Connected Successfully');
  });
}

bootstrap().catch((err) => {
  console.error('[Server Bootstrap Failed]', err);
  process.exit(1);
});
