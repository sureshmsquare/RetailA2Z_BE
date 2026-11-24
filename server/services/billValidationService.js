import { toRupees } from '../utils/money.js';
import { computeCreditImpact } from '../utils/billTotals.js';
import billingConfig from '../config/billingConfig.js';

/**
 * Pure validation engine for Bill Drafts.
 * Evaluates draft against item states, stock balances, customer credit, and system policies.
 *
 * @param {object} draft - BillDraft document or plain object
 * @param {object} context - Validation context
 * @param {Map<string, object>} [context.itemsMap] - Map of itemId (string) -> Item document
 * @param {Record<string, number>} [context.stockBalances] - Item stock balances map (itemId -> number)
 * @param {object|null} [context.creditProfile] - Customer credit profile from customerCreditAdapter
 * @param {object} [context.config] - Billing config (STOCK_POLICY, OVERDUE_POLICY, MAX_QUANTITY)
 * @returns {object} { blockers: Array, warnings: Array, requiredApprovals: Array, readyToSubmit: boolean }
 */
export function evaluateDraft(draft, context = {}) {
  const blockers = [];
  const warnings = [];
  const requiredApprovals = [];

  const config = context.config || billingConfig;
  const itemsMap = context.itemsMap || new Map();
  const stockBalances = context.stockBalances || {};
  const creditProfile = context.creditProfile || null;

  const lines = draft.lines || [];

  // 1. Check for empty draft
  if (!lines || lines.length === 0) {
    blockers.push({
      code: 'EMPTY_DRAFT',
      message: 'Draft has no items. Add at least one item line to proceed.',
    });
  }

  // 2. Check for unclear lines
  const unclearLines = lines.filter((l) => l.status === 'unclear');
  if (unclearLines.length > 0) {
    blockers.push({
      code: 'UNRESOLVED_LINES',
      count: unclearLines.length,
      message: `${unclearLines.length} item line(s) are unclear. Correct or remove them before proceeding.`,
    });

    for (const line of unclearLines) {
      blockers.push({
        code: 'UNRESOLVED_LINE',
        lineId: line.lineId ? line.lineId.toString() : null,
        reason: line.unclearReason || 'unclear',
        message: `Line "${line.inputText || line.productCode || 'unknown'}" is unresolved: ${line.unclearReason || 'unclear'}.`,
      });
    }
  }

  // 3. Matched lines: Quantity validation, Item status, and Stock accumulation
  const requestedByItem = new Map(); // itemId (string) -> number
  let priceChangedCount = 0;

  const maxQty = config.MAX_QUANTITY || 999999.999;

  for (const line of lines) {
    if (line.status !== 'matched') continue;

    const lineIdStr = line.lineId ? line.lineId.toString() : null;
    const qty = Number(line.quantity);

    // Quantity checks
    if (!qty || qty <= 0 || qty > maxQty) {
      blockers.push({
        code: 'INVALID_QUANTITY',
        lineId: lineIdStr,
        message: `Line "${line.itemName || line.productCode}" has invalid quantity ${qty}.`,
      });
    } else {
      const qtyStr = String(line.quantity);
      if (qtyStr.includes('.') && qtyStr.split('.')[1].length > 3) {
        blockers.push({
          code: 'INVALID_QUANTITY',
          lineId: lineIdStr,
          message: `Line "${line.itemName || line.productCode}" has more than 3 decimal places in quantity.`,
        });
      }
    }

    // Item state check (active, priced)
    const itemIdStr = line.itemId ? line.itemId.toString() : null;
    const currentItem = itemIdStr ? itemsMap.get(itemIdStr) : null;

    if (
      !currentItem ||
      currentItem.status !== 'active' ||
      currentItem.sellingPricePaise === null ||
      currentItem.sellingPricePaise === undefined
    ) {
      blockers.push({
        code: 'ITEM_UNAVAILABLE',
        lineId: lineIdStr,
        itemId: itemIdStr,
        message: `Item "${line.itemName || line.productCode}" is unavailable, deactivated, or unpriced.`,
      });
    } else {
      // Price change warning check
      if (
        currentItem.sellingPricePaise !== undefined &&
        currentItem.sellingPricePaise !== line.rateSnapshotPaise
      ) {
        priceChangedCount += 1;
      }
    }

    // Accumulate total base quantity per item
    if (itemIdStr) {
      const currentReq = requestedByItem.get(itemIdStr) || 0;
      requestedByItem.set(itemIdStr, currentReq + (Number(line.quantityBase) || 0));
    }
  }

  // 4. Stock validation
  const stockPolicy = config.STOCK_POLICY || 'block'; // 'block' | 'warn'

  for (const [itemIdStr, totalRequested] of requestedByItem.entries()) {
    const availableBase = stockBalances[itemIdStr] !== undefined ? stockBalances[itemIdStr] : 0;

    if (totalRequested > availableBase) {
      const stockPayload = {
        code: 'INSUFFICIENT_STOCK',
        itemId: itemIdStr,
        requestedBase: totalRequested,
        availableBase,
        message: `Insufficient stock for item. Requested ${totalRequested}, available ${availableBase}.`,
      };

      if (stockPolicy === 'block') {
        blockers.push(stockPayload);
      } else if (stockPolicy === 'warn') {
        warnings.push(stockPayload);
      }
    }
  }

  // 5. Price changed warning
  if (priceChangedCount > 0) {
    warnings.push({
      code: 'PRICE_CHANGED',
      count: priceChangedCount,
      message: `${priceChangedCount} line(s) have updated prices since they were added to the draft.`,
    });
  }

  // 6. Customer & Credit validation
  const isCreditBill = draft.billType === 'credit';

  if (isCreditBill) {
    if (!draft.customerId) {
      blockers.push({
        code: 'CREDIT_CUSTOMER_REQUIRED',
        message: 'A customer account is required for credit bills.',
      });
    } else if (creditProfile) {
      if (!creditProfile.isActive) {
        blockers.push({
          code: 'CUSTOMER_INACTIVE',
          message: 'Selected customer account is inactive.',
        });
      }

      if (!creditProfile.creditAllowed) {
        blockers.push({
          code: 'CREDIT_NOT_ALLOWED',
          message: 'Selected customer is not approved for credit purchases.',
        });
      }

      if (creditProfile.creditRestricted) {
        blockers.push({
          code: 'CREDIT_RESTRICTED',
          message: 'Customer account has credit restrictions.',
        });
      }

      // Overdue policy evaluation
      if (creditProfile.overduePaise > 0) {
        const overduePolicy = config.OVERDUE_POLICY || 'warn'; // 'warn' | 'approval' | 'block'
        if (overduePolicy === 'block') {
          blockers.push({
            code: 'OVERDUE_BLOCKED',
            overdue: toRupees(creditProfile.overduePaise),
            days: creditProfile.oldestOverdueDays,
            message: `Customer has overdue balance of Rs ${toRupees(creditProfile.overduePaise)} (${creditProfile.oldestOverdueDays} days). Credit billing is blocked.`,
          });
        } else if (overduePolicy === 'approval') {
          requiredApprovals.push({
            kind: 'overdue_override',
            overdue: toRupees(creditProfile.overduePaise),
            days: creditProfile.oldestOverdueDays,
            message: `Customer has overdue balance of Rs ${toRupees(creditProfile.overduePaise)}. Admin overdue override is required.`,
          });
        } else if (overduePolicy === 'warn') {
          warnings.push({
            code: 'OVERDUE_CUSTOMER',
            overdue: toRupees(creditProfile.overduePaise),
            days: creditProfile.oldestOverdueDays,
            message: `Customer has overdue balance of Rs ${toRupees(creditProfile.overduePaise)} (${creditProfile.oldestOverdueDays} days).`,
          });
        }
      }

      // Credit limit & impact evaluation
      const billTotalPaise = Number(draft.totalPaise) || 0;
      const impact = computeCreditImpact({
        outstandingPaise: creditProfile.outstandingPaise,
        creditLimitPaise: creditProfile.creditLimitPaise,
        totalPaise: billTotalPaise,
      });

      // Credit bill over limit or creditLimit is 0 needs credit_override approval
      if (impact.overLimit || creditProfile.creditLimitPaise === 0) {
        requiredApprovals.push({
          kind: 'credit_override',
          message: 'Bill total exceeds available customer credit limit. Admin credit override is required.',
          newOutstanding: toRupees(impact.newOutstandingPaise),
          creditLimit: toRupees(creditProfile.creditLimitPaise),
        });
      }
    }

    // Walk-in detail warning on credit bill
    if (draft.walkIn && (draft.walkIn.name || draft.walkIn.mobile)) {
      warnings.push({
        code: 'WALKIN_ON_CREDIT_IGNORED',
        message: 'Walk-in customer details are ignored on credit bills.',
      });
    }
  }

  const readyToSubmit = blockers.length === 0 && requiredApprovals.length === 0;

  return {
    blockers,
    warnings,
    requiredApprovals,
    readyToSubmit,
  };
}

export default {
  evaluateDraft,
};

