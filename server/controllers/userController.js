import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User, { USER_ROLES } from '../models/User.js';
import Store from '../models/Store.js';
import auditService from '../services/auditService.js';

export const userController = {
  /**
   * POST /api/users
   * Create user: name, email/mobile, password, role, storeIds
   */
  async createUser(req, res) {
    try {
      const { name, email, mobile, password, role = 'salesman', storeIds = [] } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'User name is required.' });
      }

      if (!email && !mobile) {
        return res.status(400).json({
          success: false,
          message: 'Either email or mobile number must be provided.',
        });
      }

      if (mobile && !/^\d{10}$/.test(String(mobile).trim())) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number must be a 10-digit number.',
        });
      }

      if (!password || password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long.',
        });
      }

      if (!Object.values(USER_ROLES).includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Role must be one of: ${Object.values(USER_ROLES).join(', ')}`,
        });
      }

      // Check duplicates
      const orConditions = [];
      if (email) orConditions.push({ email: email.toLowerCase().trim() });
      if (mobile) orConditions.push({ mobile: String(mobile).trim() });

      if (orConditions.length > 0) {
        const existing = await User.findOne({ $or: orConditions });
        if (existing) {
          const isEmailDup = email && existing.email === email.toLowerCase().trim();
          return res.status(409).json({
            success: false,
            message: isEmailDup
              ? 'A user with this email already exists.'
              : 'A user with this mobile number already exists.',
          });
        }
      }

      // Validate storeIds
      const validStoreIds = [];
      for (const sid of storeIds) {
        if (!mongoose.Types.ObjectId.isValid(sid)) {
          return res.status(400).json({ success: false, message: `Invalid store ID format: ${sid}` });
        }
        const exists = await Store.findById(sid);
        if (!exists) {
          return res.status(404).json({ success: false, message: `Store with ID ${sid} does not exist.` });
        }
        validStoreIds.push(sid);
      }

      // Hash password with bcrypt (10-12 rounds)
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const newUser = await User.create({
        name: name.trim(),
        email: email ? email.toLowerCase().trim() : null,
        mobile: mobile ? String(mobile).trim() : null,
        passwordHash,
        role,
        storeIds: validStoreIds,
        isActive: true,
        createdBy: req.user._id,
      });

      const populatedUser = await User.findById(newUser._id).populate('storeIds', 'name address timezone');

      // Audit log entry for user create
      await auditService.log({
        actor: req.user,
        action: 'USER_CREATE',
        entity: 'User',
        entityId: newUser._id,
        after: populatedUser.toJSON(),
        reason: 'New user created by administrator',
      });

      return res.status(201).json({
        success: true,
        message: 'User created successfully.',
        user: populatedUser.toJSON(),
      });
    } catch (error) {
      console.error('[UserController.createUser error]', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to create user.',
        error: error.message,
      });
    }
  },

  /**
   * GET /api/users
   * List users with populated store details (never returning passwordHash)
   */
  async listUsers(req, res) {
    try {
      const users = await User.find()
        .populate('storeIds', 'name address timezone isActive')
        .sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        count: users.length,
        users: users.map((u) => u.toJSON()),
      });
    } catch (error) {
      console.error('[UserController.listUsers error]', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to list users.',
        error: error.message,
      });
    }
  },

  /**
   * PATCH /api/users/:id
   * Edit name, role, storeIds
   * Audit log entries for role change and store access change
   */
  async updateUser(req, res) {
    try {
      const { id } = req.params;
      const { name, role, storeIds, reason } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const beforeSnapshot = user.toJSON();
      const auditActions = [];

      if (name && name.trim()) {
        user.name = name.trim();
      }

      if (role) {
        if (!Object.values(USER_ROLES).includes(role)) {
          return res.status(400).json({
            success: false,
            message: `Role must be one of: ${Object.values(USER_ROLES).join(', ')}`,
          });
        }
        if (role !== user.role) {
          auditActions.push({
            action: 'ROLE_CHANGE',
            before: { role: user.role },
            after: { role },
            reason: reason || `Role updated from ${user.role} to ${role}`,
          });
          user.role = role;
        }
      }

      if (Array.isArray(storeIds)) {
        const validStoreIds = [];
        for (const sid of storeIds) {
          if (!mongoose.Types.ObjectId.isValid(sid)) {
            return res.status(400).json({ success: false, message: `Invalid store ID format: ${sid}` });
          }
          const exists = await Store.findById(sid);
          if (!exists) {
            return res.status(404).json({ success: false, message: `Store ${sid} does not exist.` });
          }
          validStoreIds.push(sid);
        }

        const oldStoreIds = (user.storeIds || []).map((s) => s.toString()).sort();
        const newStoreIds = validStoreIds.map((s) => s.toString()).sort();

        if (JSON.stringify(oldStoreIds) !== JSON.stringify(newStoreIds)) {
          auditActions.push({
            action: 'STORE_ACCESS_CHANGE',
            before: { storeIds: oldStoreIds },
            after: { storeIds: newStoreIds },
            reason: reason || 'Assigned stores updated by admin',
          });
          user.storeIds = validStoreIds;
        }
      }

      await user.save();
      const updatedUser = await User.findById(id).populate('storeIds', 'name address timezone isActive');

      // Record any audit entries triggered
      for (const entry of auditActions) {
        await auditService.log({
          actor: req.user,
          action: entry.action,
          entity: 'User',
          entityId: user._id,
          before: entry.before,
          after: entry.after,
          reason: entry.reason,
        });
      }

      return res.status(200).json({
        success: true,
        message: 'User updated successfully.',
        user: updatedUser.toJSON(),
      });
    } catch (error) {
      console.error('[UserController.updateUser error]', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to update user.',
        error: error.message,
      });
    }
  },

  /**
   * PATCH /api/users/:id/status
   * Activate / deactivate user
   * Audit log required
   */
  async toggleUserStatus(req, res) {
    try {
      const { id } = req.params;
      const { isActive, reason } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
      }

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({
          success: false,
          message: 'Field "isActive" must be a boolean (true or false).',
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const before = { isActive: user.isActive };
      user.isActive = isActive;
      await user.save();

      const after = { isActive: user.isActive };

      await auditService.log({
        actor: req.user,
        action: 'USER_STATUS_CHANGE',
        entity: 'User',
        entityId: user._id,
        before,
        after,
        reason: reason || `User account ${isActive ? 'activated' : 'deactivated'} by admin`,
      });

      return res.status(200).json({
        success: true,
        message: `User ${isActive ? 'activated' : 'deactivated'} successfully.`,
        user: user.toJSON(),
      });
    } catch (error) {
      console.error('[UserController.toggleUserStatus error]', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to change user status.',
        error: error.message,
      });
    }
  },

  /**
   * PATCH /api/users/:id/password
   * Admin resets a user's password
   * Audit log required (never logging the password or hash)
   */
  async resetPassword(req, res) {
    try {
      const { id } = req.params;
      const { newPassword, reason } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
      }

      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 8 characters long.',
        });
      }

      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Hash with bcrypt
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(newPassword, salt);
      await user.save();

      // Audit log entry (NEVER log the new password or hash)
      await auditService.log({
        actor: req.user,
        action: 'PASSWORD_RESET',
        entity: 'User',
        entityId: user._id,
        before: { passwordResetAt: new Date() },
        after: { passwordResetAt: new Date() },
        reason: reason || 'Administrator reset user password',
      });

      return res.status(200).json({
        success: true,
        message: "User password has been reset successfully.",
      });
    } catch (error) {
      console.error('[UserController.resetPassword error]', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to reset user password.',
        error: error.message,
      });
    }
  },
};

export default userController;

