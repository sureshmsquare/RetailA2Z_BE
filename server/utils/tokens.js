import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'retaila2z_jwt_super_secret_key_2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || process.env.ACCESS_TOKEN_EXPIRY || '30m';

/**
 * Generate a signed JWT for the authenticated user
 */
export function generateToken(user) {
  const payload = {
    id: user._id.toString(),
    role: user.role,
    storeIds: (user.storeIds || []).map((s) => (s._id ? s._id.toString() : s.toString())),
  };

  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * Verify a JWT and decode its payload
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

