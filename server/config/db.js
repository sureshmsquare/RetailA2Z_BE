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

    // Replica Set Validation (BRD Section 11)
    let isReplicaSet = false;
    try {
      const adminDb = conn.connection.db.admin();
      const hello = await adminDb.command({ hello: 1 });
      isReplicaSet = Boolean(hello.setName || hello.hosts);
    } catch {
      isReplicaSet = false;
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const requireReplicaSet = process.env.REQUIRE_REPLICA_SET === 'true';

    if (!isReplicaSet && (isProduction || requireReplicaSet)) {
      console.error(
        'FATAL: MongoDB is running as standalone in production/replica-required mode. Multi-document transactions are required for atomic posting (BRD Section 11). Terminating process.'
      );
      process.exit(1);
    } else if (!isReplicaSet && process.env.NODE_ENV !== 'test') {
      console.warn('⚠️ MongoDB standalone — atomic posting disabled. NOT for pilot/UAT.');
    }

    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failed: ${error.message}`);
    process.exit(1);
  }
}

export default connectDB;
