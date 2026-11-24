import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User, { USER_ROLES } from '../models/User.js';
import Store from '../models/Store.js';
import auditService from '../services/auditService.js';

export const userController = {
  /**
   * POST /api/users
   * Create user: name, email/mobile, password, role, storeIds
   * Tenant isolation: storeIds must only be stores the acting admin is assigned to.
   */
  async createUser(req, res, next) {
    try {
      const { name, email, mobile, password, role = 'salesman' } = req.body;
      let rawStoreIds = req.body.storeIds;
      if (rawStoreIds === undefined) {
        rawStoreIds = req.body.storeId !== undefined ? req.body.storeId : req.body.store_id;
      }
      if (!Array.isArray(rawStoreIds)) {
        rawStoreIds = rawStoreIds ? [rawStoreIds] : [];
      }

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

      // Tenant isolation: Admin can only assign stores they are assigned to
      const adminStoreIds = (req.user?.storeIds || []).map((s) =>
        s._id ? s._id.toString() : s.toString()
      );

      // Default to active store if no stores specified
      if (rawStoreIds.length === 0) {
        rawStoreIds = [req.storeId];
      }

      const validStoreIds = [];
      for (const sid of rawStoreIds) {
        if (!mongoose.Types.ObjectId.isValid(sid)) {
          return res.status(400).json({ success: false, message: `Invalid store ID format: ${sid}` });
        }
        if (!adminStoreIds.includes(String(sid))) {
          return res.status(400).json({
            success: false,
            message: 'Cannot assign user to a store you are not assigned to.',
          });
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

      // Audit log entry for user create with storeId
      await auditService.log({
        actor: req.user,
        storeId: req.storeId,
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
      next(error);
    }
  },

  /**
   * GET /api/users
   * List users scoped to req.storeId (never returning passwordHash)
   */
  async listUsers(req, res, next) {
    try {
      const users = await User.find({ storeIds: req.storeId })
        .populate('storeIds', 'name address timezone isActive')
        .sort({ createdAt: -1 });

      return res.status(200).json({
        success: true,
        count: users.length,
        users: users.map((u) => u.toJSON()),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/users/:id
   * Target user must belong to req.storeId, otherwise return 404 (no data leak).
   */
  async getUserById(req, res, next) {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID format.' });
      }

      const user = await User.findById(id).populate('storeIds', 'name address timezone isActive');
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const userStoreIds = (user.storeIds || []).map((s) =>
        s._id ? s._id.toString() : s.toString()
      );
      if (!userStoreIds.includes(String(req.storeId))) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      return res.status(200).json({
        success: true,
        user: user.toJSON(),
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/users/:id
   * Edit name, role, storeIds
   * Target user must belong to req.storeId, otherwise return 404.
   * Admin cannot change their own role or assign foreign stores.
   */
  async updateUser(req, res, next) {
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

      // Tenant isolation: target user must belong to req.storeId
      const userStoreIds = (user.storeIds || []).map((s) =>
        s._id ? s._id.toString() : s.toString()
      );
      if (!userStoreIds.includes(String(req.storeId))) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Self-protection: Admin cannot change own role or deactivate self
      if (id === req.user._id.toString()) {
        if (role && role !== req.user.role) {
          return res.status(400).json({
            success: false,
            message: 'You cannot change your own role.',
          });
        }
        if (req.body.isActive === false) {
          return res.status(400).json({
            success: false,
            message: 'You cannot deactivate your own account.',
          });
        }
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
        const adminStoreIds = (req.user?.storeIds || []).map((s) =>
          s._id ? s._id.toString() : s.toString()
        );

        const validStoreIds = [];
        for (const sid of storeIds) {
          if (!mongoose.Types.ObjectId.isValid(sid)) {
            return res.status(400).json({ success: false, message: `Invalid store ID format: ${sid}` });
          }
          if (!adminStoreIds.includes(String(sid))) {
            return res.status(400).json({
              success: false,
              message: 'Cannot assign user to a store you are not assigned to.',
            });
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

      // Record any audit entries triggered with storeId
      for (const entry of auditActions) {
        await auditService.log({
          actor: req.user,
          storeId: req.storeId,
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
      next(error);
    }
  },

  /**
   * PATCH /api/users/:id/status
   * Activate / deactivate user
   * Target user must belong to req.storeId, otherwise return 404.
   * Admin cannot deactivate themselves. Audit log includes storeId.
   */
  async toggleUserStatus(req, res, next) {
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

      // Tenant isolation: target user must belong to req.storeId
      const userStoreIds = (user.storeIds || []).map((s) =>
        s._id ? s._id.toString() : s.toString()
      );
      if (!userStoreIds.includes(String(req.storeId))) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Self-protection: Admin cannot deactivate their own account
      if (id === req.user._id.toString() && isActive === false) {
        return res.status(400).json({
          success: false,
          message: 'You cannot deactivate your own account.',
        });
      }

      const before = { isActive: user.isActive };
      user.isActive = isActive;
      await user.save();

      const after = { isActive: user.isActive };

      await auditService.log({
        actor: req.user,
        storeId: req.storeId,
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
      next(error);
    }
  },

  /**
   * PATCH /api/users/:id/password
   * Admin resets a user's password
   * Target user must belong to req.storeId, otherwise return 404.
   * Audit log includes storeId (never logging the password or hash).
   */
  async resetPassword(req, res, next) {
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

      // Tenant isolation: target user must belong to req.storeId
      const userStoreIds = (user.storeIds || []).map((s) =>
        s._id ? s._id.toString() : s.toString()
      );
      if (!userStoreIds.includes(String(req.storeId))) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      // Hash with bcrypt
      const salt = await bcrypt.genSalt(10);
      user.passwordHash = await bcrypt.hash(newPassword, salt);
      await user.save();

      // Audit log entry with storeId (NEVER log the new password or hash)
      await auditService.log({
        actor: req.user,
        storeId: req.storeId,
        action: 'PASSWORD_RESET',
        entity: 'User',
        entityId: user._id,
        before: { passwordResetAt: new Date() },
        after: { passwordResetAt: new Date() },
        reason: reason || 'Administrator reset user password',
      });

      return res.status(200).json({
        success: true,
        message: 'User password has been reset successfully.',
      });
    } catch (error) {
      next(error);
    }
  },
};

export default userController;

