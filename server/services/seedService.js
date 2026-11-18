import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import Category, { normalizeCategoryName } from '../models/Category.js';
import Item from '../models/Item.js';
import PriceHistory from '../models/PriceHistory.js';
import auditService from './auditService.js';
import { toPaise } from '../utils/money.js';

export async function seedInitialData() {
  // 1. Seed Stores: "RetailA2Z Main Store" and "RetailA2Z Branch Store"
  let mainStore = await Store.findOne({
    $or: [{ name: 'RetailA2Z Main Store' }, { storeCode: 'RA2Z-001' }],
  });

  if (!mainStore) {
    mainStore = await Store.create({
      name: 'RetailA2Z Main Store',
      storeCode: 'RA2Z-001',
      address: {
        line1: '123 Main Market Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      },
      gstin: '27AAAAA0000A1Z5',
      timezone: 'Asia/Kolkata',
      isActive: true,
    });
  } else {
    mainStore.name = 'RetailA2Z Main Store';
    mainStore.storeCode = mainStore.storeCode || 'RA2Z-001';
    mainStore.address = {
      line1: '123 Main Market Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    };
    mainStore.gstin = mainStore.gstin || '27AAAAA0000A1Z5';
    mainStore.timezone = 'Asia/Kolkata';
    mainStore.isActive = true;
    await mainStore.save();
  }

  let branchStore = await Store.findOne({
    $or: [{ name: 'RetailA2Z Branch Store' }, { storeCode: 'RA2Z-002' }],
  });

  if (!branchStore) {
    branchStore = await Store.create({
      name: 'RetailA2Z Branch Store',
      storeCode: 'RA2Z-002',
      address: {
        line1: '456 Commercial Hub',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      gstin: '27BBBBB1111B1Z6',
      timezone: 'Asia/Kolkata',
      isActive: true,
    });
  } else {
    branchStore.name = 'RetailA2Z Branch Store';
    branchStore.storeCode = branchStore.storeCode || 'RA2Z-002';
    branchStore.address = {
      line1: '456 Commercial Hub',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    };
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

  // 3. Seed Categories for Main Store (Idempotent)
  const adminUser = await User.findOne({ email: 'sureshsalve2001@gmail.com' });
  const seedActor = adminUser ? adminUser._id : 'SYSTEM_SEED';

  const categoryNamesToSeed = ['CPVC Pipes', 'CPVC Fittings', 'Water Tanks'];
  const seededCategories = {};

  for (const rawCatName of categoryNamesToSeed) {
    const { name, nameKey } = normalizeCategoryName(rawCatName);
    let cat = await Category.findOne({ storeId: mainStore._id, nameKey });
    if (!cat) {
      cat = await Category.create({
        storeId: mainStore._id,
        name,
        nameKey,
        isActive: true,
        createdBy: seedActor,
        updatedBy: seedActor,
      });
    }
    seededCategories[nameKey] = cat;
  }

  // 4. Seed Sample Items for Main Store (Draft status, no selling price)
  // Brand: BirlaNu, Source: "BirlaNu price list", Version: "July 2025"
  const sampleItems = [
    {
      productCode: '96000001',
      name: 'CPVC Pipe SDR 11',
      size: '20 mm',
      length: '3 m',
      mrp: 412.0,
      brand: 'BirlaNu',
      categoryKey: 'cpvc pipes',
      sellingUnit: 'MTR',
      unitsPerPack: 1,
    },
    {
      productCode: '96000263',
      name: 'CPVC Pipe SDR 11',
      size: '15 mm',
      length: '5 m',
      mrp: 474.0,
      brand: 'BirlaNu',
      categoryKey: 'cpvc pipes',
      sellingUnit: 'MTR',
      unitsPerPack: 1,
    },
    {
      productCode: '96000036',
      name: 'CPVC Elbow 90 degree',
      size: '15 mm',
      length: '',
      mrp: 19.25,
      brand: 'BirlaNu',
      categoryKey: 'cpvc fittings',
      sellingUnit: 'PCS',
      unitsPerPack: 1,
    },
    {
      productCode: '98000505',
      name: 'Water Tank 3 Layer White',
      size: '500 L',
      length: '',
      mrp: 6500.0,
      brand: 'BirlaNu',
      categoryKey: 'water tanks',
      sellingUnit: 'PCS',
      unitsPerPack: 1,
    },
  ];

  for (const itemData of sampleItems) {
    let item = await Item.findOne({
      storeId: mainStore._id,
      productCode: itemData.productCode,
    });

    const mrpPaise = toPaise(itemData.mrp);
    const categoryDoc = seededCategories[itemData.categoryKey] || null;
    const categoryId = categoryDoc ? categoryDoc._id : null;

    if (!item) {
      item = await Item.create({
        storeId: mainStore._id,
        productCode: itemData.productCode,
        name: itemData.name,
        brand: itemData.brand,
        categoryId,
        size: itemData.size,
        length: itemData.length,
        sellingUnit: itemData.sellingUnit,
        unitsPerPack: itemData.unitsPerPack,
        mrpPaise,
        mrpSource: {
          sourceName: 'BirlaNu price list',
          sourceVersion: 'July 2025',
          sourceDate: new Date('2025-07-01'),
        },
        sellingPricePaise: null, // Draft items have NO selling price initially
        status: 'draft',
        createdBy: seedActor,
        updatedBy: seedActor,
      });

      // Record initial MRP history
      await PriceHistory.create({
        storeId: mainStore._id,
        itemId: item._id,
        field: 'mrp',
        oldValuePaise: null,
        newValuePaise: mrpPaise,
        effectiveFrom: new Date('2025-07-01'),
        reason: 'Initial BirlaNu price list seed',
        changedBy: seedActor,
      });
    } else {
      // Idempotently update metadata without touching selling price
      item.name = itemData.name;
      item.brand = itemData.brand;
      item.categoryId = categoryId;
      item.size = itemData.size;
      item.length = itemData.length;
      item.sellingUnit = itemData.sellingUnit;
      item.unitsPerPack = itemData.unitsPerPack;
      item.mrpPaise = mrpPaise;
      item.mrpSource = {
        sourceName: 'BirlaNu price list',
        sourceVersion: 'July 2025',
        sourceDate: new Date('2025-07-01'),
      };
      await item.save();
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
