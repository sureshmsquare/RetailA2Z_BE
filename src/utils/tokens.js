import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function generateAccessToken(payload) {
  const secret = process.env.JWT_ACCESS_SECRET;
  const expiresIn = process.env.ACCESS_TOKEN_EXPIRY || '15m';
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyAccessToken(token) {
  try {
    const secret = process.env.JWT_ACCESS_SECRET;
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

export function setRefreshTokenCookie(res, token) {
  const isProduction = process.env.NODE_ENV === 'production';
  const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge,
    path: '/api/auth',
  });
}

export function clearRefreshTokenCookie(res) {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    path: '/api/auth',
  });
}

