import mongoose from 'mongoose';

export async function connectDB(uri) {
  try {
    let mongoUri = uri;
    if (!mongoUri) {
      if (process.env.NODE_ENV === 'test') {
        mongoUri = process.env.MONGO_URI_TEST || process.env.MONGO_URI || process.env.MONGODB_URI;
      } else {
        mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
      }
    }

    if (!mongoUri) {
      throw new Error('MongoDB URI is not defined in environment variables.');
    }

    const conn = await mongoose.connect(mongoUri);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failed: ${error.message}`);
    process.exit(1);
  }
}

export default connectDB;
