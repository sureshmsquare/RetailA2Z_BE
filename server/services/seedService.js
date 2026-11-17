import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import auditService from './auditService.js';

export async function seedInitialData() {
  // 1. Seed Stores: "RetailA2Z Main Store" and "RetailA2Z Branch Store"
  let mainStore = await Store.findOne({
    $or: [{ name: 'RetailA2Z Main Store' }, { storeName: 'RetailA2Z Main Store' }, { storeCode: 'RA2Z-001' }],
  });

  if (!mainStore) {
    mainStore = await Store.create({
      name: 'RetailA2Z Main Store',
      storeName: 'RetailA2Z Main Store',
      storeCode: 'RA2Z-001',
      address: '123 Main Market Road, Mumbai, Maharashtra 400001',
      gstin: '27AAAAA0000A1Z5',
      timezone: 'Asia/Kolkata',
      isActive: true,
    });
  } else {
    mainStore.name = 'RetailA2Z Main Store';
    mainStore.storeName = 'RetailA2Z Main Store';
    mainStore.storeCode = mainStore.storeCode || 'RA2Z-001';
    mainStore.gstin = mainStore.gstin || '27AAAAA0000A1Z5';
    mainStore.timezone = 'Asia/Kolkata';
    mainStore.isActive = true;
    await mainStore.save();
  }

  let branchStore = await Store.findOne({
    $or: [{ name: 'RetailA2Z Branch Store' }, { storeName: 'RetailA2Z Branch Store' }, { storeCode: 'RA2Z-002' }],
  });

  if (!branchStore) {
    branchStore = await Store.create({
      name: 'RetailA2Z Branch Store',
      storeName: 'RetailA2Z Branch Store',
      storeCode: 'RA2Z-002',
      address: '456 Commercial Hub, Pune, Maharashtra 411001',
      gstin: '27BBBBB1111B1Z6',
      timezone: 'Asia/Kolkata',
      isActive: true,
    });
  } else {
    branchStore.name = 'RetailA2Z Branch Store';
    branchStore.storeName = 'RetailA2Z Branch Store';
    branchStore.storeCode = branchStore.storeCode || 'RA2Z-002';
    branchStore.gstin = branchStore.gstin || '27BBBBB1111B1Z6';
    branchStore.timezone = 'Asia/Kolkata';
    branchStore.isActive = true;
    await branchStore.save();
  }

  // 2. Prepare Users:
  // - Admin: sureshsalve2001@gmail.com / Admin@123 (both stores)
  // - Salesman: salvesuresh143@gmail.com / User@123 (Main Store only)
  // - Collections user: collections@gmail.com / User@123 (Main Store only)
  const usersToSeed = [
    {
      name: 'Suresh Salve (Admin)',
      email: 'sureshsalve2001@gmail.com',
      mobile: '9876543210',
      password: 'Admin@123',
      role: 'admin',
      storeIds: [mainStore._id, branchStore._id],
    },
    {
      name: 'Suresh Salve (Salesman)',
      email: 'salvesuresh143@gmail.com',
      mobile: '9876543211',
      password: 'User@123',
      role: 'salesman',
      storeIds: [mainStore._id],
    },
    {
      name: 'Collections User',
      email: 'collections@gmail.com',
      mobile: '9876543212',
      password: 'User@123',
      role: 'collections',
      storeIds: [mainStore._id],
    },
  ];

  for (const item of usersToSeed) {
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(item.password, salt);

    let user = await User.findOne({
      $or: [{ email: item.email.toLowerCase() }, { mobile: item.mobile }],
    });

    if (!user) {
      user = await User.create({
        name: item.name,
        email: item.email.toLowerCase(),
        mobile: item.mobile,
        passwordHash,
        role: item.role,
        storeIds: item.storeIds,
        isActive: true,
      });

      await auditService.log({
        actor: 'SYSTEM_SEED',
        action: 'USER_CREATE',
        entity: 'User',
        entityId: user._id,
        after: user.toJSON(),
        reason: `Initial seed for ${item.role} account`,
      });
    } else {
      // Idempotently update to expected state
      user.name = item.name;
      user.email = item.email.toLowerCase();
      user.mobile = item.mobile;
      user.passwordHash = passwordHash;
      user.role = item.role;
      user.storeIds = item.storeIds;
      user.isActive = true;
      await user.save();
    }
  }
}

// Standalone execution support: node server/services/seedService.js
if (process.argv[1] && process.argv[1].endsWith('seedService.js')) {
  (async () => {
    try {
      await connectDB();
      await seedInitialData();
      console.log('✅ Database Seeding Completed Successfully');
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('[Seed Error]', err);
      process.exit(1);
    }
  })();
}

export default seedInitialData;
