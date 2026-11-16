import { verifyAccessToken } from '../utils/tokens.js';
import User from '../models/User.js';

export async function authenticate(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. No token provided.',
      });
    }

    const decoded = verifyAccessToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired access token.',
      });
    }

    // Verify user is still active and session authVersion has not been incremented
    const user = await User.findById(decoded.userId).select('name email isActive authVersion');
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated or does not exist.',
      });
    }

    if (decoded.authVersion !== undefined && user.authVersion !== decoded.authVersion) {
      return res.status(401).json({
        success: false,
        message: 'Session has been invalidated. Please sign in again.',
      });
    }

    req.user = {
      userId: user._id,
      email: user.email,
      name: user.name,
      authVersion: user.authVersion,
      storeId: decoded.storeId || null,
      role: decoded.role || null,
      permissions: decoded.permissions || [],
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Authentication failed.',
      error: error.message,
    });
  }
}

