import dotenv from 'dotenv';
dotenv.config();

import app from './app.js';
import { connectDB } from './config/db.js';

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`✅ Server running on PORT ${PORT}`);
    console.log('✅ Database Connected Successfully');
  });
}

bootstrap().catch((err) => {
  console.error('[RetailA2Z Bootstrap Error]', err);
  process.exit(1);
});
