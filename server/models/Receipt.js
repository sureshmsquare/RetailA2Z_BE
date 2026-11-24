import mongoose from 'mongoose';
import { toRupees } from '../utils/money.js';

const receiptSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    receiptNumber: {
      type: String,
      required: [true, 'Receipt number is required'],
      trim: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      required: [true, 'Invoice reference is required'],
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: true,
      trim: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    receiptDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    amountPaise: {
      type: Number,
      required: [true, 'Receipt amount is required'],
      min: [1, 'Receipt amount must be positive'],
    },
    mode: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'OTHER'],
      required: [true, 'Payment mode is required'],
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    collectedBy: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ['confirmed', 'reversed'],
      default: 'confirmed',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'receipts',
  }
);

receiptSchema.index({ storeId: 1, receiptNumber: 1 }, { unique: true });
receiptSchema.index({ storeId: 1, invoiceId: 1 });
receiptSchema.index({ storeId: 1, customerId: 1, receiptDate: -1 });

export function formatReceiptForResponse(doc) {
  if (!doc) return null;
  const raw = doc.toObject ? doc.toObject() : { ...doc };
  const id = raw._id ? String(raw._id) : raw.id;

  return {
    id,
    _id: id,
    receiptNumber: raw.receiptNumber,
    invoiceId: raw.invoiceId ? String(raw.invoiceId) : null,
    invoiceNumber: raw.invoiceNumber,
    customerId: raw.customerId ? String(raw.customerId) : null,
    receiptDate: raw.receiptDate,
    amount: toRupees(raw.amountPaise),
    mode: raw.mode,
    reference: raw.reference || '',
    notes: raw.notes || '',
    status: raw.status,
    collectedBy: raw.collectedBy,
    createdAt: raw.createdAt,
  };
}

const Receipt = mongoose.model('Receipt', receiptSchema);
export default Receipt;

