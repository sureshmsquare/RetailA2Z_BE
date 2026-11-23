import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Store from '../models/Store.js';
import User from '../models/User.js';
import Category, { normalizeCategoryName } from '../models/Category.js';
import Brand, { normalizeBrandName } from '../models/Brand.js';
import Supplier, { normalizeSupplierName } from '../models/Supplier.js';
import Item from '../models/Item.js';
import PriceHistory from '../models/PriceHistory.js';
import Customer, { normalizeIndianMobile } from '../models/Customer.js';
import CustomerCreditHistory from '../models/CustomerCreditHistory.js';
import Counter, { CUSTOMER_CODE_COUNTER_KEY } from '../models/Counter.js';
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

  // 4. Seed Brands for Main Store: BirlaNu and Supreme (Idempotent)
  const brandNamesToSeed = ['BirlaNu', 'Supreme'];
  const seededBrands = {};

  for (const rawBrandName of brandNamesToSeed) {
    const { name, nameKey } = normalizeBrandName(rawBrandName);
    let brand = await Brand.findOne({ storeId: mainStore._id, nameKey });
    if (!brand) {
      brand = await Brand.create({
        storeId: mainStore._id,
        name,
        nameKey,
        isActive: true,
        createdBy: seedActor,
        updatedBy: seedActor,
      });
    }
    seededBrands[nameKey] = brand;
  }

  // 5. Seed Sample Items for Main Store (Draft status, no selling price)
  // Brand: BirlaNu, Source: "BirlaNu price list", Version: "July 2025"
  const sampleItems = [
    {
      productCode: '96000001',
      name: 'CPVC Pipe SDR 11',
      size: '20 mm',
      length: '3 m',
      mrp: 412.0,
      brandKey: 'birlanu',
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
      brandKey: 'birlanu',
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
      brandKey: 'birlanu',
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
      brandKey: 'birlanu',
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
    const brandDoc = seededBrands[itemData.brandKey] || null;
    const brandId = brandDoc ? brandDoc._id : null;

    if (!item) {
      item = await Item.create({
        storeId: mainStore._id,
        productCode: itemData.productCode,
        name: itemData.name,
        brandId,
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
      item.brandId = brandId;
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

  // 5. Seed 5 Sample Customers (mix of No credit and credit customers) for mainStore
  // Ensure legacy customerCode unique index (if present in DB from earlier schemas) is safely dropped
  try {
    const custIndexes = await Customer.collection.indexes();
    if (custIndexes.some((idx) => idx.name === 'storeId_1_customerCode_1')) {
      await Customer.collection.dropIndex('storeId_1_customerCode_1');
    }
  } catch {
    // Ignore if collection does not exist yet
  }

  const customersToSeed = [
    {
      customerCode: 'CUS-00001',
      name: 'Ramesh Sharma',
      mobile: '+91 98201 12233',
      locality: 'Andheri West',
      businessName: '',
      gstNumber: '',
      creditEnabled: false,
      creditLimitPaise: null,
      creditDays: null,
    },
    {
      customerCode: 'CUS-00002',
      name: 'Pooja Patel',
      mobile: '09820223344',
      locality: 'Borivali East',
      businessName: '',
      gstNumber: '',
      creditEnabled: false,
      creditLimitPaise: null,
      creditDays: null,
    },
    {
      customerCode: 'CUS-00003',
      name: 'Gupta Hardware & Sanitary',
      mobile: '9820334455',
      locality: 'Dadar Market',
      businessName: 'Gupta Hardware Pvt Ltd',
      gstNumber: '27AAAAA1234A1Z5',
      creditEnabled: true,
      creditLimitPaise: 5000000, // Rs 50,000.00
      creditDays: 30,
    },
    {
      customerCode: 'CUS-00004',
      name: 'Shree Krishna Electricals',
      mobile: '+91-98204-45566',
      locality: 'Kurla West',
      businessName: 'Shree Krishna Trading Co',
      gstNumber: '27BBBBB5678B1Z2',
      creditEnabled: true,
      creditLimitPaise: 10000000, // Rs 100,000.00
      creditDays: 45,
    },
    {
      customerCode: 'CUS-00005',
      name: 'Amit Verma',
      mobile: '9820556677',
      locality: 'Thane West',
      businessName: '',
      gstNumber: '',
      creditEnabled: true,
      creditLimitPaise: 2500000, // Rs 25,000.00
      creditDays: 15,
    },
  ];

  for (const cData of customersToSeed) {
    const { normalizedMobile } = normalizeIndianMobile(cData.mobile);
    let customer = await Customer.findOne({
      storeId: mainStore._id,
      normalizedMobile,
    });

    if (!customer) {
      customer = await Customer.create({
        storeId: mainStore._id,
        customerCode: cData.customerCode,
        name: cData.name,
        mobile: cData.mobile,
        normalizedMobile,
        locality: cData.locality,
        businessName: cData.businessName,
        gstNumber: cData.gstNumber,
        creditEnabled: cData.creditEnabled,
        creditLimitPaise: cData.creditLimitPaise,
        creditDays: cData.creditDays,
        isActive: true,
        createdBy: seedActor,
        updatedBy: seedActor,
      });

      if (cData.creditEnabled) {
        await CustomerCreditHistory.create({
          customerId: customer._id,
          storeId: mainStore._id,
          oldCreditEnabled: false,
          newCreditEnabled: true,
          oldCreditLimitPaise: null,
          newCreditLimitPaise: cData.creditLimitPaise,
          oldCreditDays: null,
          newCreditDays: cData.creditDays,
          changedBy: seedActor,
          changedAt: new Date(),
          reason: 'Initial seed credit configuration',
        });
      }
    } else if (!customer.customerCode) {
      customer.customerCode = cData.customerCode;
      await customer.save();
    }
  }

  // Ensure Customer Code Counter is synchronized to at least 5
  await Counter.findOneAndUpdate(
    { storeId: mainStore._id, key: CUSTOMER_CODE_COUNTER_KEY },
    { $max: { seq: 5 } },
    { upsert: true }
  );
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
