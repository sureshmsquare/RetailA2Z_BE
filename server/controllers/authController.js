import bcrypt from 'bcryptjs';
import User, { USER_ROLES } from '../models/User.js';
import { generateToken } from '../utils/tokens.js';
import auditService from '../services/auditService.js';

export const authController = {
  /**
   * POST /api/auth/login
   * Body: { identifier, password } (identifier = email OR 10-digit mobile)
   */
  async login(req, res) {
    try {
      const { identifier, password } = req.body;

      if (!identifier || !password) {
        return res.status(400).json({
          success: false,
          message: 'Both identifier (email/mobile) and password are required.',
        });
      }

      const cleanIdentifier = String(identifier).trim();
      const isMobile = /^\d{10}$/.test(cleanIdentifier);

      // Search for user by email or 10-digit mobile
      const query = isMobile
        ? { mobile: cleanIdentifier }
        : { email: cleanIdentifier.toLowerCase() };

      const user = await User.findOne(query)
        .select('+passwordHash')
        .populate('storeIds', 'name address gstin timezone isActive');

      // Generic error on missing user or invalid password
      if (!user) {
        await auditService.log({
          actor: `IP:${req.ip || 'unknown'}`,
          action: 'LOGIN_FAILURE',
          entity: 'User',
          entityId: cleanIdentifier,
          reason: 'Attempted login with non-existent user identifier',
        });

        return res.status(401).json({
          success: false,
          message: 'Invalid ID or password',
        });
      }

      // Check password using bcrypt
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        await auditService.log({
          actor: user,
          action: 'LOGIN_FAILURE',
          entity: 'User',
          entityId: user._id,
          reason: 'Invalid password provided',
        });

        return res.status(401).json({
          success: false,
          message: 'Invalid ID or password',
        });
      }

      // Deactivated user check
      if (!user.isActive) {
        await auditService.log({
          actor: user,
          action: 'LOGIN_BLOCKED_INACTIVE',
          entity: 'User',
          entityId: user._id,
          reason: 'Deactivated user attempted to log in',
        });

        return res.status(403).json({
          success: false,
          message: 'User account is deactivated. Access revoked.',
        });
      }

      // Update last login timestamp
      user.lastLoginAt = new Date();
      await user.save({ validateBeforeSave: false });

      // Generate JWT (sliding session, 30m default)
      const token = generateToken(user);

      // Format response stores: [{ id, name }]
      const stores = (user.storeIds || [])
        .filter((s) => s && s.isActive !== false)
        .map((s) => ({
          id: s._id ? s._id.toString() : s.toString(),
          name: s.name || 'Store',
        }));

      return res.status(200).json({
        success: true,
        token,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          stores,
        },
      });
    } catch (error) {
      console.error('[AuthController.login error]', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error during login.',
      });
    }
  },

  /**
   * POST /api/auth/logout
   */
  async logout(req, res) {
    if (res.clearCookie) {
      res.clearCookie('token');
    }
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  },

  /**
   * GET /api/auth/me
   * Returns logged-in user with assigned stores (used on page refresh)
   */
  async me(req, res) {
    const user = req.user;

    const stores = (user.storeIds || []).map((s) => ({
      id: s._id ? s._id.toString() : s.toString(),
      name: s.name,
      address: s.address,
      timezone: s.timezone,
      isActive: s.isActive,
    }));

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        stores,
      },
    });
  },

  /**
   * POST /api/auth/refresh
   * Sliding session: issues a fresh token if current session/token is valid
   */
  async refresh(req, res) {
    const user = req.user;
    const freshToken = generateToken(user);

    const stores = (user.storeIds || []).map((s) => ({
      id: s._id ? s._id.toString() : s.toString(),
      name: s.name,
    }));

    return res.status(200).json({
      success: true,
      token: freshToken,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        stores,
      },
    });
  },
};

export default authController;

