import bcrypt from 'bcryptjs';
import Store from '../models/Store.js';
import StoreMembership from '../models/StoreMembership.js';
import Role, { FIXED_ROLES } from '../models/Role.js';
import User from '../models/User.js';

export async function listUserStores(req, res, next) {
  try {
    const memberships = await StoreMembership.find({
      userId: req.user.userId,
      isActive: true,
    })
      .populate('storeId')
      .populate('roleId', 'name permissions')
      .lean();

    const stores = memberships
      .filter((m) => m.storeId && m.storeId.isActive)
      .map((m) => ({
        _id: m.storeId._id,
        storeName: m.storeId.storeName,
        storeCode: m.storeId.storeCode,
        address: m.storeId.address,
        isActive: m.storeId.isActive,
        role: m.roleId?.name,
        permissions: m.roleId?.permissions || [],
      }));

    return res.status(200).json({ success: true, stores });
  } catch (error) {
    next(error);
  }
}

export async function createNewStore(req, res, next) {
  try {
    const { storeName, storeCode, address } = req.body;

    if (!storeName || !storeCode) {
      return res.status(400).json({
        success: false,
        message: 'Store name and unique store code are required.',
      });
    }

    const existingStore = await Store.findOne({ storeCode: storeCode.trim().toUpperCase() });
    if (existingStore) {
      return res.status(409).json({
        success: false,
        message: `Store with code "${storeCode}" already exists.`,
      });
    }

    const store = await Store.create({
      storeName: storeName.trim(),
      storeCode: storeCode.trim().toUpperCase(),
      address: address || {},
      isActive: true,
    });

    const ownerRole = await Role.findOne({ name: FIXED_ROLES.OWNER_ADMIN });

    // Creator becomes OWNER_ADMIN for this new store
    await StoreMembership.create({
      userId: req.user.userId,
      storeId: store._id,
      roleId: ownerRole._id,
      isActive: true,
      createdBy: req.user.userId,
    });

    return res.status(201).json({
      success: true,
      message: 'Store created successfully.',
      store,
    });
  } catch (error) {
    next(error);
  }
}

export async function getStoreDetails(req, res) {
  return res.status(200).json({
    success: true,
    store: req.store,
    userRole: req.user.role,
    permissions: req.user.permissions,
  });
}

export async function listStoreMembers(req, res, next) {
  try {
    const members = await StoreMembership.find({
      storeId: req.store._id,
      isActive: true,
    })
      .populate('userId', 'name email mobile isActive lastLoginAt createdAt')
      .populate('roleId', 'name description permissions')
      .lean();

    const formattedMembers = members
      .filter((m) => m.userId)
      .map((m) => ({
        membershipId: m._id,
        user: m.userId,
        role: m.roleId?.name,
        permissions: m.roleId?.permissions || [],
        joinedAt: m.createdAt,
      }));

    return res.status(200).json({
      success: true,
      storeId: req.store._id,
      storeName: req.store.storeName,
      members: formattedMembers,
    });
  } catch (error) {
    next(error);
  }
}

export async function addStoreMember(req, res, next) {
  try {
    const { name, email, mobile, roleName, password } = req.body;

    if (!name || !email || !roleName) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and roleName are required.',
      });
    }

    const targetRole = await Role.findOne({ name: roleName.toUpperCase() });
    if (!targetRole) {
      return res.status(400).json({
        success: false,
        message: `Invalid role "${roleName}". Valid roles are: ${Object.values(FIXED_ROLES).join(', ')}`,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      const initialPassword = password || 'User@123';
      const passwordHash = await bcrypt.hash(initialPassword, 10);

      user = await User.create({
        name: name.trim(),
        email: normalizedEmail,
        mobile: mobile ? mobile.trim() : null,
        passwordHash,
        isActive: true,
        isEmailVerified: false,
      });
    }

    // Check if membership already exists in this store
    let membership = await StoreMembership.findOne({
      userId: user._id,
      storeId: req.store._id,
    });

    if (membership) {
      membership.roleId = targetRole._id;
      membership.isActive = true;
      await membership.save();
    } else {
      membership = await StoreMembership.create({
        userId: user._id,
        storeId: req.store._id,
        roleId: targetRole._id,
        isActive: true,
        createdBy: req.user.userId,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Employee "${user.name}" successfully assigned to ${req.store.storeName} as ${targetRole.name}.`,
      member: {
        membershipId: membership._id,
        userId: user._id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: targetRole.name,
      },
    });
  } catch (error) {
    next(error);
  }
}

