import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import app from '../server/app.js';
import connectDB from '../server/config/db.js';
import Store from '../server/models/Store.js';
import User from '../server/models/User.js';
import Customer, { normalizeIndianMobile, isValidGSTIN } from '../server/models/Customer.js';
import CustomerCreditHistory from '../server/models/CustomerCreditHistory.js';
import AuditLog from '../server/models/AuditLog.js';
import Counter from '../server/models/Counter.js';
import { generateToken } from '../server/utils/tokens.js';

async function runCustomerTests() {
  console.log('================================================================');
  console.log('    RetailA2Z - Customer Master & Credit Policy Test Suite      ');
  console.log('================================================================\n');

  const conn = await connectDB();
  console.log(`Connected to test DB: ${conn.connection.name}\n`);

  const TEST_PORT = 5004;
  const server = app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}`;

  const results = [];
  const recordResult = (testName, passed, details = '') => {
    results.push({ testName, passed, details });
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} - ${testName}`);
    if (details) console.log(`   ${details}`);
  };

  let storeA, storeB;
  let adminUser, salesmanUser, collectionsUser;

  try {
    const ts = Date.now();

    // 1. Fixture: Store A & Store B
    storeA = await Store.create({
      name: 'Customer Test Store A',
      storeCode: `CUST-A-${ts}`,
      address: { line1: 'Main St', city: 'Mumbai', state: 'MH', pincode: '400001' },
      isActive: true,
    });

    storeB = await Store.create({
      name: 'Customer Test Store B',
      storeCode: `CUST-B-${ts}`,
      address: { line1: 'Branch Rd', city: 'Pune', state: 'MH', pincode: '411001' },
      isActive: true,
    });

    const storeAId = storeA._id.toString();
    const storeBId = storeB._id.toString();

    // 2. Fixture: Users (Admin, Salesman, Collections)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash('Secret@123', salt);

    adminUser = await User.create({
      name: 'Cust Test Admin',
      email: `cust_admin_${ts}@test.com`,
      mobile: `91${ts.toString().slice(-8)}`,
      passwordHash,
      role: 'admin',
      storeIds: [storeA._id, storeB._id],
      isActive: true,
    });

    salesmanUser = await User.create({
      name: 'Cust Test Salesman',
      email: `cust_salesman_${ts}@test.com`,
      mobile: `92${ts.toString().slice(-8)}`,
      passwordHash,
      role: 'salesman',
      storeIds: [storeA._id],
      isActive: true,
    });

    collectionsUser = await User.create({
      name: 'Cust Test Collections',
      email: `cust_collections_${ts}@test.com`,
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

    // Ensure clean state for customer code counters
    await Counter.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });

    // -------------------------------------------------------------
    // TEST 1: Mobile normalization helper & customer creation
    // -------------------------------------------------------------
    // Verifies: spaces, dashes, +91, leading 0 stripped to 10-digit normalized_mobile
    const norm1 = normalizeIndianMobile('+91 98201-12233');
    const norm2 = normalizeIndianMobile('09820112233');
    const norm3 = normalizeIndianMobile('919820112233');
    const norm4 = normalizeIndianMobile('98201 12233');
    const norm5 = normalizeIndianMobile('+91(98201)12233');

    const normalizationHelperPass =
      norm1.normalizedMobile === '9820112233' &&
      norm1.isValid &&
      norm2.normalizedMobile === '9820112233' &&
      norm2.isValid &&
      norm3.normalizedMobile === '9820112233' &&
      norm3.isValid &&
      norm4.normalizedMobile === '9820112233' &&
      norm4.isValid &&
      norm5.normalizedMobile === '9820112233' &&
      norm5.isValid;

    // Create customer via API with raw mobile "+91 98201-12233"
    const resCreateCust1 = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Ramesh Sharma',
        mobile: '+91 98201-12233',
        locality: 'Andheri West',
      }),
    });
    const dataCreateCust1 = await resCreateCust1.json();
    const cust1 = dataCreateCust1.data;

    const test1Pass =
      normalizationHelperPass &&
      resCreateCust1.status === 201 &&
      cust1.mobile === '+91 98201-12233' &&
      cust1.normalized_mobile === '9820112233' &&
      cust1.credit_terms_label === 'No credit';

    recordResult(
      'Mobile normalization: raw stored as entered AND normalized_mobile has 10 digits',
      test1Pass,
      `Helper pass: ${normalizationHelperPass}, Status: ${resCreateCust1.status}, Raw: "${cust1?.mobile}", Normalized: "${cust1?.normalized_mobile}"`
    );

    // -------------------------------------------------------------
    // TEST 2: Invalid mobile validation returns 400
    // -------------------------------------------------------------
    const resInvalidMobile = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Invalid Mobile User',
        mobile: '12345ABCDE',
      }),
    });
    const dataInvalidMobile = await resInvalidMobile.json();

    const test2Pass =
      resInvalidMobile.status === 400 &&
      dataInvalidMobile.message.includes('valid 10-digit mobile number');

    recordResult(
      'Invalid mobile rejects with 400 "Enter a valid 10-digit mobile number"',
      test2Pass,
      `Status: ${resInvalidMobile.status}, Message: "${dataInvalidMobile.message}"`
    );

    // -------------------------------------------------------------
    // TEST 3: Duplicate mobile warning without confirmation flag
    // -------------------------------------------------------------
    // Try to create another customer in Store A with different format of same mobile
    const resDupWarn = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Ramesh Sharma Duplicate',
        mobile: '09820112233', // normalized to 9820112233
        locality: 'Andheri East',
      }),
    });
    const dataDupWarn = await resDupWarn.json();

    const test3Pass =
      resDupWarn.status === 409 &&
      dataDupWarn.warning === 'DUPLICATE_MOBILE' &&
      Array.isArray(dataDupWarn.duplicates) &&
      dataDupWarn.duplicates.length === 1 &&
      dataDupWarn.duplicates[0].name === 'Ramesh Sharma';

    recordResult(
      'Duplicate mobile without confirmation returns 409 DUPLICATE_MOBILE warning with existing customer',
      test3Pass,
      `Status: ${resDupWarn.status}, Warning: ${dataDupWarn.warning}, Duplicates count: ${dataDupWarn.duplicates?.length}`
    );

    // -------------------------------------------------------------
    // TEST 4: Duplicate mobile with explicit confirmation flag creates customer
    // -------------------------------------------------------------
    const resDupConfirm = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Ramesh Sharma Brother',
        mobile: '09820112233',
        locality: 'Andheri East',
        confirmDuplicate: true,
      }),
    });
    const dataDupConfirm = await resDupConfirm.json();
    const cust1Dup = dataDupConfirm.data;

    const test4Pass =
      resDupConfirm.status === 201 &&
      cust1Dup.name === 'Ramesh Sharma Brother' &&
      cust1Dup.normalized_mobile === '9820112233';

    recordResult(
      'Duplicate mobile with confirmDuplicate=true creates successfully (shared number allowed)',
      test4Pass,
      `Status: ${resDupConfirm.status}, Created ID: ${cust1Dup?.id}, Name: ${cust1Dup?.name}`
    );

    // -------------------------------------------------------------
    // TEST 5: Sales staff creates basic customer; credit fields forced to "No credit"
    // -------------------------------------------------------------
    // Salesman attempts to create customer with credit_enabled: true and credit_limit: 50000
    const resSalesmanCreate = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: salesmanHeadersA,
      body: JSON.stringify({
        name: 'Pooja Patel',
        mobile: '9820223344',
        locality: 'Borivali East',
        credit_enabled: true,
        credit_limit: 50000,
        credit_days: 30,
      }),
    });
    const dataSalesmanCreate = await resSalesmanCreate.json();
    const salesCust = dataSalesmanCreate.data;

    const test5Pass =
      resSalesmanCreate.status === 201 &&
      salesCust.credit_enabled === false &&
      salesCust.credit_limit === 0 &&
      salesCust.credit_days === null &&
      salesCust.credit_terms_label === 'No credit';

    recordResult(
      'Sales staff can create basic customer, but server forces credit fields to "No credit"',
      test5Pass,
      `Status: ${resSalesmanCreate.status}, credit_enabled: ${salesCust?.credit_enabled}, credit_limit: ${salesCust?.credit_limit}, credit_terms_label: "${salesCust?.credit_terms_label}"`
    );

    // -------------------------------------------------------------
    // TEST 6: Sales staff gets 403 on PUT /customers/:id/credit-terms
    // -------------------------------------------------------------
    const resSalesmanCreditTerms = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/credit-terms`,
      {
        method: 'PUT',
        headers: salesmanHeadersA,
        body: JSON.stringify({
          credit_enabled: true,
          credit_limit: 25000,
          credit_days: 15,
        }),
      }
    );

    const test6Pass = resSalesmanCreditTerms.status === 403;

    recordResult(
      'Sales staff gets 403 Forbidden on PUT /customers/:id/credit-terms',
      test6Pass,
      `Status: ${resSalesmanCreditTerms.status} (Expected 403)`
    );

    // -------------------------------------------------------------
    // TEST 7: Store Admin updates credit terms (credit_enabled=true, credit_limit, credit_days)
    // -------------------------------------------------------------
    const resAdminCreditTerms = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/credit-terms`,
      {
        method: 'PUT',
        headers: adminHeadersA,
        body: JSON.stringify({
          credit_enabled: true,
          credit_limit: 75000.5,
          credit_days: 30,
          reason: 'Approved credit terms after verification',
        }),
      }
    );
    const dataAdminCreditTerms = await resAdminCreditTerms.json();
    const updatedCust = dataAdminCreditTerms.data;

    const test7Pass =
      resAdminCreditTerms.status === 200 &&
      updatedCust.credit_enabled === true &&
      updatedCust.credit_limit === 75000.5 &&
      updatedCust.credit_days === 30 &&
      updatedCust.credit_terms_label === '30 days';

    recordResult(
      'Store Admin updates credit terms: label becomes "30 days", credit_limit=75000.5',
      test7Pass,
      `Status: ${resAdminCreditTerms.status}, credit_enabled: ${updatedCust?.credit_enabled}, limit: ${updatedCust?.credit_limit}, label: "${updatedCust?.credit_terms_label}"`
    );

    // -------------------------------------------------------------
    // TEST 8: Customer credit history and AuditLog recorded
    // -------------------------------------------------------------
    const historyEntries = await CustomerCreditHistory.find({
      customerId: salesCust.id,
    }).lean();

    const auditEntries = await AuditLog.find({
      entityId: String(salesCust.id),
      action: 'CUSTOMER_CREDIT_TERMS_UPDATE',
    }).lean();

    const resHistoryApi = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/credit-history`,
      {
        method: 'GET',
        headers: adminHeadersA,
      }
    );
    const dataHistoryApi = await resHistoryApi.json();

    const test8Pass =
      historyEntries.length >= 1 &&
      historyEntries[0].oldCreditEnabled === false &&
      historyEntries[0].newCreditEnabled === true &&
      historyEntries[0].newCreditDays === 30 &&
      auditEntries.length >= 1 &&
      resHistoryApi.status === 200 &&
      dataHistoryApi.data.length >= 1 &&
      dataHistoryApi.data[0].new_credit_terms_label !== 'dummy';

    recordResult(
      'Credit terms change writes CustomerCreditHistory and AuditLog; GET /:id/credit-history returns list',
      test8Pass,
      `History DB count: ${historyEntries.length}, Audit count: ${auditEntries.length}, API status: ${resHistoryApi.status}, API entries: ${dataHistoryApi.data?.length}`
    );

    // -------------------------------------------------------------
    // TEST 9: credit_enabled=false clears credit_limit and credit_days
    // -------------------------------------------------------------
    const resDisableCredit = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/credit-terms`,
      {
        method: 'PUT',
        headers: adminHeadersA,
        body: JSON.stringify({
          credit_enabled: false,
          reason: 'Revoking credit due to policy change',
        }),
      }
    );
    const dataDisableCredit = await resDisableCredit.json();
    const disabledCust = dataDisableCredit.data;

    const secondHistory = await CustomerCreditHistory.find({
      customerId: salesCust.id,
    })
      .sort({ changedAt: -1 })
      .lean();

    const test9Pass =
      resDisableCredit.status === 200 &&
      disabledCust.credit_enabled === false &&
      disabledCust.credit_limit === 0 &&
      disabledCust.credit_days === null &&
      disabledCust.credit_terms_label === 'No credit' &&
      secondHistory[0].newCreditEnabled === false &&
      secondHistory[0].newCreditLimitPaise === null &&
      secondHistory[0].newCreditDays === null;

    recordResult(
      'credit_enabled=false clears credit_limit & credit_days; label returns "No credit"',
      test9Pass,
      `Status: ${resDisableCredit.status}, credit_limit: ${disabledCust?.credit_limit}, credit_days: ${disabledCust?.credit_days}, label: "${disabledCust?.credit_terms_label}"`
    );

    // -------------------------------------------------------------
    // TEST 10: Store isolation - Store A user cannot read or edit Store B customer (direct ID)
    // -------------------------------------------------------------
    // Create customer in Store B
    const resCreateStoreB = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersB, // Store B
      body: JSON.stringify({
        name: 'Store B Exclusive Customer',
        mobile: '9820998877',
        locality: 'Pune Camp',
      }),
    });
    const dataCreateStoreB = await resCreateStoreB.json();
    const storeBCustId = dataCreateStoreB.data?.id;

    // Admin with Store A header attempts to read Store B customer
    const resReadFromA = await fetch(`${baseUrl}/api/customers/${storeBCustId}`, {
      method: 'GET',
      headers: adminHeadersA, // x-store-id is Store A
    });
    const dataReadFromA = await resReadFromA.json();

    // Admin with Store A header attempts to edit Store B customer
    const resEditFromA = await fetch(`${baseUrl}/api/customers/${storeBCustId}`, {
      method: 'PUT',
      headers: adminHeadersA,
      body: JSON.stringify({ name: 'Tampered Customer Name' }),
    });

    const isDeniedRead = resReadFromA.status === 403 || resReadFromA.status === 404;
    const isDeniedEdit = resEditFromA.status === 403 || resEditFromA.status === 404;
    const noDataLeaked = !dataReadFromA.data;

    const test10Pass = isDeniedRead && isDeniedEdit && noDataLeaked;

    recordResult(
      'Store isolation: Cross-store direct ID access is denied with NO data leak',
      test10Pass,
      `Read status: ${resReadFromA.status}, Edit status: ${resEditFromA.status}, Data leaked: ${!noDataLeaked}`
    );

    // -------------------------------------------------------------
    // TEST 11: storeId sent in request body is ignored
    // -------------------------------------------------------------
    const resBodyStoreTamper = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Store Tamper Check Customer',
        mobile: '9820776655',
        store_id: storeBId, // Maliciously sending Store B in body
        storeId: storeBId,
      }),
    });
    const dataBodyStoreTamper = await resBodyStoreTamper.json();
    const persistedTamperCust = await Customer.findById(
      dataBodyStoreTamper.data?.id
    ).lean();

    const test11Pass =
      resBodyStoreTamper.status === 201 &&
      String(persistedTamperCust.storeId) === storeAId;

    recordResult(
      'storeId sent in request body is ignored; customer persisted to header storeId',
      test11Pass,
      `Status: ${resBodyStoreTamper.status}, Body store: ${storeBId}, Persisted store: ${persistedTamperCust?.storeId} (Expected Store A: ${storeAId})`
    );

    // -------------------------------------------------------------
    // TEST 12: Directory list / search, filters, overdue_only accepted
    // -------------------------------------------------------------
    // Search by name "Pooja"
    const resSearchName = await fetch(`${baseUrl}/api/customers?search=Pooja`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const dataSearchName = await resSearchName.json();

    // Filter by is_active=true
    const resActiveFilter = await fetch(`${baseUrl}/api/customers?is_active=true`, {
      method: 'GET',
      headers: adminHeadersA,
    });
    const dataActiveFilter = await resActiveFilter.json();

    // Filter by overdue_only=true (placeholder wired for future invoice logic)
    const resOverdueFilter = await fetch(
      `${baseUrl}/api/customers?overdue_only=true`,
      {
        method: 'GET',
        headers: adminHeadersA,
      }
    );
    const dataOverdueFilter = await resOverdueFilter.json();

    // Verify directory fields present in list items
    const sampleItem = dataActiveFilter.data?.[0];
    const hasDirectoryFields =
      sampleItem &&
      'name' in sampleItem &&
      'mobile' in sampleItem &&
      'locality' in sampleItem &&
      'credit_terms_label' in sampleItem &&
      'credit_limit' in sampleItem &&
      'outstanding_amount' in sampleItem &&
      'overdue_amount' in sampleItem &&
      'oldest_overdue_days' in sampleItem &&
      'is_active' in sampleItem;

    const test12Pass =
      resSearchName.status === 200 &&
      dataSearchName.data.some((c) => c.name.includes('Pooja')) &&
      resActiveFilter.status === 200 &&
      hasDirectoryFields &&
      sampleItem.outstanding_amount === 0 &&
      sampleItem.overdue_amount === 0 &&
      sampleItem.oldest_overdue_days === 0 &&
      resOverdueFilter.status === 200 &&
      dataOverdueFilter.data.length === 0;

    recordResult(
      'Directory listing: search, filters, directory fields, and overdue_only=true accepted',
      test12Pass,
      `Search status: ${resSearchName.status}, Matched: ${dataSearchName.data?.length}, Has directory fields: ${hasDirectoryFields}, Overdue list count: ${dataOverdueFilter.data?.length}`
    );

    // -------------------------------------------------------------
    // TEST 13: Customer lookup endpoint (/customers/lookup?mobile=)
    // -------------------------------------------------------------
    const resLookupPartial = await fetch(
      `${baseUrl}/api/customers/lookup?mobile=9820`,
      {
        method: 'GET',
        headers: salesmanHeadersA,
      }
    );
    const dataLookupPartial = await resLookupPartial.json();

    const resLookupExact = await fetch(
      `${baseUrl}/api/customers/lookup?mobile=9820223344`,
      {
        method: 'GET',
        headers: salesmanHeadersA,
      }
    );
    const dataLookupExact = await resLookupExact.json();

    const test13Pass =
      resLookupPartial.status === 200 &&
      dataLookupPartial.data.length >= 2 &&
      resLookupExact.status === 200 &&
      dataLookupExact.data.length >= 1 &&
      dataLookupExact.data[0].normalized_mobile === '9820223344';

    recordResult(
      'Customer lookup endpoint (/customers/lookup?mobile=) returns partial and exact suggestions',
      test13Pass,
      `Partial count: ${dataLookupPartial.data?.length}, Exact match: ${dataLookupExact.data?.[0]?.name}`
    );

    // -------------------------------------------------------------
    // TEST 14: Soft deactivate/activate (PATCH /customers/:id/status)
    // -------------------------------------------------------------
    const resDeactivate = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/status`,
      {
        method: 'PATCH',
        headers: adminHeadersA,
        body: JSON.stringify({ is_active: false }),
      }
    );
    const dataDeactivate = await resDeactivate.json();

    const deactAudit = await AuditLog.findOne({
      entityId: String(salesCust.id),
      action: 'CUSTOMER_DEACTIVATE',
    });

    const test14Pass =
      resDeactivate.status === 200 &&
      dataDeactivate.data?.is_active === false &&
      Boolean(deactAudit);

    recordResult(
      'Soft deactivate (PATCH /:id/status): is_active=false, audit logged, never hard deleted',
      test14Pass,
      `Status: ${resDeactivate.status}, is_active: ${dataDeactivate.data?.is_active}, Audit action: ${deactAudit?.action}`
    );

    // -------------------------------------------------------------
    // TEST 15: Collections staff permissions
    // -------------------------------------------------------------
    // Collections staff: can view list, detail, lookup, credit history; CANNOT create or update
    const resCollList = await fetch(`${baseUrl}/api/customers`, {
      method: 'GET',
      headers: collectionsHeadersA,
    });
    const resCollDetail = await fetch(`${baseUrl}/api/customers/${salesCust.id}`, {
      method: 'GET',
      headers: collectionsHeadersA,
    });
    const resCollHist = await fetch(
      `${baseUrl}/api/customers/${salesCust.id}/credit-history`,
      {
        method: 'GET',
        headers: collectionsHeadersA,
      }
    );
    const resCollCreate = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: collectionsHeadersA,
      body: JSON.stringify({ name: 'Coll Customer', mobile: '9820667788' }),
    });
    const resCollEdit = await fetch(`${baseUrl}/api/customers/${salesCust.id}`, {
      method: 'PUT',
      headers: collectionsHeadersA,
      body: JSON.stringify({ name: 'Coll Hack' }),
    });

    const test15Pass =
      resCollList.status === 200 &&
      resCollDetail.status === 200 &&
      resCollHist.status === 200 &&
      resCollCreate.status === 403 &&
      resCollEdit.status === 403;

    recordResult(
      'Collections staff permissions: can view list/detail/credit ledger; gets 403 on create/edit',
      test15Pass,
      `List: ${resCollList.status}, Detail: ${resCollDetail.status}, History: ${resCollHist.status}, Create: ${resCollCreate.status}, Edit: ${resCollEdit.status}`
    );

    // -------------------------------------------------------------
    // TEST 16: GSTIN format validation
    // -------------------------------------------------------------
    const validGst = isValidGSTIN('27AAAAA0000A1Z5');
    const invalidGst = isValidGSTIN('INVALID_GST_123');

    const resGstValid = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'GST Valid Business',
        mobile: '9820881122',
        gst_number: '27AAAAA0000A1Z5',
      }),
    });

    const resGstInvalid = await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'GST Invalid Business',
        mobile: '9820881133',
        gst_number: 'INVALID_GST_FORMAT',
      }),
    });

    const test16Pass =
      validGst === true &&
      invalidGst === false &&
      resGstValid.status === 201 &&
      resGstInvalid.status === 400;

    recordResult(
      'GSTIN format validation: valid 15-char GSTIN accepted (201), invalid rejected (400)',
      test16Pass,
      `Valid GST: ${validGst} (res: ${resGstValid.status}), Invalid GST: ${invalidGst} (res: ${resGstInvalid.status})`
    );

    // -------------------------------------------------------------
    // TEST 17: Update customer with duplicate mobile returns 409 DUPLICATE_MOBILE warning
    // -------------------------------------------------------------
    // Try to update GST Valid Business customer's mobile to Ramesh Sharma's mobile (9820112233)
    const validGstCustId = (await resGstValid.json()).data?.id;
    const resUpdateDupWarn = await fetch(`${baseUrl}/api/customers/${validGstCustId}`, {
      method: 'PUT',
      headers: adminHeadersA,
      body: JSON.stringify({
        mobile: '09820112233', // Matches Ramesh Sharma
      }),
    });
    const dataUpdateDupWarn = await resUpdateDupWarn.json();

    const test17Pass =
      resUpdateDupWarn.status === 409 &&
      dataUpdateDupWarn.warning === 'DUPLICATE_MOBILE' &&
      Array.isArray(dataUpdateDupWarn.duplicates) &&
      dataUpdateDupWarn.duplicates.some((d) => d.name === 'Ramesh Sharma');

    recordResult(
      'Update customer with duplicate mobile without confirm returns 409 DUPLICATE_MOBILE',
      test17Pass,
      `Status: ${resUpdateDupWarn.status}, Warning: ${dataUpdateDupWarn.warning}, Matched duplicate: ${dataUpdateDupWarn.duplicates?.[0]?.name}`
    );

    // -------------------------------------------------------------
    // TEST 18: Update customer with duplicate mobile and confirmDuplicate=true succeeds
    // -------------------------------------------------------------
    const resUpdateDupConfirm = await fetch(`${baseUrl}/api/customers/${validGstCustId}`, {
      method: 'PUT',
      headers: adminHeadersA,
      body: JSON.stringify({
        mobile: '09820112233',
        confirmDuplicate: true,
      }),
    });
    const dataUpdateDupConfirm = await resUpdateDupConfirm.json();

    const test18Pass =
      resUpdateDupConfirm.status === 200 &&
      dataUpdateDupConfirm.data?.normalized_mobile === '9820112233';

    recordResult(
      'Update customer with duplicate mobile and confirmDuplicate=true succeeds (200)',
      test18Pass,
      `Status: ${resUpdateDupConfirm.status}, Updated mobile: ${dataUpdateDupConfirm.data?.normalized_mobile}`
    );

    // -------------------------------------------------------------
    // TEST 19: Search matches across Business Name and GST Number
    // -------------------------------------------------------------
    // Create customer with unique business name
    await fetch(`${baseUrl}/api/customers`, {
      method: 'POST',
      headers: adminHeadersA,
      body: JSON.stringify({
        name: 'Omkar Enterprise Owner',
        business_name: 'Omkar Electronics & Spares',
        mobile: '9820993322',
        gst_number: '27BBBBB1111B1Z9',
      }),
    });

    const resSearchBiz = await fetch(
      `${baseUrl}/api/customers?search=Electronics`,
      {
        method: 'GET',
        headers: adminHeadersA,
      }
    );
    const dataSearchBiz = await resSearchBiz.json();

    const resSearchGst = await fetch(
      `${baseUrl}/api/customers?search=27BBBBB1111`,
      {
        method: 'GET',
        headers: adminHeadersA,
      }
    );
    const dataSearchGst = await resSearchGst.json();

    const test19Pass =
      resSearchBiz.status === 200 &&
      dataSearchBiz.data.some((c) => c.business_name.includes('Electronics')) &&
      resSearchGst.status === 200 &&
      dataSearchGst.data.some((c) => c.gst_number.includes('27BBBBB1111B1Z9'));

    recordResult(
      'Directory search matches across Business Name and GST Number in addition to Name & Mobile',
      test19Pass,
      `Search Biz count: ${dataSearchBiz.data?.length}, Search GST count: ${dataSearchGst.data?.length}`
    );

    // -------------------------------------------------------------
    // TEST 20: Auto-generated Customer Code (CUS-00001 format) & search
    // -------------------------------------------------------------
    const resSearchCode = await fetch(
      `${baseUrl}/api/customers?search=CUS-00001`,
      {
        method: 'GET',
        headers: adminHeadersA,
      }
    );
    const dataSearchCode = await resSearchCode.json();

    const test20Pass =
      cust1.customer_code === 'CUS-00001' &&
      resSearchCode.status === 200 &&
      dataSearchCode.data.some((c) => c.customer_code === 'CUS-00001');

    recordResult(
      'Auto-generated customerCode in CUS-00001 format is assigned and searchable',
      test20Pass,
      `Initial customer code: "${cust1.customer_code}", Search match: ${dataSearchCode.data?.[0]?.customer_code}`
    );

    // -------------------------------------------------------------
    // CLEANUP FIXTURES
    // -------------------------------------------------------------
    await Customer.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await CustomerCreditHistory.deleteMany({
      storeId: { $in: [storeA._id, storeB._id] },
    });
    await Counter.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await AuditLog.deleteMany({ storeId: { $in: [storeA._id, storeB._id] } });
    await User.deleteMany({
      _id: { $in: [adminUser._id, salesmanUser._id, collectionsUser._id] },
    });
    await Store.deleteMany({ _id: { $in: [storeA._id, storeB._id] } });

    console.log('\n[Cleanup] Customer test fixtures cleaned up from test database.');
  } finally {
    server.close();
    await mongoose.disconnect();
  }

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log('\n================================================================');
  console.log(`Summary: ${passedCount}/${totalCount} tests passed.`);
  console.log('================================================================\n');

  if (passedCount !== totalCount) {
    process.exit(1);
  }
}

runCustomerTests().catch((err) => {
  console.error('[Customer Test Runner Error]', err);
  process.exit(1);
});
