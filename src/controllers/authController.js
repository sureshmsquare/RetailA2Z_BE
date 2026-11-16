import {
  loginUser,
  refreshSession,
  logoutUser,
  switchActiveStore,
  requestPasswordReset,
  confirmPasswordReset,
} from '../services/authService.js';
import { setRefreshTokenCookie, clearRefreshTokenCookie } from '../utils/tokens.js';
import User from '../models/User.js';
import StoreMembership from '../models/StoreMembership.js';

export async function login(req, res, next) {
  try {
    const { identifier, password, preferredStoreId } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';

    const result = await loginUser({
      identifier,
      password,
      preferredStoreId,
      ipAddress,
      userAgent,
    });

    // Send secure HttpOnly cookie for refresh token
    setRefreshTokenCookie(res, result.rawRefreshToken);

    return res.status(200).json({
      success: true,
      message: 'Sign in successful.',
      accessToken: result.accessToken,
      user: result.user,
      activeStore: result.activeStore,
      stores: result.stores,
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';

    const result = await refreshSession({
      rawRefreshToken,
      ipAddress,
      userAgent,
    });

    setRefreshTokenCookie(res, result.rawRefreshToken);

    return res.status(200).json({
      success: true,
      message: 'Token refreshed.',
      accessToken: result.accessToken,
      user: result.user,
      activeStore: result.activeStore,
      stores: result.stores,
    });
  } catch (error) {
    clearRefreshTokenCookie(res);
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    const userId = req.user?.userId;
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';

    await logoutUser({
      rawRefreshToken,
      userId,
      ipAddress,
      userAgent,
    });

    clearRefreshTokenCookie(res);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    next(error);
  }
}

export async function me(req, res, next) {
  try {
    const user = await User.findById(req.user.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User not found or inactive.' });
    }

    const memberships = await StoreMembership.find({
      userId: user._id,
      isActive: true,
    })
      .populate('storeId', 'storeName storeCode address isActive')
      .populate('roleId', 'name permissions')
      .lean();

    const validMemberships = memberships.filter((m) => m.storeId && m.storeId.isActive && m.roleId);

    const stores = validMemberships.map((m) => ({
      storeId: m.storeId._id.toString(),
      storeName: m.storeId.storeName,
      storeCode: m.storeId.storeCode,
      role: m.roleId.name,
      permissions: m.roleId.permissions || [],
    }));

    let activeStore = null;
    if (req.user.storeId) {
      activeStore = stores.find((s) => s.storeId === req.user.storeId.toString()) || stores[0] || null;
    } else {
      activeStore = stores[0] || null;
    }

    return res.status(200).json({
      success: true,
      user: user.toJSON(),
      activeStore,
      stores,
    });
  } catch (error) {
    next(error);
  }
}

export async function switchStore(req, res, next) {
  try {
    const { storeId } = req.body;
    if (!storeId) {
      return res.status(400).json({ success: false, message: 'storeId is required.' });
    }

    const result = await switchActiveStore({
      userId: req.user.userId,
      storeId,
    });

    return res.status(200).json({
      success: true,
      message: 'Active store switched.',
      activeStore: result.activeStore,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(req, res, next) {
  try {
    const { identifier } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';

    const result = await requestPasswordReset({
      identifier,
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const userAgent = req.get('user-agent') || '';

    const result = await confirmPasswordReset({
      token,
      newPassword,
      ipAddress,
      userAgent,
    });

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
}

