import { verifyToken } from '../utils/tokens.js';
import User from '../models/User.js';
import Store from '../models/Store.js';

/**
 * Authentication Middleware:
 * Verifies JWT and verifies that user is still active in the database.
 * This runs on EVERY request so a deactivated user loses access immediately,
 * even if holding an old unexpired token.
 */
export async function authenticate(req, res, next) {
  try {
    let token = null;

    // Check Bearer token in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.',
      });
    }

    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session token.',
      });
    }

    // Always fetch fresh user from database on every request
    const user = await User.findById(decoded.id).populate('storeIds', 'name address gstin timezone isActive');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found.',
      });
    }

    // Immediately reject deactivated user on next request
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'User account is deactivated. Access revoked.',
      });
    }

    // Attach user to request object
    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Authentication processing failed.',
      error: error.message,
    });
  }
}

/**
 * Role-based Authorization Middleware:
 * e.g. authorize('admin'), authorize('admin', 'salesman')
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: role '${req.user.role}' lacks permission for this resource.`,
      });
    }

    next();
  };
}

/**
 * Store-wise Access Control Middleware:
 * Reads header "x-store-id" (case-insensitive);
 * Returns 403 if the user is not assigned to that store.
 * Attaches req.storeId and req.store.
 */
export async function requireStoreAccess(req, res, next) {
  try {
    const storeIdHeader = req.headers['x-store-id'] || req.headers['x-storeid'];

    if (!storeIdHeader) {
      return res.status(400).json({
        success: false,
        message: 'Header "x-store-id" is required to access store-scoped data.',
      });
    }

    const requestedStoreId = storeIdHeader.toString().trim();

    // Check if user has this store assigned in user.storeIds
    const assignedStores = (req.user?.storeIds || []).map((s) =>
      s._id ? s._id.toString() : s.toString()
    );

    const hasAccess = assignedStores.includes(requestedStoreId);

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: You do not have access to store ${requestedStoreId}.`,
      });
    }

    // Verify store exists and is active in DB
    const store = await Store.findById(requestedStoreId);
    if (!store || !store.isActive) {
      return res.status(404).json({
        success: false,
        message: 'The requested store was not found or is currently inactive.',
      });
    }

    // Attach verified store context
    req.storeId = requestedStoreId;
    req.store = store;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to evaluate store context.',
      error: error.message,
    });
  }
}

/**
 * RULE FOR THE WHOLE PROJECT:
 * Every future collection (items, customers, bills, receipts, stock) will have a storeId field
 * and every query must be filtered by the selected store.
 * A user must never read or write another store's record, even via direct URL or API call.
 *
 * @param {Object} query - MongoDB query filter object
 * @param {string|ObjectId} storeId - Validated store ID
 * @returns {Object} Scoped query object with { storeId } applied
 */
export function scopeToStore(query = {}, storeId) {
  if (!storeId) {
    throw new Error('scopeToStore requires a valid storeId');
  }
  return {
    ...query,
    storeId,
  };
}

