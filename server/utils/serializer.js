import { toRupees } from './money.js';
import { computeTotals, computeCreditImpact } from './billTotals.js';

/**
 * PRICE VISIBILITY RULE:
 * Salesman and collections users must NEVER receive item rate, MRP, cost or margin
 * in ANY API response (search, drafts, previews, exports).
 *
 * Enforced at the backend serialization layer.
 *
 * @param {Object} item - Item / product record (plain object or Mongoose document)
 * @param {string} role - The user's role ("admin", "salesman", "collections")
 * @returns {Object} Serialized item with price fields stripped for non-admin roles
 */
export function serializeItemForRole(item, role) {
  if (!item) return item;

  // Convert Mongoose doc if applicable
  const raw = item.toObject ? item.toObject() : { ...item };

  // Admins are permitted to see full financial pricing, margins, cost, and rates
  if (role === 'admin') {
    return raw;
  }

  // Strip sensitive price, cost, margin, rate, and MRP fields for salesman and collections roles
  const restrictedFields = [
    'rate',
    'mrp',
    'mrpPaise',
    'cost',
    'costPrice',
    'purchasePrice',
    'sellingPrice',
    'sellingPricePaise',
    'price',
    'margin',
    'marginPercent',
    'discountRate',
    'wholesalePrice',
    'mrpSource',
    'codeSource',
  ];

  for (const field of restrictedFields) {
    delete raw[field];
  }

  // Strip nested price fields if present
  if (raw.pricing && typeof raw.pricing === 'object') {
    delete raw.pricing;
  }

  return raw;
}

/**
 * Convenience helper to serialize an array of items for a user role
 */
export function serializeItemListForRole(items, role) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => serializeItemForRole(item, role));
}

/**
 * Serializes a BillDraft according to the user's role and validation context.
 *
 * Salesman sees: item, quantity, unit, and the BILL TOTAL only.
 * No rate, MRP, cost, line amounts, subtotal, roundOff, or taxBreakup for salesman.
 * Admin sees full financial breakdowns, line rates, amounts, subtotals, roundOff, and taxBreakup.
 *
 * @param {object} draft - BillDraft document or plain object
 * @param {string} role - The user's role ("admin" | "salesman")
 * @param {object} [context] - Context containing stockBalances, itemsMap, creditProfile, validation, config
 * @returns {object} Serialized draft
 */
