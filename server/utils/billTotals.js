/**
 * Bill Totals and Financial Calculations Utility
 * The ONLY place in billing with money formulas.
 *
 * Money is stored as integer paise.
 * Quantities are handled in thousandths when multiplying to avoid floating-point drift.
 */

/**
 * Computes line amount in paise using integer math.
 * amountPaise = Math.round((Math.round(quantityBase * 1000) * rateSnapshotPaise) / 1000)
 *
 * @param {number} quantityBase - Base quantity
 * @param {number} ratePaise - Selling price in paise per base unit
 * @returns {number} Amount in paise (integer)
 */
export function computeLineAmount(quantityBase, ratePaise) {
  if (!quantityBase || quantityBase <= 0 || !ratePaise || ratePaise <= 0) {
    return 0;
  }
  const qtyThousandths = Math.round(Number(quantityBase) * 1000);
  const rate = Math.round(Number(ratePaise));
  return Math.round((qtyThousandths * rate) / 1000);
}

/**
 * Computes draft totals, item count, unit count, and informational tax breakup.
 *
 * @param {Array<object>} lines - Array of bill draft line objects
 * @param {object} [config] - Billing configuration (ROUND_OFF_MODE, etc.)
 * @returns {object} { subtotalPaise, discountPaise, roundOffPaise, totalPaise, itemCount, unitCount, taxBreakup }
 */
export function computeTotals(lines = [], config = {}) {
  let subtotalPaise = 0;
  let itemCount = 0;
  let unitCountRaw = 0;
  const taxGroupMap = new Map(); // ratePercent -> { taxablePaise, taxPaise }

  for (const line of lines) {
    if (line.status !== 'matched') continue;

    const amount = Number(line.amountPaise) || 0;
    subtotalPaise += amount;
    itemCount += 1;
    unitCountRaw += Number(line.quantityBase) || 0;

    // Informational tax breakup for items with taxRatePercent > 0
    const taxRate = line.taxRatePercent !== undefined && line.taxRatePercent !== null
      ? Number(line.taxRatePercent)
      : (line.tax && line.tax.taxRatePercent !== undefined ? Number(line.tax.taxRatePercent) : null);

    if (taxRate !== null && !isNaN(taxRate) && taxRate > 0) {
      // Prices are tax-inclusive: taxable = round(amount * 100 / (100 + rate)), tax = amount - taxable
      const taxable = Math.round((amount * 100) / (100 + taxRate));
      const tax = amount - taxable;

      if (!taxGroupMap.has(taxRate)) {
        taxGroupMap.set(taxRate, { ratePercent: taxRate, taxablePaise: 0, taxPaise: 0 });
      }
      const group = taxGroupMap.get(taxRate);
      group.taxablePaise += taxable;
      group.taxPaise += tax;
    }
  }

  const discountPaise = 0; // Placeholder for Approvals / Discounts module
  let afterDiscountPaise = Math.max(0, subtotalPaise - discountPaise);
  let roundOffPaise = 0;
  let totalPaise = afterDiscountPaise;

  const roundOffMode = config.ROUND_OFF_MODE || 'none';
  if (roundOffMode === 'nearest_rupee') {
    // Round to the nearest 100 paise (nearest rupee) and keep the difference
    const roundedTarget = Math.round(afterDiscountPaise / 100) * 100;
    roundOffPaise = roundedTarget - afterDiscountPaise;
    totalPaise = roundedTarget;
  }

  // Totals never go negative
  totalPaise = Math.max(0, totalPaise);

  const unitCount = Math.round(unitCountRaw * 1000) / 1000;

  const taxBreakup = Array.from(taxGroupMap.values()).sort((a, b) => a.ratePercent - b.ratePercent);

  return {
    subtotalPaise,
    discountPaise,
    roundOffPaise,
    totalPaise,
    itemCount,
    unitCount,
    taxBreakup,
  };
}

/**
 * Computes credit impact of a bill draft on customer's credit standing.
 * BR-05: newOutstanding = currentOutstanding + billTotal; availableCreditAfter = creditLimit - newOutstanding.
 *
 * @param {object} params
 * @param {number} params.outstandingPaise - Current customer outstanding in paise
 * @param {number} params.creditLimitPaise - Customer credit limit in paise
 * @param {number} params.totalPaise - Current bill total in paise
 * @returns {object} { newOutstandingPaise, availableCreditAfterPaise, overLimit }
 */
export function computeCreditImpact({ outstandingPaise = 0, creditLimitPaise = 0, totalPaise = 0 }) {
  const currentOutstanding = Math.max(0, Number(outstandingPaise) || 0);
  const creditLimit = Math.max(0, Number(creditLimitPaise) || 0);
  const billTotal = Math.max(0, Number(totalPaise) || 0);

  const newOutstandingPaise = currentOutstanding + billTotal;
  const availableCreditAfterPaise = creditLimit - newOutstandingPaise;
  const overLimit = newOutstandingPaise > creditLimit;

  return {
    newOutstandingPaise,
    availableCreditAfterPaise,
    overLimit,
  };
}

export default {
  computeLineAmount,
  computeTotals,
  computeCreditImpact,
};

