import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_ENV = 'test';

import mongoose from 'mongoose';
import app from '../server/app.js';
import connectDB from '../server/config/db.js';
import User from '../server/models/User.js';
import Store from '../server/models/Store.js';
import AuditLog from '../server/models/AuditLog.js';
import { serializeItemForRole } from '../server/utils/serializer.js';

async function runChecklist() {
  console.log('================================================================');
  console.log('   RetailA2Z - Backend Authentication & Access Checklist Test   ');
  console.log('================================================================\n');

  await connectDB();

  // Start temporary server on test port 5001
  const TEST_PORT = 5001;
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
    // 1. Admin login with email
    // -------------------------------------------------------------
    const adminEmailLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'sureshsalve2001@gmail.com',
        password: 'Admin@123',
      }),
    });
    const adminEmailData = await adminEmailLoginRes.json();
    const adminToken = adminEmailData.token;

    const emailLoginPass =
      adminEmailLoginRes.status === 200 &&
      !!adminToken &&
      adminEmailData.user.role === 'admin' &&
      Array.isArray(adminEmailData.user.stores) &&
      !adminEmailData.user.passwordHash;

    recordResult(
      'Admin can log in with email',
      emailLoginPass,
      `Status: ${adminEmailLoginRes.status}, Stores count: ${adminEmailData.user?.stores?.length}`
    );

    // -------------------------------------------------------------
    // 2. Admin login with 10-digit mobile number
    // -------------------------------------------------------------
    const adminMobileLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: '9876543210',
        password: 'Admin@123',
      }),
    });
    const adminMobileData = await adminMobileLoginRes.json();
    recordResult(
      'Admin can log in with mobile number (10 digits)',
      adminMobileLoginRes.status === 200 && !!adminMobileData.token,
      `Status: ${adminMobileLoginRes.status}, User: ${adminMobileData.user?.name}`
    );

    // -------------------------------------------------------------
    // 3. Invalid credentials rejected with generic message
    // -------------------------------------------------------------
    const wrongPassRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'sureshsalve2001@gmail.com',
        password: 'WrongPassword999',
      }),
    });
    const wrongPassData = await wrongPassRes.json();
    recordResult(
      'Invalid password returns 401 with generic message "Invalid ID or password"',
      wrongPassRes.status === 401 && wrongPassData.message === 'Invalid ID or password',
      `Message: "${wrongPassData.message}"`
    );

    // -------------------------------------------------------------
    // 4. GET /api/auth/me works with valid token
    // -------------------------------------------------------------
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const meData = await meRes.json();
    recordResult(
      '/api/auth/me works with a valid token and returns assigned stores',
      meRes.status === 200 && meData.user && Array.isArray(meData.user.stores),
      `User: ${meData.user?.name}, Stores assigned: ${meData.user?.stores?.length}`
    );

    // -------------------------------------------------------------
    // 5. POST /api/auth/refresh issues a fresh sliding session token
    // -------------------------------------------------------------
    const refreshRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const refreshData = await refreshRes.json();
    recordResult(
      'POST /api/auth/refresh issues sliding session token',
      refreshRes.status === 200 && !!refreshData.token,
      `Fresh token issued: ${refreshData.token ? 'Yes' : 'No'}`
    );

    // -------------------------------------------------------------
    // 6. Salesman gets 403 on admin APIs
    // -------------------------------------------------------------
    const salesmanLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'salvesuresh143@gmail.com',
        password: 'User@123',
      }),
    });
    const salesmanData = await salesmanLoginRes.json();
    const salesmanToken = salesmanData.token;

    const salesmanAdminGetRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${salesmanToken}` },
    });
    const salesmanAdminPostRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${salesmanToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Hacker', password: 'password123' }),
    });

    recordResult(
      'Salesman gets 403 on admin APIs (GET /api/users and POST /api/users)',
      salesmanAdminGetRes.status === 403 && salesmanAdminPostRes.status === 403,
      `GET status: ${salesmanAdminGetRes.status}, POST status: ${salesmanAdminPostRes.status}`
    );

    // -------------------------------------------------------------
    // 7. Store-wise Access Isolation (User with Store A gets 403 on Store B)
    // -------------------------------------------------------------
    const mainStore = await Store.findOne({ name: 'RetailA2Z Main Store' });
    const branchStore = await Store.findOne({ name: 'RetailA2Z Branch Store' });

    // Salesman has access to Main Store
    const salesmanStoreARes = await fetch(`${baseUrl}/api/test/store-scoped`, {
      headers: {
        Authorization: `Bearer ${salesmanToken}`,
        'x-store-id': mainStore._id.toString(),
      },
    });

    // Salesman DOES NOT have access to Branch Store
    const salesmanStoreBRes = await fetch(`${baseUrl}/api/test/store-scoped`, {
      headers: {
        Authorization: `Bearer ${salesmanToken}`,
        'x-store-id': branchStore._id.toString(),
      },
    });

    recordResult(
      'User with Store A access gets 403 when sending x-store-id of Store B',
      salesmanStoreARes.status === 200 && salesmanStoreBRes.status === 403,
      `Store A (assigned) status: ${salesmanStoreARes.status}, Store B (unassigned) status: ${salesmanStoreBRes.status}`
    );

    // -------------------------------------------------------------
    // 8. Admin creates a user (POST /api/users)
    // -------------------------------------------------------------
    const testEmail = `tempclerk_${Date.now()}@retaila2z.com`;
    const createUserRes = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Temporary Test Clerk',
        email: testEmail,
        mobile: '9123456789',
        password: 'Password@123',
        role: 'salesman',
        storeIds: [mainStore._id.toString()],
      }),
    });
    const createdUserData = await createUserRes.json();
    const createdUserId = createdUserData.user?.id || createdUserData.user?._id;

    recordResult(
      'Admin creates user (POST /api/users)',
      createUserRes.status === 201 && !!createdUserId,
      `Created User ID: ${createdUserId}, passwordHash omitted: ${!createdUserData.user?.passwordHash}`
    );

    // Log in with newly created user to obtain their token
    const newUserLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: 'Password@123',
      }),
    });
    const newUserData = await newUserLoginRes.json();
    const newUserToken = newUserData.token;

    // -------------------------------------------------------------
    // 9. Admin resets user password (PATCH /api/users/:id/password)
    // -------------------------------------------------------------
    const resetPassRes = await fetch(`${baseUrl}/api/users/${createdUserId}/password`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        newPassword: 'BrandNewPassword@456',
        reason: 'Periodic security rotation',
      }),
    });
    recordResult(
      'Admin resets a user password (PATCH /api/users/:id/password)',
      resetPassRes.status === 200,
      `Status: ${resetPassRes.status}`
    );

    // -------------------------------------------------------------
    // 10. Deactivated user gets 401/403 on next request even with valid old token
    // -------------------------------------------------------------
    // Deactivate user
    const deactivateRes = await fetch(`${baseUrl}/api/users/${createdUserId}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        isActive: false,
        reason: 'Temporary investigation lock',
      }),
    });

    // Try calling protected endpoint with the old token issued BEFORE deactivation
    const oldTokenReqRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${newUserToken}` },
    });

    // Try logging in as deactivated user
    const loginDeactivatedRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: 'BrandNewPassword@456',
      }),
    });
    const loginDeactivatedData = await loginDeactivatedRes.json();

    recordResult(
      'Deactivated user (with valid old token) gets 401/403 on the next request',
      deactivateRes.status === 200 &&
        oldTokenReqRes.status === 403 &&
        loginDeactivatedRes.status === 403 &&
        loginDeactivatedData.message === 'User account is deactivated. Access revoked.',
      `Deactivate: ${deactivateRes.status}, Old token request: ${oldTokenReqRes.status}, Login: ${loginDeactivatedRes.status}`
    );

    // -------------------------------------------------------------
    // 11. Password hash is never present in ANY response
    // -------------------------------------------------------------
    const listUsersRes = await fetch(`${baseUrl}/api/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const listData = await listUsersRes.json();
    const anyHashExposed = (listData.users || []).some(
      (u) => u.passwordHash !== undefined || u.password !== undefined
    );

    recordResult(
      'Password hash is never present in any response',
      !anyHashExposed && !adminEmailData.user?.passwordHash && !newUserData.user?.passwordHash,
      `Exposed in list: ${anyHashExposed ? 'YES' : 'NO'}`
    );

    // -------------------------------------------------------------
    // 12. Audit entries are created for user create, deactivate, password reset, login failure
    // -------------------------------------------------------------
    const createAudit = await AuditLog.findOne({ action: 'USER_CREATE', entityId: createdUserId });
    const statusAudit = await AuditLog.findOne({ action: 'USER_STATUS_CHANGE', entityId: createdUserId });
    const resetAudit = await AuditLog.findOne({ action: 'PASSWORD_RESET', entityId: createdUserId });
    const failAudit = await AuditLog.findOne({ action: 'LOGIN_FAILURE' });

    const auditPass = !!createAudit && !!statusAudit && !!resetAudit && !!failAudit;
    recordResult(
      'Audit entries created for user create, deactivate, password reset and login failures',
      auditPass,
      `Create: ${!!createAudit}, Status: ${!!statusAudit}, Reset: ${!!resetAudit}, Failure: ${!!failAudit}`
    );

    // -------------------------------------------------------------
    // 13. Price Visibility Rule (Salesman/Collections NEVER receive rate/mrp/cost/margin)
    // -------------------------------------------------------------
    const mockProduct = {
      _id: new mongoose.Types.ObjectId(),
      name: 'PVC Pipe 1 inch',
      sku: 'PVC-001',
      rate: 150.0,
      mrp: 180.0,
      cost: 110.0,
      margin: 40.0,
      stockQuantity: 50,
    };

    const salesmanView = serializeItemForRole(mockProduct, 'salesman');
    const collectionsView = serializeItemForRole(mockProduct, 'collections');
    const adminView = serializeItemForRole(mockProduct, 'admin');

    const salesmanPricesHidden =
      salesmanView.rate === undefined &&
      salesmanView.mrp === undefined &&
      salesmanView.cost === undefined &&
      salesmanView.margin === undefined &&
      salesmanView.name === 'PVC Pipe 1 inch';

    const collectionsPricesHidden =
      collectionsView.rate === undefined &&
      collectionsView.mrp === undefined &&
      collectionsView.cost === undefined;

    const adminPricesPreserved =
      adminView.rate === 150.0 && adminView.mrp === 180.0 && adminView.cost === 110.0;

    recordResult(
      'Price Visibility Serializer: rate/mrp/cost/margin stripped for salesman and collections, preserved for admin',
      salesmanPricesHidden && collectionsPricesHidden && adminPricesPreserved,
      `Salesman price fields hidden: ${salesmanPricesHidden}, Admin price preserved: ${adminPricesPreserved}`
    );

    // Clean up temporary test user
    await User.findByIdAndDelete(createdUserId);
    console.log('\n[Cleanup] Temporary test user cleaned up successfully.');
  } catch (err) {
    console.error('[Test Execution Error]', err);
  } finally {
    server.close();
    await mongoose.disconnect();
    console.log('\n================================================================');
    console.log(`Summary: ${results.filter((r) => r.passed).length}/${results.length} tests passed.`);
    console.log('================================================================\n');
  }
}

runChecklist();