export function serializeDraftForRole(draft, role, context = {}) {
  if (!draft) return null;

  const raw = draft.toObject ? draft.toObject() : { ...draft };
  const stockBalances = context.stockBalances || {};
  const itemsMap = context.itemsMap || new Map();
  const creditProfile = context.creditProfile || null;
  const config = context.config || {};
  const validation = context.validation || {
    blockers: [],
    warnings: [],
    requiredApprovals: [],
    readyToSubmit: false,
  };

  const rawLines = raw.lines || [];

  // Group total requested quantity per item across all matched lines
  const totalRequestedByItem = {};
  for (const line of rawLines) {
    if (line.itemId && line.status === 'matched') {
      const idStr = line.itemId.toString();
      totalRequestedByItem[idStr] = (totalRequestedByItem[idStr] || 0) + (Number(line.quantityBase) || 0);
    }
  }

  // Map and serialize lines
  const lines = rawLines.map((line) => {
    const itemIdStr = line.itemId ? line.itemId.toString() : null;
    const rawAvailable =
      itemIdStr && stockBalances[itemIdStr] !== undefined ? stockBalances[itemIdStr] : null;
    const availableBase =
      rawAvailable !== null && rawAvailable !== undefined && !isNaN(Number(rawAvailable))
        ? Math.round(Number(rawAvailable) * 1000) / 1000
        : null;

    const totalRequested = itemIdStr ? (totalRequestedByItem[itemIdStr] || 0) : (Number(line.quantityBase) || 0);
    const enough = availableBase !== null ? availableBase >= totalRequested : false;

    const currentItem = itemIdStr ? itemsMap.get(itemIdStr) : null;
    const priceChanged =
      currentItem &&
      currentItem.sellingPricePaise !== null &&
      currentItem.sellingPricePaise !== undefined
        ? currentItem.sellingPricePaise !== line.rateSnapshotPaise
        : false;

    const baseLine = {
      lineId: line.lineId ? line.lineId.toString() : null,
      status: line.status,
      productCode: line.productCode || '',
      itemName: line.itemName || '',
      specText: line.specText || '',
      quantity: line.quantity,
      unitType: line.unitType,
      unitLabel: line.unitLabel,
      quantityBase: line.quantityBase,
      unclearReason: line.unclearReason || null,
      inputText: line.inputText || '',
      sourceKind: line.sourceKind || 'typed',
      suggestions: (line.suggestions || []).map((s) => ({
        itemId: s.itemId ? s.itemId.toString() : '',
        productCode: s.productCode,
        name: s.name,
      })),
      stock: {
        availableBase,
        enough,
      },
      priceChanged,
    };

    // ADMIN ONLY: rate and amount per line
    if (role === 'admin') {
      baseLine.rate = toRupees(line.rateSnapshotPaise);
      baseLine.amount = toRupees(line.amountPaise);
    }

    return baseLine;
  });

  // Calculate summary
  const matchedLines = rawLines.filter((l) => l.status === 'matched');
  const unclearLines = rawLines.filter((l) => l.status === 'unclear');
  const unitCountRaw = matchedLines.reduce(
    (acc, l) => acc + (Number(l.quantityBase) || 0),
    0
  );

  const summary = {
    lineCount: rawLines.length,
    matchedCount: matchedLines.length,
    unclearCount: unclearLines.length,
    unitCount: Math.round(unitCountRaw * 1000) / 1000,
  };

  // Calculate totals
  const computedTotals = computeTotals(rawLines, config);

  const totals = {
    total: toRupees(computedTotals.totalPaise),
  };

  if (role === 'admin') {
    totals.subtotal = toRupees(computedTotals.subtotalPaise);
    totals.roundOff = toRupees(computedTotals.roundOffPaise);
    totals.taxBreakup = (computedTotals.taxBreakup || []).map((t) => ({
      ratePercent: t.ratePercent,
      taxable: toRupees(t.taxablePaise),
      tax: toRupees(t.taxPaise),
    }));
  }

  // Format credit information
  let credit = null;
  if (creditProfile) {
    const terms =
      creditProfile.creditAllowed && creditProfile.creditDays
        ? `${creditProfile.creditDays} days`
        : 'No credit';

    let status = 'within_limit';
    if (creditProfile.creditRestricted) {
      status = 'restricted';
    } else if (!creditProfile.creditAllowed) {
      status = 'no_credit';
    } else if (creditProfile.overduePaise > 0) {
      status = 'overdue';
    } else if (creditProfile.outstandingPaise > creditProfile.creditLimitPaise) {
      status = 'over_limit';
    } else {
      status = 'within_limit';
    }

    const availableCreditPaise = Math.max(
      0,
      creditProfile.creditLimitPaise - creditProfile.outstandingPaise
    );

    credit = {
      terms,
      status,
      creditLimit: toRupees(creditProfile.creditLimitPaise),
      outstanding: toRupees(creditProfile.outstandingPaise),
      overdue: toRupees(creditProfile.overduePaise),
      oldestOverdueDays: creditProfile.oldestOverdueDays,
      availableCredit: toRupees(availableCreditPaise),
    };

    if (raw.billType === 'credit') {
      const impact = computeCreditImpact({
        outstandingPaise: creditProfile.outstandingPaise,
        creditLimitPaise: creditProfile.creditLimitPaise,
        totalPaise: computedTotals.totalPaise,
      });

      credit.impact = {
        newOutstanding: toRupees(impact.newOutstandingPaise),
        availableCreditAfter: toRupees(impact.availableCreditAfterPaise),
        overLimit: impact.overLimit,
      };
    }
  }

  // Format customer
  let customerObj = null;
  if (creditProfile) {
    customerObj = {
      id: creditProfile.customerId,
      code: creditProfile.code,
      name: creditProfile.name,
      mobile: creditProfile.mobile,
    };
  } else if (raw.customerId && typeof raw.customerId === 'object') {
    customerObj = {
      id: raw.customerId._id ? raw.customerId._id.toString() : raw.customerId.toString(),
      code: raw.customerId.customerCode || '',
      name: raw.customerId.name || '',
      mobile: raw.customerId.mobile || '',
    };
  }

  return {
    id: raw._id.toString(),
    draftNumber: raw.draftNumber,
    status: raw.status,
    version: raw.version,
    billType: raw.billType,
    customer: customerObj,
    walkIn: raw.walkIn || { name: '', mobile: '' },
    lines,
    summary,
    totals,
    credit,
    blockers: validation.blockers || [],
    warnings: validation.warnings || [],
    requiredApprovals: validation.requiredApprovals || [],
    readyToSubmit: Boolean(validation.readyToSubmit),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export default {
  serializeItemForRole,
  serializeItemListForRole,
  serializeDraftForRole,
};
