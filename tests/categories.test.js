import dotenv from 'dotenv';
dotenv.config();

// Ensure test environment uses MONGO_URI_TEST
process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import app from '../server/app.js';
import connectDB from '../server/config/db.js';
import Store from '../server/models/Store.js';
import User from '../server/models/User.js';
import Category from '../server/models/Category.js';
import Item from '../server/models/Item.js';
import PriceHistory from '../server/models/PriceHistory.js';
import ImportBatch from '../server/models/ImportBatch.js';
import AuditLog from '../server/models/AuditLog.js';
import { generateToken } from '../server/utils/tokens.js';
import { migrateItemCategories } from '../scripts/migrateItemCategories.js';

async function runCategoryTests() {
  console.log('================================================================');
  console.log('    RetailA2Z - Category Master & Migration Test Suite          ');
  console.log('================================================================\n');

  const conn = await connectDB();
  console.log(`Connected to test DB: ${conn.connection.name}\n`);

  const TEST_PORT = 5003;
  const server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  const results = [];
  const recordResult = (testName, passed, details = '') => {
    results.push({ testName, passed, details });
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${testName}`);
    if (details) console.log(`   ${details}`);
  };

  let storeA, storeB, migrationStore;
  let adminUser, salesmanUser, collectionsUser;

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURES: Store A, Store B, Migration Store & Users
    // -------------------------------------------------------------
    const ts = Date.now();
    storeA = await Store.create({
      name: 'Category Test Store A',
      storeCode: `CAT-A-${ts}`,
      address: { line1: 'Alpha Rd', city: 'Mumbai', state: 'MH', pincode: '400001' },
      isActive: true,
    });

    storeB = await Store.create({
      name: 'Category Test Store B',
      storeCode: `CAT-B-${ts}`,
      address: { line1: 'Beta Rd', city: 'Pune', state: 'MH', pincode: '411001' },
      isActive: true,
    });

    migrationStore = await Store.create({
      name: 'Category Migration Test Store',
      storeCode: `CAT-MIG-${ts}`,
      address: { line1: 'Mig Rd', city: 'Nashik', state: 'MH', pincode: '422001' },
      isActive: true,
    });

    const storeAId = storeA._id.toString();
    const storeBId = storeB._id.toString();

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Secret@123', salt);

    adminUser = await User.create({
      name: 'Cat Test Admin',
      email: `cat_admin_${ts}@test.com`,
      mobile: `91${ts.toString().slice(-8)}`,
      passwordHash,
      role: 'admin',
      storeIds: [storeA._id, storeB._id],
      isActive: true,
    });

    salesmanUser = await User.create({
      name: 'Cat Test Salesman',
      email: `cat_salesman_${ts}@test.com`,
      mobile: `92${ts.toString().slice(-8)}`,
      passwordHash,
      role: 'salesman',
      storeIds: [storeA._id],
      isActive: true,
    });

    collectionsUser = await User.create({
      name: 'Cat Test Collections',
      email: `cat_collections_${ts}@test.com`,
      mobile: `93${ts.toString().slice(-8)}`,
      passwordHash,
      role: 'collections',
      storeIds: [storeA._id],
      isActive: true,
    });

    const adminToken = generateToken(adminUser);
    const salesmanToken = generateToken(salesmanUser);
    const collectionsToken = generateToken(collectionsUser);

    const adminHeadersA = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-store-id': storeAId,
    };

    const adminHeadersB = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
      'x-store-id': storeBId,
    };

    const salesmanHeadersA = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${salesmanToken}`,
      'x-store-id': storeAId,
    };

    const collectionsHeadersA = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${collectionsToken}`,
      'x-store-id': storeAId,
    };

    // -------------------------------------------------------------
    // TEST 1: Creating "Pipe" then "pipe" and " PIPE " in same store -> 409; same name in another store allowed
    // -------------------------------------------------------------
    const res1a = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'Pipe' }),
    });
    const data1a = await res1a.json();
    const pipeCatAId = data1a.data?._id || data1a.data?.id;

    const res1b = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'pipe' }),
    });
    const data1b = await res1b.json();

    const res1c = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: '  PIPE  ' }),
    });
    const data1c = await res1c.json();

    const res1d = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersB,
      body: JSON.stringify({ name: 'Pipe' }),
    });
    const data1d = await res1d.json();
    const pipeCatBId = data1d.data?._id || data1d.data?.id;

    const test1Pass =
      res1a.status === 201 &&
      res1b.status === 409 &&
      data1b.message === 'Category already exists' &&
      res1c.status === 409 &&
      data1c.message === 'Category already exists' &&
      res1d.status === 201 &&
      Boolean(pipeCatAId) &&
      Boolean(pipeCatBId);

    recordResult(
      'Creating "Pipe" then "pipe" and " PIPE " in same store -> 409; same name in another store allowed',
      test1Pass,
      `Store A "Pipe": ${res1a.status}, "pipe": ${res1b.status}, "  PIPE  ": ${res1c.status}, Store B "Pipe": ${res1d.status}`
    );

    // -------------------------------------------------------------
    // TEST 2: Rename keeps the same _id and items still show the new name
    // -------------------------------------------------------------
    const res2Item = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: `REN-ITEM-${ts}`,
        name: 'CPVC Pipe 25mm',
        categoryId: pipeCatAId,
        mrp: 300,
        sellingPrice: 280,
      }),
    });
    const data2Item = await res2Item.json();
    const item2Id = data2Item.data?._id;

    const res2Rename = await fetch(`${baseUrl}/api/categories/${pipeCatAId}`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ name: '  CPVC   Pipes  ' }),
    });
    const data2Rename = await res2Rename.json();

    const res2FetchItem = await fetch(`${baseUrl}/api/items/${item2Id}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data2FetchItem = await res2FetchItem.json();

    const renameAudit = await AuditLog.findOne({
      entityId: String(pipeCatAId),
      action: 'CATEGORY_RENAME',
    });

    const test2Pass =
      res2Item.status === 201 &&
      res2Rename.status === 200 &&
      String(data2Rename.data?._id) === String(pipeCatAId) &&
      data2Rename.data?.name === 'CPVC Pipes' &&
      data2FetchItem.data?.category?.id === String(pipeCatAId) &&
      data2FetchItem.data?.category?.name === 'CPVC Pipes' &&
      Boolean(renameAudit);

    recordResult(
      'Rename keeps the same _id and items still show the new name',
      test2Pass,
      `Renamed _id match: ${String(data2Rename.data?._id) === String(pipeCatAId)}, Item category: ${JSON.stringify(data2FetchItem.data?.category)}, Audit logged: ${Boolean(renameAudit)}`
    );

    // -------------------------------------------------------------
    // TEST 3: Item create with a category from another store -> 400
    // -------------------------------------------------------------
    const res3 = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: `CROSS-CAT-${ts}`,
        name: 'Cross Store Category Item',
        categoryId: pipeCatBId, // belongs to Store B!
        mrp: 150,
      }),
    });
    const data3 = await res3.json();

    const test3Pass = res3.status === 400 && data3.message === 'Invalid category';

    recordResult(
      'Item create with a category from another store -> 400',
      test3Pass,
      `Status: ${res3.status}, Message: "${data3.message}"`
    );

    // -------------------------------------------------------------
    // TEST 4: Item create with an inactive category -> 400; existing items still return category name
    // -------------------------------------------------------------
    // Create a second category in Store A, assign to an item, then deactivate it
    const res4Cat = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'CPVC Fittings' }),
    });
    const data4Cat = await res4Cat.json();
    const fittingsCatId = data4Cat.data?._id || data4Cat.data?.id;

    const res4ExistingItem = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: `FIT-ITEM-${ts}`,
        name: 'CPVC Elbow 20mm',
        categoryId: fittingsCatId,
        mrp: 40,
        sellingPrice: 35,
      }),
    });
    const data4ExistingItem = await res4ExistingItem.json();
    const fittingsItemId = data4ExistingItem.data?._id;

    // Deactivate CPVC Fittings
    const res4Deactivate = await fetch(`${baseUrl}/api/categories/${fittingsCatId}/status`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ isActive: false }),
    });

    // Try creating a NEW item with the inactive category -> 400
    const res4NewWithInactive = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: `INACT-ITEM-${ts}`,
        name: 'Item with Inactive Category',
        categoryId: fittingsCatId,
        mrp: 50,
      }),
    });
    const data4NewWithInactive = await res4NewWithInactive.json();

    // Existing item still returns its category name
    const res4FetchExisting = await fetch(`${baseUrl}/api/items/${fittingsItemId}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data4FetchExisting = await res4FetchExisting.json();

    const test4Pass =
      res4Deactivate.status === 200 &&
      res4NewWithInactive.status === 400 &&
      data4NewWithInactive.message === 'Invalid category' &&
      res4FetchExisting.status === 200 &&
      data4FetchExisting.data?.category?.id === String(fittingsCatId) &&
      data4FetchExisting.data?.category?.name === 'CPVC Fittings';

    recordResult(
      'Item create with an inactive category -> 400; existing items still return their category name',
      test4Pass,
      `Create with inactive: ${res4NewWithInactive.status} ("${data4NewWithInactive.message}"), Existing item category: ${JSON.stringify(data4FetchExisting.data?.category)}`
    );

    // -------------------------------------------------------------
    // TEST 5: Items filter by categoryId returns only matching items (list & active search + itemCount)
    // -------------------------------------------------------------
    // Activate item2 so we can test GET /api/items/search?categoryId=... too
    await fetch(`${baseUrl}/api/items/${item2Id}/status`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ status: 'active' }),
    });
    await fetch(`${baseUrl}/api/items/${fittingsItemId}/status`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ status: 'active' }),
    });

    const res5List = await fetch(`${baseUrl}/api/items?categoryId=${pipeCatAId}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data5List = await res5List.json();

    const res5Search = await fetch(`${baseUrl}/api/items/search?categoryId=${pipeCatAId}`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const data5Search = await res5Search.json();

    const res5Cats = await fetch(`${baseUrl}/api/categories`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data5Cats = await res5Cats.json();
    const pipeCatEntry = (data5Cats.data || []).find((c) => String(c._id) === String(pipeCatAId));

    const test5Pass =
      res5List.status === 200 &&
      data5List.data?.length === 1 &&
      String(data5List.data[0]._id) === String(item2Id) &&
      res5Search.status === 200 &&
      data5Search.data?.length === 1 &&
      String(data5Search.data[0]._id) === String(item2Id) &&
      data5Search.data[0].category?.name === 'CPVC Pipes' &&
      data5Search.data[0].sellingPrice === undefined && // price stripped for salesman, category preserved
      pipeCatEntry?.itemCount === 1;

    recordResult(
      'Items filter by categoryId returns only matching items (admin list, salesman search & itemCount)',
      test5Pass,
      `Admin list matched: ${data5List.data?.length}, Salesman search matched: ${data5Search.data?.length}, Salesman sees category: "${data5Search.data?.[0]?.category?.name}", itemCount: ${pipeCatEntry?.itemCount}`
    );

    // -------------------------------------------------------------
    // TEST 6: Import row with unknown category -> error with reason; known category (any case) -> matched; empty -> allowed
    // -------------------------------------------------------------
    const csvContent = [
      'productCode,name,mrp,brand,category,sellingUnit,unitsPerPack',
      `IMP-OK-${ts},Matched Case Pipe,520,BirlaNu,  cpvc   PIPES  ,MTR,1`,
      `IMP-EMPTY-${ts},Uncategorized Clamp,45,BirlaNu,,PCS,1`,
      `IMP-BAD-${ts},Unknown Cat Valve,320,BirlaNu,Solar Heaters,PCS,1`,
      `IMP-INACT-${ts},Inactive Cat Elbow,30,BirlaNu,CPVC Fittings,PCS,1`,
    ].join('\n');

    const boundary = '----WebKitFormBoundaryCatTest' + ts;
    let bodyMultipart = '';
    bodyMultipart += `--${boundary}\r\n`;
    bodyMultipart += `Content-Disposition: form-data; name="sourceName"\r\n\r\nCategory Import Test\r\n`;
    bodyMultipart += `--${boundary}\r\n`;
    bodyMultipart += `Content-Disposition: form-data; name="file"; filename="cat_import.csv"\r\n`;
    bodyMultipart += `Content-Type: text/csv\r\n\r\n`;
    bodyMultipart += `${csvContent}\r\n`;
    bodyMultipart += `--${boundary}--\r\n`;

    const res6Stage = await fetch(`${baseUrl}/api/items/import/stage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-store-id': storeAId,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyMultipart,
    });
    const data6Stage = await res6Stage.json();
    const stagedRows = data6Stage.data?.rows || [];

    const matchedRow = stagedRows.find((r) => r.data?.productCode === `IMP-OK-${ts}`);
    const emptyCatRow = stagedRows.find((r) => r.data?.productCode === `IMP-EMPTY-${ts}`);
    const unknownCatRow = stagedRows.find((r) => r.data?.productCode === `IMP-BAD-${ts}`);
    const inactiveCatRow = stagedRows.find((r) => r.data?.productCode === `IMP-INACT-${ts}`);

    const test6Pass =
      res6Stage.status === 201 &&
      matchedRow?.result === 'new' &&
      String(matchedRow?.data?.categoryId) === String(pipeCatAId) &&
      emptyCatRow?.result === 'new' &&
      emptyCatRow?.data?.categoryId === null &&
      unknownCatRow?.result === 'error' &&
      unknownCatRow?.errors?.includes('Category not found: Solar Heaters. Add it in Category Master first.') &&
      inactiveCatRow?.result === 'error' &&
      inactiveCatRow?.errors?.includes('Category not found: CPVC Fittings. Add it in Category Master first.');

    recordResult(
      'Import row with unknown/inactive category -> error with reason; known category (any case) -> matched; empty allowed',
      test6Pass,
      `Matched: ${matchedRow?.result} (catId match: ${String(matchedRow?.data?.categoryId) === String(pipeCatAId)}), Empty: ${emptyCatRow?.result}, Unknown: ${unknownCatRow?.result} (${unknownCatRow?.errors?.[0]}), Inactive: ${inactiveCatRow?.result}`
    );

    // -------------------------------------------------------------
    // TEST 7: Salesman can call GET /api/categories/options, 403 on POST/PATCH/GET; Collections gets 403 on everything
    // -------------------------------------------------------------
    const res7SalesOptions = await fetch(`${baseUrl}/api/categories/options`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const data7SalesOptions = await res7SalesOptions.json();

    const res7SalesList = await fetch(`${baseUrl}/api/categories`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const res7SalesPost = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: salesmanHeadersA,
      body: JSON.stringify({ name: 'Salesman Cat' }),
    });
    const res7SalesPatch = await fetch(`${baseUrl}/api/categories/${pipeCatAId}`, {
      method: 'PATCH',
      headers: salesmanHeadersA,
      body: JSON.stringify({ name: 'Hacked' }),
    });
    const res7SalesStatus = await fetch(`${baseUrl}/api/categories/${pipeCatAId}/status`, {
      method: 'PATCH',
      headers: salesmanHeadersA,
      body: JSON.stringify({ isActive: false }),
    });

    const res7CollOptions = await fetch(`${baseUrl}/api/categories/options`, {
      method: 'GET',
      headers: collectionsHeadersA,
    });
    const res7CollList = await fetch(`${baseUrl}/api/categories`, {
      method: 'GET',
      headers: collectionsHeadersA,
    });
    const res7CollPost = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: collectionsHeadersA,
      body: JSON.stringify({ name: 'Coll Cat' }),
    });
    const res7CollPatch = await fetch(`${baseUrl}/api/categories/${pipeCatAId}`, {
      method: 'PATCH',
      headers: collectionsHeadersA,
      body: JSON.stringify({ name: 'Coll Rename' }),
    });
    const res7CollStatus = await fetch(`${baseUrl}/api/categories/${pipeCatAId}/status`, {
      method: 'PATCH',
      headers: collectionsHeadersA,
      body: JSON.stringify({ isActive: false }),
    });

    // Options should ONLY include active categories ({ id, name }) — CPVC Fittings is inactive so must NOT appear
    const optionNames = (data7SalesOptions.data || []).map((o) => o.name);

    const test7Pass =
      res7SalesOptions.status === 200 &&
      optionNames.includes('CPVC Pipes') &&
      !optionNames.includes('CPVC Fittings') &&
      res7SalesList.status === 403 &&
      res7SalesPost.status === 403 &&
      res7SalesPatch.status === 403 &&
      res7SalesStatus.status === 403 &&
      res7CollOptions.status === 403 &&
      res7CollList.status === 403 &&
      res7CollPost.status === 403 &&
      res7CollPatch.status === 403 &&
      res7CollStatus.status === 403;

    recordResult(
      'Salesman gets 200 on GET /options (active only) & 403 on POST/PATCH/GET; Collections gets 403 on everything',
      test7Pass,
      `Salesman options: ${res7SalesOptions.status} (${JSON.stringify(optionNames)}), POST/PATCH/Status: ${res7SalesPost.status}/${res7SalesPatch.status}/${res7SalesStatus.status}; Collections all 403: ${res7CollOptions.status}/${res7CollList.status}/${res7CollPost.status}/${res7CollPatch.status}/${res7CollStatus.status}`
    );

    // -------------------------------------------------------------
    // TEST 8: storeId in the request body is ignored
    // -------------------------------------------------------------
    const res8 = await fetch(`${baseUrl}/api/categories`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Water Tanks',
        storeId: storeBId, // spoofed storeId in body — MUST be ignored
      }),
    });
    const data8 = await res8.json();
    const persistedCat = await Category.findById(data8.data?._id);

    const test8Pass =
      res8.status === 201 &&
      persistedCat &&
      String(persistedCat.storeId) === storeAId &&
      String(persistedCat.storeId) !== storeBId;

    recordResult(
      'storeId in the request body is ignored',
      test8Pass,
      `Body storeId: ${storeBId}, Persisted storeId: ${persistedCat?.storeId} (Expected Store A: ${storeAId})`
    );

    // -------------------------------------------------------------
    // TEST 9: Migration script is idempotent (second run changes nothing)
    // -------------------------------------------------------------
    // Insert raw legacy items with free-text `category` field directly via native collection
    await Item.collection.insertMany([
      {
        storeId: migrationStore._id,
        productCode: `MIG-1-${ts}`,
        name: 'Legacy Pipe 1',
        category: 'PVC Pipes',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        storeId: migrationStore._id,
        productCode: `MIG-2-${ts}`,
        name: 'Legacy Pipe 2',
        category: '  pvc   pipes ',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        storeId: migrationStore._id,
        productCode: `MIG-3-${ts}`,
        name: 'Legacy Pipe 3',
        category: 'PVC Pipes',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        storeId: migrationStore._id,
        productCode: `MIG-4-${ts}`,
        name: 'Legacy Empty Category Item',
        category: '   ',
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const run1 = await migrateItemCategories({ storeIds: [migrationStore._id], quiet: true });
    const run2 = await migrateItemCategories({ storeIds: [migrationStore._id], quiet: true });

    const migratedCats = await Category.find({ storeId: migrationStore._id });
    const migratedItems = await Item.collection.find({ storeId: migrationStore._id }).toArray();
    const anyOldTextFieldLeft = migratedItems.some((doc) => 'category' in doc);
    const linkedPipeItems = migratedItems.filter(
      (doc) => doc.categoryId && String(doc.categoryId) === String(migratedCats[0]?._id)
    );

    const test9Pass =
      run1.categoriesCreated === 1 &&
      run1.itemsUpdated === 4 &&
      run1.itemsWithoutCategory === 1 &&
      migratedCats.length === 1 &&
      migratedCats[0].name === 'PVC Pipes' && // Most common original spelling!
      linkedPipeItems.length === 3 &&
      !anyOldTextFieldLeft &&
      run2.categoriesCreated === 0 &&
      run2.itemsUpdated === 0 &&
      run2.itemsWithoutCategory === 1;

    recordResult(
      'Migration script is idempotent (creates 1 category with most common spelling, unsets old text, second run changes nothing)',
      test9Pass,
      `Run 1: created=${run1.categoriesCreated}, updated=${run1.itemsUpdated}, withoutCat=${run1.itemsWithoutCategory}, chosenName="${migratedCats[0]?.name}"; Run 2: created=${run2.categoriesCreated}, updated=${run2.itemsUpdated}`
    );
  } finally {
    // Cleanup test fixtures
    const testStoreIds = [storeA?._id, storeB?._id, migrationStore?._id].filter(Boolean);
    if (testStoreIds.length > 0) {
      await Item.deleteMany({ storeId: { $in: testStoreIds } });
      await Category.deleteMany({ storeId: { $in: testStoreIds } });
      await PriceHistory.deleteMany({ storeId: { $in: testStoreIds } });
      await ImportBatch.deleteMany({ storeId: { $in: testStoreIds } });
      await AuditLog.deleteMany({ storeId: { $in: testStoreIds } });
      await Store.deleteMany({ _id: { $in: testStoreIds } });
    }
    const testUserIds = [adminUser?._id, salesmanUser?._id, collectionsUser?._id].filter(Boolean);
    if (testUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: testUserIds } });
    }

    console.log('\n[Cleanup] Category test fixtures cleaned up from test database.');
    server.close();
    await mongoose.disconnect();
  }

  console.log('\n================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`Summary: ${passedCount}/${results.length} tests passed.`);
  console.log('================================================================\n');

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runCategoryTests().catch((err) => {
  console.error('[Category Tests Fatal Error]', err);
  process.exit(1);
});

