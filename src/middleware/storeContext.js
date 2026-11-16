import StoreMembership from '../models/StoreMembership.js';
import Store from '../models/Store.js';

export async function requireStoreContext(req, res, next) {
  try {
    const requestedStoreId =
      req.headers['x-store-id'] ||
      req.params.storeId ||
      req.body.storeId ||
      req.user?.storeId;

    if (!requestedStoreId) {
      return res.status(400).json({
        success: false,
        message: 'Store context required. Please select an active store.',
      });
    }

    // Verify user membership in requested store
    const membership = await StoreMembership.findOne({
      userId: req.user.userId,
      storeId: requestedStoreId,
      isActive: true,
    })
      .populate('roleId', 'name permissions')
      .populate('storeId', 'storeName storeCode isActive');

    if (!membership || !membership.storeId || !membership.storeId.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have active access to this store.',
      });
    }

    req.membership = membership;
    req.store = membership.storeId;
    req.user.storeId = membership.storeId._id.toString();
    req.user.role = membership.roleId.name;
    req.user.permissions = membership.roleId.permissions || [];

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to verify store context.',
      error: error.message,
    });
  }
}

