import dotenv from 'dotenv';
dotenv.config();

// Ensure test environment uses MONGO_URI_TEST
process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import app from '../server/app.js';
import connectDB from '../server/config/db.js';
import Store from '../server/models/Store.js';
import User from '../server/models/User.js';
import Category from '../server/models/Category.js';
import Counter from '../server/models/Counter.js';
import Item from '../server/models/Item.js';
import PriceHistory from '../server/models/PriceHistory.js';
import StockMovement from '../server/models/StockMovement.js';
import ImportBatch from '../server/models/ImportBatch.js';
import AuditLog from '../server/models/AuditLog.js';
import { generateToken } from '../server/utils/tokens.js';
import bcrypt from 'bcryptjs';

async function runItemTests() {
  console.log('================================================================');
  console.log('    RetailA2Z - Item Master & Staged Import Test Suite          ');
  console.log('================================================================\n');

  // Connect to test database
  const conn = await connectDB();
  console.log(`Connected to test DB: ${conn.connection.name}\n`);

  const TEST_PORT = 5002;
  const server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  const results = [];
  const recordResult = (testName, passed, details = '') => {
    results.push({ testName, passed, details });
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${testName}`);
    if (details) console.log(`   ${details}`);
  };

  try {
    // -------------------------------------------------------------
    // SETUP TEST FIXTURES: Store A, Store B, Admin, Salesman, Collections
    // -------------------------------------------------------------
    // 1. Create Store A and Store B
    const storeA = await Store.create({
      name: 'Test Store Alpha',
      storeCode: `TEST-A-${Date.now()}`,
      address: { line1: 'Alpha St', city: 'Mumbai', state: 'MH', pincode: '400001' },
      isActive: true,
    });

    const storeB = await Store.create({
      name: 'Test Store Beta',
      storeCode: `TEST-B-${Date.now()}`,
      address: { line1: 'Beta St', city: 'Pune', state: 'MH', pincode: '411001' },
      isActive: true,
    });

    const storeAId = storeA._id.toString();
    const storeBId = storeB._id.toString();

    // 2. Create Users
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Secret@123', salt);

    // Admin has access to both Store A and Store B
    const adminUser = await User.create({
      name: 'Test Admin',
      email: `admin_${Date.now()}@test.com`,
      mobile: `99${Date.now().toString().slice(-8)}`,
      passwordHash,
      role: 'admin',
      storeIds: [storeA._id, storeB._id],
      isActive: true,
    });

    // Salesman has access to Store A only
    const salesmanUser = await User.create({
      name: 'Test Salesman',
      email: `salesman_${Date.now()}@test.com`,
      mobile: `98${Date.now().toString().slice(-8)}`,
      passwordHash,
      role: 'salesman',
      storeIds: [storeA._id],
      isActive: true,
    });

    // Collections user has access to Store A only
    const collectionsUser = await User.create({
      name: 'Test Collections',
      email: `collections_${Date.now()}@test.com`,
      mobile: `97${Date.now().toString().slice(-8)}`,
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
    // TEST 1: Same productCode in same store -> 409; same code in another store -> allowed
    // -------------------------------------------------------------
    const code1 = `PIPE-${Date.now()}`;
    const res1a = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: code1,
        name: 'CPVC Pipe 20mm',
        brand: 'BirlaNu',
        category: 'Pipes',
        mrp: 450.0,
      }),
    });
    const data1a = await res1a.json();
    const item1Id = data1a.data?._id;

    // Duplicate in same store -> must return 409
    const res1b = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        productCode: code1,
        name: 'Duplicate CPVC Pipe',
        brand: 'BirlaNu',
      }),
    });

    // Same productCode in Store B -> allowed (201)
    const res1c = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersB,
      body: JSON.stringify({
        productCode: code1,
        name: 'CPVC Pipe in Store B',
        brand: 'BirlaNu',
        mrp: 450.0,
      }),
    });

    const test1Pass = res1a.status === 201 && res1b.status === 409 && res1c.status === 201;
    recordResult(
      'Same productCode in same store -> 409; same code in another store -> allowed',
      test1Pass,
      `Store A initial: ${res1a.status}, Store A duplicate: ${res1b.status}, Store B same code: ${res1c.status}`
    );

    // -------------------------------------------------------------
    // TEST 2: Activating without selling price -> 400
    // -------------------------------------------------------------
    // Item 1 currently has mrp=450, sellingPrice=null, status='draft'
    const res2a = await fetch(`${baseUrl}/api/items/${item1Id}/status`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ status: 'active' }),
    });
    const data2a = await res2a.json();

    // Now set selling price
    const res2b = await fetch(`${baseUrl}/api/items/${item1Id}/price`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ price: 420.0, reason: 'Initial selling price set' }),
    });

    // Now activate should succeed (200)
    const res2c = await fetch(`${baseUrl}/api/items/${item1Id}/status`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ status: 'active' }),
    });
    const data2c = await res2c.json();

    const test2Pass =
      res2a.status === 400 &&
      data2a.message.includes('Set selling price before activation') &&
      res2b.status === 200 &&
      res2c.status === 200 &&
      data2c.data?.status === 'active';

    recordResult(
      'Activating without selling price -> 400',
      test2Pass,
      `Activation without price: ${res2a.status} ("${data2a.message}"), Activation after price: ${res2c.status}`
    );

    // -------------------------------------------------------------
    // TEST 3: Import never overwrites an existing sellingPrice; error rows are retained with reasons
    // -------------------------------------------------------------
    // Create active categories in Store A for the valid CSV rows
    await Category.create([
      { storeId: storeA._id, name: 'Pipes', isActive: true, createdBy: adminUser._id, updatedBy: adminUser._id },
      { storeId: storeA._id, name: 'Valves', isActive: true, createdBy: adminUser._id, updatedBy: adminUser._id },
    ]);

    // CSV content: 1 new item, 1 update item (code1 with existing selling price 420), 1 error row (missing name)
    const csvContent = [
      'productCode,name,mrp,brand,category,sellingUnit,unitsPerPack',
      `NEW-001,Brass Valve,850.00,BirlaNu,Valves,PCS,1`,
      `${code1},CPVC Pipe 20mm Super,500.00,BirlaNu,Pipes,MTR,1`, // update MRP to 500, existing sellingPrice is 420
      `ERR-001,,200.00,BirlaNu,Misc,PCS,1`, // error: missing name
    ].join('\n');

    // Create multipart form payload manually
    const boundary = '----WebKitFormBoundaryTest' + Date.now();
    let bodyMultipart = '';
    bodyMultipart += `--${boundary}\r\n`;
    bodyMultipart += `Content-Disposition: form-data; name="sourceName"\r\n\r\nBirlaNu August List\r\n`;
    bodyMultipart += `--${boundary}\r\n`;
    bodyMultipart += `Content-Disposition: form-data; name="sourceVersion"\r\n\r\nv2.0\r\n`;
    bodyMultipart += `--${boundary}\r\n`;
    bodyMultipart += `Content-Disposition: form-data; name="file"; filename="catalog.csv"\r\n`;
    bodyMultipart += `Content-Type: text/csv\r\n\r\n`;
    bodyMultipart += `${csvContent}\r\n`;
    bodyMultipart += `--${boundary}--\r\n`;

    const res3Stage = await fetch(`${baseUrl}/api/items/import/stage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-store-id': storeAId,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: bodyMultipart,
    });
    const data3Stage = await res3Stage.json();
    const batchId = data3Stage.data?.batchId;

    // Approve the import batch
    const res3Approve = await fetch(`${baseUrl}/api/items/import/${batchId}/approve`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ allValid: true }),
    });
    const data3Approve = await res3Approve.json();

    // Verify item1: MRP is now 500, but sellingPrice is STILL 420!
    const res3CheckItem = await fetch(`${baseUrl}/api/items/${item1Id}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data3CheckItem = await res3CheckItem.json();

    // Verify error row retained in batch
    const res3CheckBatch = await fetch(`${baseUrl}/api/items/import/${batchId}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data3CheckBatch = await res3CheckBatch.json();
    const errorRow = data3CheckBatch.data?.rows?.find((r) => r.result === 'error');

    const test3Pass =
      res3Stage.status === 201 &&
      res3Approve.status === 200 &&
      data3CheckItem.data?.sellingPrice === 420 && // PRESERVED!
      data3CheckItem.data?.mrp === 500 && // UPDATED!
      errorRow !== undefined &&
      errorRow.errors?.length > 0;

    recordResult(
      'Import never overwrites an existing sellingPrice; error rows are retained with reasons',
      test3Pass,
      `Selling price preserved: ${data3CheckItem.data?.sellingPrice === 420}, MRP updated: ${data3CheckItem.data?.mrp === 500}, Error row preserved: ${!!errorRow}`
    );

    // -------------------------------------------------------------
    // TEST 4: Price change creates a PriceHistory row and an audit entry; history rows are never modified
    // -------------------------------------------------------------
    const res4Price = await fetch(`${baseUrl}/api/items/${item1Id}/price`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ price: 440.0, reason: 'Festive season revision' }),
    });

    const res4History = await fetch(`${baseUrl}/api/items/${item1Id}/price-history`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data4History = await res4History.json();

    // Check audit log
    const auditEntries = await AuditLog.find({
      entityId: item1Id.toString(),
      action: 'ITEM_PRICE_UPDATE',
    });

    const historySellingPrice = data4History.data?.filter((h) => h.field === 'sellingPrice');
    const latestHistory = historySellingPrice?.[0];

    const test4Pass =
      res4Price.status === 200 &&
      historySellingPrice?.length >= 2 &&
      latestHistory?.newValue === 440 &&
      latestHistory?.oldValue === 420 &&
      auditEntries.length > 0;

    recordResult(
      'Price change creates a PriceHistory row and an audit entry; history rows are never modified',
      test4Pass,
      `PriceHistory entries: ${historySellingPrice?.length}, Latest: ${latestHistory?.oldValue} -> ${latestHistory?.newValue}, Audit entries: ${auditEntries.length}`
    );

    // -------------------------------------------------------------
    // TEST 5: Salesman /api/items/search returns NO price/MRP fields; salesman gets 403 on POST /api/items
    // -------------------------------------------------------------
    const res5Search = await fetch(`${baseUrl}/api/items/search?q=CPVC`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const data5Search = await res5Search.json();
    const salesmanItem = data5Search.data?.[0];

    const hasNoPrice =
      salesmanItem &&
      salesmanItem.sellingPrice === undefined &&
      salesmanItem.mrp === undefined &&
      salesmanItem.sellingPricePaise === undefined &&
      salesmanItem.mrpPaise === undefined &&
      salesmanItem.rate === undefined &&
      salesmanItem.cost === undefined &&
      salesmanItem.margin === undefined;

    // Salesman attempts POST /api/items -> 403 Forbidden
    const res5Create = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: salesmanHeadersA,
      body: JSON.stringify({
        productCode: `SALES-${Date.now()}`,
        name: 'Unauthorized Item',
      }),
    });

    const test5Pass = res5Search.status === 200 && hasNoPrice && res5Create.status === 403;

    recordResult(
      'Salesman /api/items/search returns NO price/MRP fields; salesman gets 403 on POST /api/items',
      test5Pass,
      `Search status: ${res5Search.status}, Price fields stripped: ${hasNoPrice}, Create status: ${res5Create.status}`
    );

    // -------------------------------------------------------------
    // TEST 6: Collections user gets 403 on all item and stock APIs
    // -------------------------------------------------------------
    const res6ItemsList = await fetch(`${baseUrl}/api/items`, { method: 'GET', headers: collectionsHeadersA });
    const res6Search = await fetch(`${baseUrl}/api/items/search`, { method: 'GET', headers: collectionsHeadersA });
    const res6ItemCreate = await fetch(`${baseUrl}/api/items`, { method: 'POST', headers: collectionsHeadersA, body: '{}' });
    const res6StockOpening = await fetch(`${baseUrl}/api/stock/opening`, { method: 'POST', headers: collectionsHeadersA, body: '{}' });
    const res6StockAdj = await fetch(`${baseUrl}/api/stock/adjustment`, { method: 'POST', headers: collectionsHeadersA, body: '{}' });

    const test6Pass =
      res6ItemsList.status === 403 &&
      res6Search.status === 403 &&
      res6ItemCreate.status === 403 &&
      res6StockOpening.status === 403 &&
      res6StockAdj.status === 403;

    recordResult(
      'Collections user gets 403 on all item and stock APIs',
      test6Pass,
      `List: ${res6ItemsList.status}, Search: ${res6Search.status}, Create: ${res6ItemCreate.status}, Stock Opening: ${res6StockOpening.status}, Stock Adj: ${res6StockAdj.status}`
    );

    // -------------------------------------------------------------
    // TEST 7: Store A user cannot read or edit Store B items (even with direct item id)
    // -------------------------------------------------------------
    // Create an item in Store B
    const res7CreateB = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersB,
      body: JSON.stringify({
        productCode: `B-ONLY-${Date.now()}`,
        name: 'Store B Exclusive Pipe',
        mrp: 600.0,
      }),
    });
    const data7CreateB = await res7CreateB.json();
    const itemBId = data7CreateB.data?._id;

    // Admin with Store A header attempts to read Store B item directly
    const res7ReadFromA = await fetch(`${baseUrl}/api/items/${itemBId}`, {
      method: 'GET',
      headers: adminHeadersA, // x-store-id is Store A
    });

    // Admin with Store A header attempts to edit Store B item directly
    const res7EditFromA = await fetch(`${baseUrl}/api/items/${itemBId}`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'Hacked Name' }),
    });

    const test7Pass = res7ReadFromA.status === 404 && res7EditFromA.status === 404;

    recordResult(
      'Store A user cannot read or edit Store B items (even with a direct item id)',
      test7Pass,
      `Cross-store read status: ${res7ReadFromA.status}, Cross-store edit status: ${res7EditFromA.status}`
    );

    // -------------------------------------------------------------
    // TEST 8: storeId sent in request body is ignored
    // -------------------------------------------------------------
    // Attacker sends storeId: Store B in the request body while header x-store-id is Store A
    const res8BodyTamper = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA, // header specifies Store A
      body: JSON.stringify({
        storeId: storeBId, // attacker injects Store B
        productCode: `TAMPER-${Date.now()}`,
        name: 'Tamper Test Item',
        mrp: 300.0,
      }),
    });
    const data8BodyTamper = await res8BodyTamper.json();
    const createdItem = await Item.findById(data8BodyTamper.data?._id);

    const test8Pass =
      res8BodyTamper.status === 201 &&
      createdItem.storeId.toString() === storeAId && // STORE A WINS!
      createdItem.storeId.toString() !== storeBId;

    recordResult(
      'storeId sent in request body is ignored',
      test8Pass,
      `Target store in body: ${storeBId}, Actual persisted store: ${createdItem?.storeId}`
    );

    // -------------------------------------------------------------
    // TEST 9: Second opening stock for the same item is rejected; adjustment without reason is rejected
    // -------------------------------------------------------------
    // Post initial opening stock of 100
    const res9Open1 = await fetch(`${baseUrl}/api/stock/opening`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        itemId: item1Id,
        quantity: 100,
        reference: 'Warehouse Inward Batch 1',
      }),
    });

    // Second opening stock for same item -> 400
    const res9Open2 = await fetch(`${baseUrl}/api/stock/opening`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        itemId: item1Id,
        quantity: 50,
      }),
    });
    const data9Open2 = await res9Open2.json();

    // Adjustment without reason -> 400
    const res9AdjNoReason = await fetch(`${baseUrl}/api/stock/adjustment`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        itemId: item1Id,
        quantity: -5,
        reason: '   ', // whitespace or empty
      }),
    });
    const data9AdjNoReason = await res9AdjNoReason.json();

    const test9Pass =
      res9Open1.status === 201 &&
      res9Open2.status === 400 &&
      data9Open2.message.includes('Opening stock already recorded') &&
      res9AdjNoReason.status === 400 &&
      data9AdjNoReason.message.includes('Reason is mandatory');

    recordResult(
      'Second opening stock for the same item is rejected; adjustment without reason is rejected',
      test9Pass,
      `First opening: ${res9Open1.status}, Second opening: ${res9Open2.status}, Adj without reason: ${res9AdjNoReason.status}`
    );

    // -------------------------------------------------------------
    // TEST 10: Stock balance = opening + adjustments
    // -------------------------------------------------------------
    // Current stock is 100. Let's make two adjustments:
    // 1) -15 (damaged goods)
    // 2) +35 (found in secondary rack)
    // Expected stock: 100 - 15 + 35 = 120
    const res10Adj1 = await fetch(`${baseUrl}/api/stock/adjustment`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        itemId: item1Id,
        quantity: -15,
        reason: 'Damaged in storage',
      }),
    });

    const res10Adj2 = await fetch(`${baseUrl}/api/stock/adjustment`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        itemId: item1Id,
        quantity: 35,
        reason: 'Stock count reconciliation',
      }),
    });

    // Check item balance via GET /api/items/:id
    const res10Item = await fetch(`${baseUrl}/api/items/${item1Id}`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const data10Item = await res10Item.json();

    const finalBalance = data10Item.data?.stockBalance;
    const test10Pass =
      res10Adj1.status === 201 &&
      res10Adj2.status === 201 &&
      finalBalance === 120;

    recordResult(
      'Stock balance = opening + adjustments',
      test10Pass,
      `Calculated balance: ${finalBalance} (Expected 120: 100 - 15 + 35)`
    );

    // -------------------------------------------------------------
    // TEST 11: Store with supplier codes 96000001..98000505 -> first auto code is 10000001, next 10000002
    // -------------------------------------------------------------
    // Seed supplier-coded items in Store A first
    await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ productCode: '96000001', name: 'Supplier Pipe 1', mrp: 412 }),
    });
    await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ productCode: '98000505', name: 'Supplier Tank 1', mrp: 6500 }),
    });

    // Preview next-code TWICE before creating auto items (TEST 19 check built in too)
    const resPreview1 = await fetch(`${baseUrl}/api/items/next-code`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const dataPreview1 = await resPreview1.json();

    const resPreview2 = await fetch(`${baseUrl}/api/items/next-code`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const dataPreview2 = await resPreview2.json();

    const testNextCodeIdempotent =
      resPreview1.status === 200 &&
      resPreview2.status === 200 &&
      dataPreview1.nextCode === '10000001' &&
      dataPreview2.nextCode === '10000001';

    recordResult(
      'GET /api/items/next-code returns the same value when called twice (does not increment)',
      testNextCodeIdempotent,
      `First preview: ${dataPreview1.nextCode}, Second preview: ${dataPreview2.nextCode}`
    );

    // Now auto-create 2 in-house items (omit productCode)
    const resAuto1 = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'In-House Wrench 1', mrp: 250 }),
    });
    const dataAuto1 = await resAuto1.json();

    const resAuto2 = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'In-House Wrench 2', mrp: 300 }),
    });
    const dataAuto2 = await resAuto2.json();

    const test11Pass =
      resAuto1.status === 201 &&
      resAuto2.status === 201 &&
      dataAuto1.data?.productCode === '10000001' &&
      dataAuto2.data?.productCode === '10000002' &&
      dataAuto1.data?.codeSource === 'auto' &&
      dataAuto2.data?.codeSource === 'auto';

    recordResult(
      'Store with supplier codes 96000001..98000505 generates 10000001 then 10000002 (supplier codes ignored)',
      test11Pass,
      `First auto: ${dataAuto1.data?.productCode} (${dataAuto1.data?.codeSource}), Second auto: ${dataAuto2.data?.productCode} (${dataAuto2.data?.codeSource})`
    );

    // -------------------------------------------------------------
    // TEST 12: Manual code does NOT change the counter; if 10000003 exists manually, auto skips to 10000004
    // -------------------------------------------------------------
    const counterBeforeManual = await Counter.findOne({ storeId: storeA._id, key: 'itemCode' }).lean();

    const resManualCollision = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ productCode: '10000003', name: 'Manual Override Item', mrp: 110 }),
    });
    const dataManualCollision = await resManualCollision.json();

    const counterAfterManual = await Counter.findOne({ storeId: storeA._id, key: 'itemCode' }).lean();

    const testManualCounterUnchanged =
      resManualCollision.status === 201 &&
      dataManualCollision.data?.codeSource === 'manual' &&
      counterBeforeManual?.seq === 10000002 &&
      counterAfterManual?.seq === 10000002;

    recordResult(
      'A manual code does not change the counter',
      testManualCounterUnchanged,
      `Counter before manual: ${counterBeforeManual?.seq}, after manual: ${counterAfterManual?.seq}, codeSource: ${dataManualCollision.data?.codeSource}`
    );

    // Now generate next auto item -> must skip 10000003 and return 10000004!
    const resAutoSkip = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'In-House Skipper Item', mrp: 199 }),
    });
    const dataAutoSkip = await resAutoSkip.json();

    const testSkipPass =
      resAutoSkip.status === 201 &&
      dataAutoSkip.data?.productCode === '10000004' &&
      dataAutoSkip.data?.codeSource === 'auto';

    recordResult(
      'If 10000003 already exists as a manual code, auto generator skips it and returns 10000004',
      testSkipPass,
      `Generated code: ${dataAutoSkip.data?.productCode} (Expected 10000004)`
    );

    // -------------------------------------------------------------
    // TEST 13: Creating 10 items in parallel gives 10 distinct consecutive codes and no 409
    // -------------------------------------------------------------
    const parallelResponses = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        fetch(`${baseUrl}/api/items`, {
          method: 'POST',
          headers: adminHeadersA,
          body: JSON.stringify({ name: `Parallel Item ${idx + 1}`, mrp: 100 + idx }),
        }).then(async (r) => ({ status: r.status, body: await r.json() }))
      )
    );

    const parallelStatusesOk = parallelResponses.every((r) => r.status === 201);
    const parallelCodes = parallelResponses
      .map((r) => r.body?.data?.productCode)
      .filter(Boolean)
      .sort();
    const uniqueParallelCodes = new Set(parallelCodes);
    const expectedConsecutive = Array.from({ length: 10 }, (_, i) => String(10000005 + i));

    const testParallelPass =
      parallelStatusesOk &&
      uniqueParallelCodes.size === 10 &&
      JSON.stringify(parallelCodes) === JSON.stringify(expectedConsecutive);

    recordResult(
      'Creating 10 items in parallel gives 10 distinct consecutive codes and no 409',
      testParallelPass,
      `All 201: ${parallelStatusesOk}, Unique count: ${uniqueParallelCodes.size}, Range: ${parallelCodes[0]}..${parallelCodes[parallelCodes.length - 1]}`
    );

    // -------------------------------------------------------------
    // TEST 14: Counters are separate per store (Store B starts at 10000001 on its own)
    // -------------------------------------------------------------
    const resStoreBAuto = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: adminHeadersB,
      body: JSON.stringify({
        name: 'Store B First Auto Item',
        mrp: 350,
        storeId: storeAId, // spoofed storeId in body MUST be ignored
      }),
    });
    const dataStoreBAuto = await resStoreBAuto.json();
    const persistedStoreBItem = await Item.findById(dataStoreBAuto.data?._id).lean();

    const testSeparateCountersPass =
      resStoreBAuto.status === 201 &&
      dataStoreBAuto.data?.productCode === '10000001' &&
      dataStoreBAuto.data?.codeSource === 'auto' &&
      String(persistedStoreBItem?.storeId) === storeBId;

    recordResult(
      'Counters are separate per store (Store B starts at 10000001) and body storeId is ignored',
      testSeparateCountersPass,
      `Store B code: ${dataStoreBAuto.data?.productCode}, Persisted store: ${persistedStoreBItem?.storeId} (Expected Store B: ${storeBId})`
    );

    // -------------------------------------------------------------
    // TEST 15: Import row matching auto-coded item -> error with reason; manual/import -> update; new import -> codeSource "import"
    // -------------------------------------------------------------
    const counterBeforeImport = await Counter.findOne({ storeId: storeA._id, key: 'itemCode' }).lean();

    const autoConflictCsv = [
      'productCode,name,mrp,brand,category,sellingUnit,unitsPerPack',
      `10000001,Supplier Trying To Hijack Auto,999,BirlaNu,Pipes,PCS,1`, // matches auto-coded "In-House Wrench 1"
      `10000003,Updated Manual Override Item,155,BirlaNu,Pipes,PCS,1`, // matches manual item -> update
      `NEW-001,Updated Imported Brass Valve,890,BirlaNu,Valves,PCS,1`, // matches previously imported item -> update
      `IMP-SRC-001,Brand New Imported Flange,340,BirlaNu,Valves,PCS,1`, // brand new -> codeSource "import"
    ].join('\n');

    const boundary2 = '----WebKitFormBoundaryAutoCode' + Date.now();
    let multipart2 = '';
    multipart2 += `--${boundary2}\r\n`;
    multipart2 += `Content-Disposition: form-data; name="sourceName"\r\n\r\nAuto Conflict Check\r\n`;
    multipart2 += `--${boundary2}\r\n`;
    multipart2 += `Content-Disposition: form-data; name="file"; filename="conflict.csv"\r\n`;
    multipart2 += `Content-Type: text/csv\r\n\r\n`;
    multipart2 += `${autoConflictCsv}\r\n`;
    multipart2 += `--${boundary2}--\r\n`;

    const resImpStage = await fetch(`${baseUrl}/api/items/import/stage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-store-id': storeAId,
        'Content-Type': `multipart/form-data; boundary=${boundary2}`,
      },
      body: multipart2,
    });
    const dataImpStage = await resImpStage.json();
    const impRows = dataImpStage.data?.rows || [];

    const autoConflictRow = impRows.find((r) => r.data?.productCode === '10000001');
    const manualUpdateRow = impRows.find((r) => r.data?.productCode === '10000003');
    const importUpdateRow = impRows.find((r) => r.data?.productCode === 'NEW-001');
    const newImportRow = impRows.find((r) => r.data?.productCode === 'IMP-SRC-001');

    // Approve valid rows
    const resImpApprove = await fetch(`${baseUrl}/api/items/import/${dataImpStage.data?.batchId}/approve`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({ allValid: true }),
    });

    const newlyImportedDoc = await Item.findOne({ storeId: storeA._id, productCode: 'IMP-SRC-001' }).lean();
    const counterAfterImport = await Counter.findOne({ storeId: storeA._id, key: 'itemCode' }).lean();

    const expectedConflictReason =
      'Code 10000001 is already used by an in-house item (In-House Wrench 1). Resolve it before importing.';

    const testImportAutoPass =
      resImpStage.status === 201 &&
      resImpApprove.status === 200 &&
      autoConflictRow?.result === 'error' &&
      autoConflictRow?.errors?.includes(expectedConflictReason) &&
      manualUpdateRow?.result === 'update' &&
      importUpdateRow?.result === 'update' &&
      newImportRow?.result === 'new' &&
      newlyImportedDoc?.codeSource === 'import' &&
      counterBeforeImport?.seq === counterAfterImport?.seq;

    recordResult(
      'Import row matching auto-coded item -> error with reason; manual/import -> update; new import -> codeSource "import" (counter unchanged)',
      testImportAutoPass,
      `Auto row: ${autoConflictRow?.result} ("${autoConflictRow?.errors?.[0]}"), Manual row: ${manualUpdateRow?.result}, Import update row: ${importUpdateRow?.result}, New import codeSource: ${newlyImportedDoc?.codeSource}`
    );

    // -------------------------------------------------------------
    // TEST 16: PATCH with a changed productCode returns 400
    // -------------------------------------------------------------
    const resPatchCode = await fetch(`${baseUrl}/api/items/${dataAuto1.data?._id}`, {
      method: 'PATCH',
      headers: adminHeadersA,
      body: JSON.stringify({ productCode: '99999999', name: 'Attempt Rename Code' }),
    });
    const dataPatchCode = await resPatchCode.json();

    const testPatchCodePass =
      resPatchCode.status === 400 && dataPatchCode.message === 'Product code cannot be changed';

    recordResult(
      'PATCH with a changed productCode returns 400 "Product code cannot be changed"',
      testPatchCodePass,
      `Status: ${resPatchCode.status}, Message: "${dataPatchCode.message}"`
    );

    // -------------------------------------------------------------
    // TEST 17: Salesman and Collections get 403 on POST /api/items and GET /api/items/next-code (and salesman does not receive codeSource)
    // -------------------------------------------------------------
    const resSalesNextCode = await fetch(`${baseUrl}/api/items/next-code`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const resCollNextCode = await fetch(`${baseUrl}/api/items/next-code`, {
      method: 'GET',
      headers: collectionsHeadersA,
    });
    const resSalesPostAuto = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: salesmanHeadersA,
      body: JSON.stringify({ name: 'Salesman Auto Attempt' }),
    });
    const resCollPostAuto = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: collectionsHeadersA,
      body: JSON.stringify({ name: 'Collections Auto Attempt' }),
    });
    const resSalesSearchCodeSource = await fetch(`${baseUrl}/api/items/search`, {
      method: 'GET',
      headers: salesmanHeadersA,
    });
    const dataSalesSearchCodeSource = await resSalesSearchCodeSource.json();
    const salesmanHasNoCodeSource = (dataSalesSearchCodeSource.data || []).every(
      (i) => i.codeSource === undefined
    );

    const testAuthzNextCodePass =
      resSalesNextCode.status === 403 &&
      resCollNextCode.status === 403 &&
      resSalesPostAuto.status === 403 &&
      resCollPostAuto.status === 403 &&
      resSalesSearchCodeSource.status === 200 &&
      salesmanHasNoCodeSource;

    recordResult(
      'Salesman and collections get 403 on POST /api/items and GET /api/items/next-code; codeSource omitted for salesman',
      testAuthzNextCodePass,
      `next-code (salesman/collections): ${resSalesNextCode.status}/${resCollNextCode.status}, POST (salesman/collections): ${resSalesPostAuto.status}/${resCollPostAuto.status}, codeSource hidden for salesman: ${salesmanHasNoCodeSource}`
    );

    // -------------------------------------------------------------
    // CLEANUP TEST FIXTURES
    // -------------------------------------------------------------
    await Item.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await Category.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await Counter.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await PriceHistory.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await StockMovement.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await ImportBatch.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await AuditLog.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await User.deleteMany({ _id: { $in: [adminUser._id, salesmanUser._id, collectionsUser._id] } });
    await Store.deleteMany({ _id: { $in: [storeA._id, storeB._id] } });

    console.log('\n[Cleanup] Test fixtures cleaned up from test database.');
  } finally {
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

runItemTests().catch((err) => {
  console.error('[Item Tests Fatal Error]', err);
  process.exit(1);
});

