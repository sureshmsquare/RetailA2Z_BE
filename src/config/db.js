import mongoose from 'mongoose';

export async function connectDB(uri) {
  try {
    const mongoUri = uri || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MongoDB connection URI is missing. Define MONGODB_URI or MONGO_URI in your .env file.');
    }

    const conn = await mongoose.connect(mongoUri);
    console.log(`[Database] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Failed to connect: ${error.message}`);
    process.exit(1);
  }
}

