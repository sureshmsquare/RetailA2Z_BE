import mongoose from 'mongoose';

export async function connectDB(uri) {
  try {
    const mongoUri = uri || process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MongoDB URI is not defined in environment variables (MONGO_URI).');
    }
    const conn = await mongoose.connect(mongoUri);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failed: ${error.message}`);
    process.exit(1);
  }
}

export default connectDB;
