/**
 * RetailA2Z Phone / Mobile normalization utilities
 *
 * Rules:
 * - Strip spaces, dashes, parentheses, and formatting delimiters
 * - Strip leading +91 or 91 (when 12 digits)
 * - Strip leading 0 (when 11 digits)
 * - Result must be exactly 10 digits starting with 6-9
 */

export function normalizeIndianMobile(rawMobile) {
  if (rawMobile === null || rawMobile === undefined) return null;
  const str = String(rawMobile).trim();
  if (!str) return null;

  // Remove spaces, dashes, parentheses, dots
  let cleaned = str.replace(/[\s\-_().]/g, '');

  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // If 12 digits starting with 91
  if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  }

  // If 11 digits starting with 0
  if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = cleaned.slice(1);
  }

  // Must be 10 digits starting with 6-9
  if (/^[6-9]\d{9}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

export function isValidIndianMobile(rawMobile) {
  if (rawMobile === null || rawMobile === undefined) return false;
  const str = String(rawMobile).trim();
  if (!str) return false;
  return normalizeIndianMobile(rawMobile) !== null;
}

export default {
  normalizeIndianMobile,
  isValidIndianMobile,
};

