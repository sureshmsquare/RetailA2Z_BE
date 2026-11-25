import crypto from 'crypto';

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
 * @param {number} [optDiscountPaise] - Optional approved discount in paise
 * @returns {object} { subtotalPaise, discountPaise, roundOffPaise, totalPaise, itemCount, unitCount, taxBreakup }
 */
export function computeTotals(lines = [], config = {}, optDiscountPaise) {
  let subtotalPaise = 0;
  let itemCount = 0;
  let unitCountRaw = 0;
  const taxGroupMap = new Map(); // ratePercent -> { ratePercent, grossPaise }

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
      if (!taxGroupMap.has(taxRate)) {
        taxGroupMap.set(taxRate, { ratePercent: taxRate, grossPaise: 0 });
      }
      const group = taxGroupMap.get(taxRate);
      group.grossPaise += amount;
    }
  }

  const discountPaise = Math.min(
    subtotalPaise,
    Math.max(
      0,
      Number(optDiscountPaise !== undefined ? optDiscountPaise : (config && config.discountPaise)) || 0
    )
  );
  let afterDiscountPaise = Math.max(0, subtotalPaise - discountPaise);
  let roundOffPaise = 0;
  let totalPaise = afterDiscountPaise;

  const roundOffMode = (config && config.ROUND_OFF_MODE) || 'none';
  if (roundOffMode === 'nearest_rupee') {
    // Round to the nearest 100 paise (nearest rupee) and keep the difference
    const roundedTarget = Math.round(afterDiscountPaise / 100) * 100;
    roundOffPaise = roundedTarget - afterDiscountPaise;
    totalPaise = roundedTarget;
  }

  // Totals never go negative
  totalPaise = Math.max(0, totalPaise);

  const unitCount = Math.round(unitCountRaw * 1000) / 1000;

  // Compute taxBreakup with discount distributed proportionally across tax groups
  const taxBreakup = Array.from(taxGroupMap.values())
    .map((group) => {
      let effectiveGross = group.grossPaise;
      if (subtotalPaise > 0 && discountPaise > 0) {
        effectiveGross = Math.round((group.grossPaise * afterDiscountPaise) / subtotalPaise);
      }
      const taxablePaise = Math.round((effectiveGross * 100) / (100 + group.ratePercent));
      const taxPaise = effectiveGross - taxablePaise;
      return {
        ratePercent: group.ratePercent,
        taxablePaise,
        taxPaise,
      };
    })
    .sort((a, b) => a.ratePercent - b.ratePercent);

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
 * Computes discount and allocates it proportionally across line items (BRD APR-01, BIL-06).
 *
 * @param {object} params
 * @param {Array<object>} [params.lines] - Matched lines array (optional)
 * @param {number} params.lineGrossPaise - Sum of line gross amounts in paise
 * @param {number} [params.discountAmountPaise] - Direct discount in paise
 * @param {number} [params.discountPercent] - Discount percentage (e.g. 5 or 10.5)
 * @returns {{ discountPaise: number, allocation: Array<{ lineId: string|null, discountPaise: number }> }}
 */
export function computeDiscount({ lines = [], lineGrossPaise = 0, discountAmountPaise, discountPercent }) {
  let gross = Number(lineGrossPaise) || 0;
  if (!gross && Array.isArray(lines) && lines.length > 0) {
    gross = lines
      .filter((l) => l.status === 'matched')
      .reduce((sum, l) => sum + (Number(l.amountPaise) || 0), 0);
  }

  let discountPaise = 0;
  if (discountPercent !== undefined && discountPercent !== null) {
    const pct = Math.max(0, Math.min(100, Number(discountPercent)));
    discountPaise = Math.round((gross * pct) / 100);
  } else if (discountAmountPaise !== undefined && discountAmountPaise !== null) {
    discountPaise = Math.min(gross, Math.max(0, Math.round(Number(discountAmountPaise))));
  }

  // Allocate proportionally across lines
  const eligibleLines = (lines || []).filter((l) => l.status === 'matched');
  const allocation = [];

  if (eligibleLines.length > 0 && gross > 0 && discountPaise > 0) {
    let allocatedSum = 0;
    for (let i = 0; i < eligibleLines.length; i++) {
      const line = eligibleLines[i];
      const lineGross = Number(line.amountPaise) || 0;
      let lineDiscount = 0;

      if (i === eligibleLines.length - 1) {
        // Last line absorbs rounding correction so sum matches exactly
        lineDiscount = Math.max(0, discountPaise - allocatedSum);
      } else {
        lineDiscount = Math.round((lineGross * discountPaise) / gross);
        allocatedSum += lineDiscount;
      }

      allocation.push({
        lineId: line.lineId ? line.lineId.toString() : (line._id ? line._id.toString() : null),
        discountPaise: lineDiscount,
      });
    }
  } else if (eligibleLines.length > 0) {
    for (const line of eligibleLines) {
      allocation.push({
        lineId: line.lineId ? line.lineId.toString() : (line._id ? line._id.toString() : null),
        discountPaise: 0,
      });
    }
  }

  return {
    discountPaise,
    allocation,
  };
}

/**
 * Builds a deterministic cryptographic signature of draft lines (BRD APR-03).
 * Stable concat of sorted (lineId + qty + unitType + itemId + sellingPricePaise) hashed with sha256.
 *
 * @param {object} draft - Bill draft document or plain object
 * @returns {string} SHA-256 hex string
 */
export function buildLineSignature(draft) {
  const lines = (draft && draft.lines) || [];
  const parts = lines
    .filter((l) => l.status === 'matched')
    .map((l) => {
      const lineId = String(l.lineId || l._id || '');
      const qty = String(l.quantity || 0);
      const unitType = String(l.unitType || '');
      const itemId = String(l.itemId?._id || l.itemId || '');
      const sellingPricePaise = String(l.rateSnapshotPaise || l.sellingPricePaise || l.amountPaise || 0);
      return `${lineId}:${qty}:${unitType}:${itemId}:${sellingPricePaise}`;
    })
    .sort();

  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
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

