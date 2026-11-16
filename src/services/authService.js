import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import StoreMembership from '../models/StoreMembership.js';
import RefreshToken from '../models/RefreshToken.js';
import AuthLog, { AUTH_ACTIONS } from '../models/AuthLog.js';
import {
  generateRandomToken,
  hashToken,
  generateAccessToken,
} from '../utils/tokens.js';

export async function loginUser({ identifier, password, preferredStoreId, ipAddress, userAgent }) {
  if (!identifier || !password) {
    throw { statusCode: 400, message: 'Email/mobile and password are required.' };
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();

  // Find user by email or mobile
  const user = await User.findOne({
    $or: [
      { email: normalizedIdentifier },
      { mobile: identifier.trim() },
    ],
  }).select('+passwordHash');

  if (!user) {
    await AuthLog.create({
      action: AUTH_ACTIONS.LOGIN_FAILED,
      ipAddress,
      userAgent,
      details: `User not found: ${identifier}`,
    });
    throw { statusCode: 401, message: 'Invalid email, mobile or password.' };
  }

  if (!user.isActive) {
    await AuthLog.create({
      userId: user._id,
      action: AUTH_ACTIONS.LOGIN_FAILED,
      ipAddress,
      userAgent,
      details: 'Account deactivated',
    });
    throw { statusCode: 403, message: 'Account is deactivated. Contact store administrator.' };
  }

  const isPasswordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordMatch) {
    await AuthLog.create({
      userId: user._id,
      action: AUTH_ACTIONS.LOGIN_FAILED,
      ipAddress,
      userAgent,
      details: 'Invalid password',
    });
    throw { statusCode: 401, message: 'Invalid email, mobile or password.' };
  }

  // Fetch active store memberships
  const memberships = await StoreMembership.find({
    userId: user._id,
    isActive: true,
  })
    .populate('storeId', 'storeName storeCode address isActive')
    .populate('roleId', 'name description permissions')
    .lean();

  const validMemberships = memberships.filter((m) => m.storeId && m.storeId.isActive && m.roleId);

  if (validMemberships.length === 0) {
    throw {
      statusCode: 403,
      message: 'No active store memberships found for this account. Contact your administrator.',
    };
  }

  // Select active store (either user-selected or first available)
  let activeMembership = validMemberships[0];
  if (preferredStoreId) {
    const matched = validMemberships.find(
      (m) => m.storeId._id.toString() === preferredStoreId.toString()
    );
    if (matched) activeMembership = matched;
  }

  const activeStore = {
    storeId: activeMembership.storeId._id.toString(),
    storeName: activeMembership.storeId.storeName,
    storeCode: activeMembership.storeId.storeCode,
    role: activeMembership.roleId.name,
    permissions: activeMembership.roleId.permissions || [],
  };

  const stores = validMemberships.map((m) => ({
    storeId: m.storeId._id.toString(),
    storeName: m.storeId.storeName,
    storeCode: m.storeId.storeCode,
    role: m.roleId.name,
    permissions: m.roleId.permissions || [],
  }));

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    storeId: activeStore.storeId,
    role: activeStore.role,
    permissions: activeStore.permissions,
    authVersion: user.authVersion,
  });

  const rawRefreshToken = generateRandomToken(40);
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt,
  });

  // Update last login
  user.lastLoginAt = new Date();
  await user.save();

  // Log success
  await AuthLog.create({
    userId: user._id,
    action: AUTH_ACTIONS.LOGIN_SUCCESS,
    ipAddress,
    userAgent,
    details: `Active store: ${activeStore.storeName} (${activeStore.storeCode})`,
  });

  return {
    user: user.toJSON(),
    activeStore,
    stores,
    accessToken,
    rawRefreshToken,
  };
}

export async function refreshSession({ rawRefreshToken, ipAddress, userAgent }) {
  if (!rawRefreshToken) {
    throw { statusCode: 401, message: 'Refresh token is missing.' };
  }

  const incomingHash = hashToken(rawRefreshToken);
  const storedToken = await RefreshToken.findOne({ tokenHash: incomingHash });

  if (!storedToken) {
    throw { statusCode: 401, message: 'Invalid refresh token.' };
  }

  // Detect token reuse
  if (storedToken.revokedAt) {
    // Immediate session revocation for security
    await RefreshToken.updateMany(
      { userId: storedToken.userId },
      { revokedAt: new Date() }
    );
    throw {
      statusCode: 401,
      message: 'Suspicious session detected. All sessions revoked. Please log in again.',
    };
  }

  if (storedToken.expiresAt < new Date()) {
    throw { statusCode: 401, message: 'Refresh token has expired. Please log in again.' };
  }

  const user = await User.findById(storedToken.userId);
  if (!user || !user.isActive) {
    throw { statusCode: 401, message: 'User account is no longer active.' };
  }

  // Revoke used token (token rotation)
  storedToken.revokedAt = new Date();
  await storedToken.save();

  // Fetch active store memberships
  const memberships = await StoreMembership.find({
    userId: user._id,
    isActive: true,
  })
    .populate('storeId', 'storeName storeCode isActive')
    .populate('roleId', 'name permissions')
    .lean();

  const validMemberships = memberships.filter((m) => m.storeId && m.storeId.isActive && m.roleId);
  if (validMemberships.length === 0) {
    throw { statusCode: 403, message: 'No active store memberships found.' };
  }

  const activeMembership = validMemberships[0];
  const activeStore = {
    storeId: activeMembership.storeId._id.toString(),
    storeName: activeMembership.storeId.storeName,
    storeCode: activeMembership.storeId.storeCode,
    role: activeMembership.roleId.name,
    permissions: activeMembership.roleId.permissions || [],
  };

  const stores = validMemberships.map((m) => ({
    storeId: m.storeId._id.toString(),
    storeName: m.storeId.storeName,
    storeCode: m.storeId.storeCode,
    role: m.roleId.name,
    permissions: m.roleId.permissions || [],
  }));

  // Generate new tokens
  const newAccessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    storeId: activeStore.storeId,
    role: activeStore.role,
    permissions: activeStore.permissions,
    authVersion: user.authVersion,
  });

  const newRawRefreshToken = generateRandomToken(40);
  const newTokenHash = hashToken(newRawRefreshToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenHash: newTokenHash,
    expiresAt,
  });

  await AuthLog.create({
    userId: user._id,
    action: AUTH_ACTIONS.TOKEN_REFRESH,
    ipAddress,
    userAgent,
    details: 'Token rotated successfully',
  });

  return {
    accessToken: newAccessToken,
    rawRefreshToken: newRawRefreshToken,
    user: user.toJSON(),
    activeStore,
    stores,
  };
}

