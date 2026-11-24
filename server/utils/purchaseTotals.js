/**
 * RetailA2Z Purchase Totals Utility
 *
 * Isolates line amount and purchase total calculations.
 * All computations use integer paise. No tax calculations in this task.
 */

/**
 * Computes the total amount in paise for a single purchase line:
 * quantity * costPaise, rounded to the nearest integer paise.
 *
 * @param {Object} line
 * @param {number} line.quantity - Quantity purchased in chosen unitType
 * @param {number} line.costPaise - Cost in paise per chosen unit
 * @returns {number} Integer amount in paise
 */
export function computeLineAmount({ quantity, costPaise }) {
  const qty = Number(quantity);
  const cost = Number(costPaise);
  if (isNaN(qty) || isNaN(cost) || qty <= 0 || cost < 0) {
    return 0;
  }
  return Math.round(qty * cost);
}

/**
 * Computes the total amount in paise for an entire purchase by summing line amounts.
 *
 * @param {Array<Object>} lines
 * @returns {number} Total amount in integer paise
 */
export function computePurchaseTotal(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return 0;
  }
  return lines.reduce((total, line) => {
    const lineAmount =
      line.amountPaise !== undefined && line.amountPaise !== null
        ? Number(line.amountPaise)
        : computeLineAmount(line);
    return total + (isNaN(lineAmount) ? 0 : lineAmount);
  }, 0);
}

export default {
  computeLineAmount,
  computePurchaseTotal,
};

