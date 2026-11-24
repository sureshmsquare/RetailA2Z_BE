import mongoose from 'mongoose';
import { toRupees } from '../utils/money.js';

const customerCreditHistorySchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer ID is required'],
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store ID is required'],
      index: true,
    },
    oldCreditEnabled: {
      type: Boolean,
      default: false,
    },
    newCreditEnabled: {
      type: Boolean,
      required: true,
    },
    oldCreditLimitPaise: {
      type: Number,
      default: null,
    },
    newCreditLimitPaise: {
      type: Number,
      default: null,
    },
    oldCreditDays: {
      type: Number,
      default: null,
    },
    newCreditDays: {
      type: Number,
      default: null,
    },
    changedBy: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: false,
    collection: 'customer_credit_history',
  }
);

customerCreditHistorySchema.index({ customerId: 1, changedAt: -1 });
customerCreditHistorySchema.index({ storeId: 1, changedAt: -1 });

export function formatCreditHistoryForResponse(historyDoc) {
  if (!historyDoc) return null;
  const raw = historyDoc.toObject ? historyDoc.toObject() : { ...historyDoc };

  const id = raw._id ? String(raw._id) : raw.id;
  const customerId = raw.customerId ? String(raw.customerId) : null;
  const storeId = raw.storeId ? String(raw.storeId) : null;

  const oldCreditLimit =
    raw.oldCreditLimitPaise !== null && raw.oldCreditLimitPaise !== undefined
      ? toRupees(raw.oldCreditLimitPaise)
      : null;
  const newCreditLimit =
    raw.newCreditLimitPaise !== null && raw.newCreditLimitPaise !== undefined
      ? toRupees(raw.newCreditLimitPaise)
      : null;

  return {
    id,
    _id: id,
    customerId,
    customer_id: customerId,
    storeId,
    store_id: storeId,
    oldCreditEnabled: Boolean(raw.oldCreditEnabled),
    old_credit_enabled: Boolean(raw.oldCreditEnabled),
    newCreditEnabled: Boolean(raw.newCreditEnabled),
    new_credit_enabled: Boolean(raw.newCreditEnabled),
    oldCreditLimit,
    old_credit_limit: oldCreditLimit,
    newCreditLimit,
    new_credit_limit: newCreditLimit,
    oldCreditDays: raw.oldCreditDays ?? null,
    old_credit_days: raw.oldCreditDays ?? null,
    newCreditDays: raw.newCreditDays ?? null,
    new_credit_days: raw.newCreditDays ?? null,
    changedBy: raw.changedBy,
    changed_by: raw.changedBy,
    changedAt: raw.changedAt,
    changed_at: raw.changedAt,
    reason: raw.reason || '',
  };
}

const CustomerCreditHistory = mongoose.model(
  'CustomerCreditHistory',
  customerCreditHistorySchema
);

export default CustomerCreditHistory;
