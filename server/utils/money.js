/**
 * Money and Quantity conversions.
 * Money is stored as integer paise (Rs 412.00 = 41200).
 * APIs accept and return rupees; conversion happens strictly at the service boundary.
 */

/**
 * Converts a rupees value (number, string, or decimal) to integer paise.
 * @param {number|string|null|undefined} rupees
 * @returns {number|null} Integer paise, or null if input is null/undefined/empty
 */
export function toPaise(rupees) {
  if (rupees === null || rupees === undefined || rupees === '') {
    return null;
  }
  const num = Number(rupees);
  if (isNaN(num)) {
    return null;
  }
  return Math.round(num * 100);
}

/**
 * Converts integer paise to rupees with 2 decimal precision.
 * @param {number|null|undefined} paise
 * @returns {number|null} Rupees as a decimal number, or null if input is null/undefined
 */
export function toRupees(paise) {
  if (paise === null || paise === undefined) {
    return null;
  }
  const num = Number(paise);
  if (isNaN(num)) {
    return null;
  }
  return Number((num / 100).toFixed(2));
}

export default {
  toPaise,
  toRupees,
};

