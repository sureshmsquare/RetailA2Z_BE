import mongoose from 'mongoose';

export async function connectDB(uri) {
  try {
    const conn = await mongoose.connect(uri || process.env.MONGODB_URI);
    console.log(`[Database] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Failed to connect: ${error.message}`);
    process.exit(1);
  }
}

