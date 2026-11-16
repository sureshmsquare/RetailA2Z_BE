import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Store from '../models/Store.js';
import Role, { FIXED_ROLES, ROLE_PERMISSIONS } from '../models/Role.js';
import StoreMembership from '../models/StoreMembership.js';

export async function seedInitialData() {
  try {
    // 1. Seed Fixed Roles idempotently
    const roleDocs = {};
    for (const [roleName, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      let role = await Role.findOne({ name: roleName });
      if (!role) {
        role = await Role.create({
          name: roleName,
          description: `Fixed ${roleName} role with predefined business permissions.`,
          permissions,
        });
      } else {
        // Ensure permissions are updated if needed
        role.permissions = permissions;
        await role.save();
      }
      roleDocs[roleName] = role;
    }

    // 2. Ensure at least one store exists
    let store = await Store.findOne({ storeCode: 'RA2Z-001' });
    if (!store) {
      store = await Store.create({
        storeName: 'RetailA2Z Main Store',
        storeCode: 'RA2Z-001',
        address: {
          street: 'Main Market Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          postalCode: '400001',
          country: 'India',
        },
        isActive: true,
      });
    }

    // Also create a second store so multi-store capability can be immediately used and tested
    let store2 = await Store.findOne({ storeCode: 'RA2Z-002' });
    if (!store2) {
      store2 = await Store.create({
        storeName: 'RetailA2Z Metro Outlet',
        storeCode: 'RA2Z-002',
        address: {
          street: 'High Street Avenue',
          city: 'Pune',
          state: 'Maharashtra',
          postalCode: '411001',
          country: 'India',
        },
        isActive: true,
      });
    }

    // 3. User 1 - Owner/Admin
    const adminEmail = 'sureshsalve2001@gmail.com'.toLowerCase().trim();
    const adminPass = process.env.INITIAL_ADMIN_PASSWORD || 'Admin@123';

    let adminUser = await User.findOne({ email: adminEmail });
    if (!adminUser) {
      const passwordHash = await bcrypt.hash(adminPass, 10);
      adminUser = await User.create({
        name: 'Suresh Salve',
        email: adminEmail,
        mobile: '+919876543210',
        passwordHash,
        isActive: true,
        isEmailVerified: true,
      });
    }

    // Assign Owner/Admin to Store 1 and Store 2
    const adminRole = roleDocs[FIXED_ROLES.OWNER_ADMIN];
    const adminMembership1 = await StoreMembership.findOne({
      userId: adminUser._id,
      storeId: store._id,
    });
    if (!adminMembership1) {
      await StoreMembership.create({
        userId: adminUser._id,
        storeId: store._id,
        roleId: adminRole._id,
        isActive: true,
        createdBy: adminUser._id,
      });
    }

    const adminMembership2 = await StoreMembership.findOne({
      userId: adminUser._id,
      storeId: store2._id,
    });
    if (!adminMembership2) {
      await StoreMembership.create({
        userId: adminUser._id,
        storeId: store2._id,
        roleId: adminRole._id,
        isActive: true,
        createdBy: adminUser._id,
      });
    }

    // 4. User 2 - Cashier
    // Normalize cashier email by removing any internal whitespace:
    const rawCashierEmail = 'salvesuresh143@gmail.com';
    const cashierEmail = rawCashierEmail.replace(/\s+/g, '').toLowerCase().trim();
    const cashierPass = process.env.INITIAL_CASHIER_PASSWORD || 'User@123';

    let cashierUser = await User.findOne({ email: cashierEmail });
    if (!cashierUser) {
      const passwordHash = await bcrypt.hash(cashierPass, 10);
      cashierUser = await User.create({
        name: 'Suresh Salve',
        email: cashierEmail,
        mobile: '+919876543211',
        passwordHash,
        isActive: true,
        isEmailVerified: true,
      });
    }

    // Assign Cashier to Store 1
    const cashierRole = roleDocs[FIXED_ROLES.CASHIER];
    const cashierMembership = await StoreMembership.findOne({
      userId: cashierUser._id,
      storeId: store._id,
    });
    if (!cashierMembership) {
      await StoreMembership.create({
        userId: cashierUser._id,
        storeId: store._id,
        roleId: cashierRole._id,
        isActive: true,
        createdBy: adminUser._id,
      });
    }

    console.log('[Seed] Database initialization and fixed roles verified.');
  } catch (error) {
    console.error(`[Seed Error] Seeding failed: ${error.message}`);
  }
}

