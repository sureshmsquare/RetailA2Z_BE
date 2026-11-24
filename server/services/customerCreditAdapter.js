import mongoose from 'mongoose';
import Customer from '../models/Customer.js';
import { scopeToStore } from '../middleware/auth.js';
import { toRupees } from '../utils/money.js';

/**
 * Live invoice balance provider calculated directly from posted open invoices.
 * BR-05 & CR-02: Live sum of unpaid/part_paid invoice balances and derived overdue days.
 */
async function defaultInvoiceBalanceProvider(storeId, customerId, session = null) {
  try {
    const Invoice = mongoose.models.Invoice;
    if (!Invoice) {
      return { outstandingPaise: 0, overduePaise: 0, oldestOverdueDays: 0 };
    }
    const openInvoices = await Invoice.find({
      storeId: new mongoose.Types.ObjectId(String(storeId)),
      'customer.customerId': new mongoose.Types.ObjectId(String(customerId)),
      settlementStatus: { $in: ['unpaid', 'part_paid'] },
      status: 'posted',
    }).session(session || null);

    let outstandingPaise = 0;
    let overduePaise = 0;
    let oldestOverdueDays = 0;
    const now = new Date();

    for (const inv of openInvoices) {
      const bal = Number(inv.payment?.balancePaise) || 0;
      outstandingPaise += bal;
      if (inv.dueDate && now.getTime() > new Date(inv.dueDate).getTime()) {
        overduePaise += bal;
        const days = Math.max(
          1,
          Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        );
        if (days > oldestOverdueDays) oldestOverdueDays = days;
      }
    }
    return { outstandingPaise, overduePaise, oldestOverdueDays };
  } catch {
    return { outstandingPaise: 0, overduePaise: 0, oldestOverdueDays: 0 };
  }
}

let invoiceBalanceProvider = defaultInvoiceBalanceProvider;

/**
 * Test helper to override the balance provider for mocking in tests.
 */
export function setInvoiceBalanceProvider(providerFn) {
  invoiceBalanceProvider = providerFn;
}

/**
 * Test helper to reset the balance provider to its default calculation.
 */
export function resetInvoiceBalanceProvider() {
  invoiceBalanceProvider = defaultInvoiceBalanceProvider;
}

/**
 * Customer Credit Adapter - The ONLY place in billing that knows Customer model field names.
 * Maps Customer model fields:
 * - _id -> customerId
 * - customerCode -> code
 * - name -> name
 * - mobile -> mobile
 * - isActive -> isActive
 * - creditEnabled -> creditAllowed
 * - creditLimitPaise -> creditLimitPaise
 * - creditDays -> creditDays
 * - creditRestricted (or false if undefined) -> creditRestricted
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {string|mongoose.Types.ObjectId} customerId
 * @param {mongoose.ClientSession|null} [session]
 * @returns {Promise<object|null>} Normalized credit profile
 */
export async function getCreditProfile(storeId, customerId, session = null) {
  if (!customerId) return null;

  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const customerObjectId = new mongoose.Types.ObjectId(String(customerId));

  const customer = await Customer.findOne(
    scopeToStore({ _id: customerObjectId }, storeObjectId)
  ).session(session || null);

  if (!customer) return null;

  const balances = await invoiceBalanceProvider(storeObjectId, customerObjectId, session);

  const creditAllowed = Boolean(customer.creditEnabled);
  const creditLimitPaise =
    creditAllowed && customer.creditLimitPaise !== null && customer.creditLimitPaise !== undefined
      ? Number(customer.creditLimitPaise)
      : 0;
  const creditDays = creditAllowed && customer.creditDays ? Number(customer.creditDays) : null;
  const creditRestricted = Boolean(customer.creditRestricted);

  return {
    customerId: customer._id.toString(),
    code: customer.customerCode || '',
    name: customer.name || '',
    mobile: customer.mobile || '',
    isActive: Boolean(customer.isActive),
    creditAllowed,
    creditLimitPaise,
    creditDays,
    creditRestricted,
    outstandingPaise: Number(balances?.outstandingPaise) || 0,
    overduePaise: Number(balances?.overduePaise) || 0,
    oldestOverdueDays: Number(balances?.oldestOverdueDays) || 0,
  };
}

/**
 * Returns customer credit details formatted for the billing credit panel.
 *
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {string|mongoose.Types.ObjectId} customerId
 * @param {mongoose.ClientSession|null} [session]
 * @returns {Promise<object|null>} Credit panel data
 */
export async function getCustomerCredit(storeId, customerId, session = null) {
  const profile = await getCreditProfile(storeId, customerId, session);
  if (!profile) return null;

  const terms =
    profile.creditAllowed && profile.creditDays ? `${profile.creditDays} days` : 'No credit';

  let status = 'within_limit';
  if (profile.creditRestricted) {
    status = 'restricted';
  } else if (!profile.creditAllowed) {
    status = 'no_credit';
  } else if (profile.overduePaise > 0) {
    status = 'overdue';
  } else if (profile.outstandingPaise > profile.creditLimitPaise) {
    status = 'over_limit';
  } else {
    status = 'within_limit';
  }

  const availableCreditPaise = Math.max(0, profile.creditLimitPaise - profile.outstandingPaise);

  return {
    ...profile,
    terms,
    status,
    creditLimit: toRupees(profile.creditLimitPaise),
    outstanding: toRupees(profile.outstandingPaise),
    overdue: toRupees(profile.overduePaise),
    availableCredit: toRupees(availableCreditPaise),
  };
}

export default {
  getCreditProfile,
  getCustomerCredit,
  setInvoiceBalanceProvider,
  resetInvoiceBalanceProvider,
};