export async function logoutUser({ rawRefreshToken, userId, ipAddress, userAgent }) {
  if (rawRefreshToken) {
    const tokenHash = hashToken(rawRefreshToken);
    await RefreshToken.updateOne(
      { tokenHash, revokedAt: null },
      { revokedAt: new Date() }
    );
  }

  if (userId) {
    await AuthLog.create({
      userId,
      action: AUTH_ACTIONS.LOGOUT,
      ipAddress,
      userAgent,
      details: 'User logged out',
    });
  }

  return { success: true };
}

export async function switchActiveStore({ userId, storeId }) {
  const membership = await StoreMembership.findOne({
    userId,
    storeId,
    isActive: true,
  })
    .populate('storeId', 'storeName storeCode address isActive')
    .populate('roleId', 'name permissions');

  if (!membership || !membership.storeId || !membership.storeId.isActive) {
    throw { statusCode: 403, message: 'You do not have access to this store.' };
  }

  const user = await User.findById(userId);
  if (!user || !user.isActive) {
    throw { statusCode: 401, message: 'User is not active.' };
  }

  const activeStore = {
    storeId: membership.storeId._id.toString(),
    storeName: membership.storeId.storeName,
    storeCode: membership.storeId.storeCode,
    role: membership.roleId.name,
    permissions: membership.roleId.permissions || [],
  };

  const newAccessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    storeId: activeStore.storeId,
    role: activeStore.role,
    permissions: activeStore.permissions,
    authVersion: user.authVersion,
  });

  return {
    activeStore,
    accessToken: newAccessToken,
  };
}

export async function requestPasswordReset({ identifier, ipAddress, userAgent }) {
  if (!identifier) {
    throw { statusCode: 400, message: 'Email or mobile number is required.' };
  }

  const normalizedIdentifier = identifier.trim().toLowerCase();
  const user = await User.findOne({
    $or: [{ email: normalizedIdentifier }, { mobile: identifier.trim() }],
  });

  // Always return consistent message to prevent account enumeration
  if (!user || !user.isActive) {
    return {
      message: 'If an active account is registered with this detail, reset instructions have been dispatched.',
    };
  }

  const resetToken = generateRandomToken(32);
  const tokenHash = hashToken(resetToken);
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  user.resetPasswordTokenHash = tokenHash;
  user.resetPasswordExpires = expires;
  await user.save();

  await AuthLog.create({
    userId: user._id,
    action: AUTH_ACTIONS.PASSWORD_RESET,
    ipAddress,
    userAgent,
    details: 'Password reset token requested',
  });

  // In production with an email provider, send the reset email here.
  // For local development and demonstration, return the token safely in non-production.
  const isDev = process.env.NODE_ENV !== 'production';

  return {
    message: 'If an active account is registered with this detail, reset instructions have been dispatched.',
    ...(isDev && { devResetToken: resetToken }),
  };
}

export async function confirmPasswordReset({ token, newPassword, ipAddress, userAgent }) {
  if (!token || !newPassword) {
    throw { statusCode: 400, message: 'Reset token and new password are required.' };
  }

  if (newPassword.length < 6) {
    throw { statusCode: 400, message: 'Password must be at least 6 characters.' };
  }

  const tokenHash = hashToken(token);
  const user = await User.findOne({
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+passwordHash');

  if (!user) {
    throw { statusCode: 400, message: 'Password reset token is invalid or has expired.' };
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetPasswordTokenHash = null;
  user.resetPasswordExpires = null;
  user.authVersion = (user.authVersion || 1) + 1; // Invalidate all existing tokens/sessions
  await user.save();

  // Revoke all existing refresh tokens
  await RefreshToken.updateMany(
    { userId: user._id, revokedAt: null },
    { revokedAt: new Date() }
  );

  await AuthLog.create({
    userId: user._id,
    action: AUTH_ACTIONS.PASSWORD_RESET,
    ipAddress,
    userAgent,
    details: 'Password reset confirmed and sessions invalidated',
  });

  return {
    message: 'Password reset successfully. Please sign in with your new password.',
  };
}

