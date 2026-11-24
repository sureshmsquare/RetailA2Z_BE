import mongoose from 'mongoose';
import { toRupees } from '../utils/money.js';

const invoiceLineSchema = new mongoose.Schema(
  {
    lineId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    productCode: {
      type: String,
      required: true,
      trim: true,
    },
    itemName: {
      type: String,
      required: true,
      trim: true,
    },
    specText: {
      type: String,
      trim: true,
      default: '',
    },
    unitType: {
      type: String,
      enum: ['UNIT', 'PACK'],
      required: true,
      default: 'UNIT',
    },
    unitLabel: {
      type: String,
      trim: true,
      default: 'PCS',
    },
    unitsPerPack: {
      type: Number,
      default: 1,
      min: 1,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0.001,
    },
    quantityBase: {
      type: Number,
      required: true,
    },
    rateSnapshotPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    amountPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    taxRatePercent: {
      type: Number,
      default: 0,
    },
    taxablePaise: {
      type: Number,
      default: 0,
    },
    taxPaise: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const customerSnapshotSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    customerCode: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    mobile: {
      type: String,
      trim: true,
      default: '',
    },
    locality: {
      type: String,
      trim: true,
      default: '',
    },
    businessName: {
      type: String,
      trim: true,
      default: '',
    },
    gstNumber: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const walkInSnapshotSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: '',
    },
    mobile: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const taxBreakupSchema = new mongoose.Schema(
  {
    ratePercent: {
      type: Number,
      required: true,
    },
    taxablePaise: {
      type: Number,
      required: true,
      default: 0,
    },
    taxPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    cgstPaise: {
      type: Number,
      default: 0,
    },
    sgstPaise: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const invoiceTotalsSchema = new mongoose.Schema(
  {
    subtotalPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    discountPaise: {
      type: Number,
      default: 0,
    },
    roundOffPaise: {
      type: Number,
      default: 0,
    },
    totalPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    itemCount: {
      type: Number,
      default: 0,
    },
    unitCount: {
      type: Number,
      default: 0,
    },
    taxBreakup: {
      type: [taxBreakupSchema],
      default: [],
    },
  },
  { _id: false }
);

const paymentSnapshotSchema = new mongoose.Schema(
  {
    mode: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'SPLIT', 'CREDIT'],
      required: true,
    },
    amountReceivedPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    paidPaise: {
      type: Number,
      required: true,
      default: 0,
    },
    balancePaise: {
      type: Number,
      required: true,
      default: 0,
    },
    changeReturnedPaise: {
      type: Number,
      default: 0,
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
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    invoiceNumber: {
      type: String,
      required: [true, 'Invoice number is required'],
      trim: true,
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BillDraft',
      required: true,
      index: true,
    },
    draftNumber: {
      type: String,
      required: true,
      trim: true,
    },
    postingDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    billType: {
      type: String,
      enum: ['cash', 'credit'],
      required: true,
    },
    settlementStatus: {
      type: String,
      enum: ['unpaid', 'part_paid', 'settled'],
      required: true,
      index: true,
    },
    customer: {
      type: customerSnapshotSchema,
      default: null,
    },
    walkIn: {
      type: walkInSnapshotSchema,
      default: null,
    },
    lines: {
      type: [invoiceLineSchema],
      required: true,
      validate: [(val) => val && val.length > 0, 'Invoice must have at least one line item'],
    },
    totals: {
      type: invoiceTotalsSchema,
      required: true,
    },
    payment: {
      type: paymentSnapshotSchema,
      required: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['posted', 'cancelled'],
      default: 'posted',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'invoices',
  }
);

invoiceSchema.index({ storeId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ storeId: 1, draftId: 1 }, { unique: true });
invoiceSchema.index({ storeId: 1, 'customer.customerId': 1, settlementStatus: 1 });
invoiceSchema.index({ storeId: 1, postingDate: -1 });

export function formatInvoiceForResponse(doc, userRole = 'admin') {
  if (!doc) return null;
  const raw = doc.toObject ? doc.toObject() : { ...doc };

  const id = raw._id ? String(raw._id) : raw.id;
  const isAdmin = userRole === 'admin';

  // Calculate overdue status
  const now = new Date();
  let isOverdue = false;
  let overdueDays = 0;
  if (raw.dueDate && (raw.settlementStatus === 'unpaid' || raw.settlementStatus === 'part_paid')) {
    const dueTime = new Date(raw.dueDate).getTime();
    if (now.getTime() > dueTime) {
      isOverdue = true;
      overdueDays = Math.max(1, Math.floor((now.getTime() - dueTime) / (1000 * 60 * 60 * 24)));
    }
  }

  // Lines formatted according to role
  const lines = (raw.lines || []).map((line) => {
    const base = {
      lineId: line.lineId ? String(line.lineId) : undefined,
      itemId: line.itemId ? String(line.itemId) : undefined,
      productCode: line.productCode,
      itemName: line.itemName,
      specText: line.specText || '',
      unitType: line.unitType,
      unitLabel: line.unitLabel,
      unitsPerPack: line.unitsPerPack,
      quantity: line.quantity,
      quantityBase: line.quantityBase,
    };

    if (isAdmin) {
      return {
        ...base,
        rate: toRupees(line.rateSnapshotPaise),
        amount: toRupees(line.amountPaise),
        taxRatePercent: line.taxRatePercent || 0,
        taxable: toRupees(line.taxablePaise),
        tax: toRupees(line.taxPaise),
      };
    }
    return base;
  });

  // Totals formatted according to role
  const totals = {
    total: toRupees(raw.totals?.totalPaise),
    itemCount: raw.totals?.itemCount || lines.length,
    unitCount: raw.totals?.unitCount || 0,
  };

  if (isAdmin) {
    totals.subtotal = toRupees(raw.totals?.subtotalPaise);
    totals.discount = toRupees(raw.totals?.discountPaise);
    totals.roundOff = toRupees(raw.totals?.roundOffPaise);
    totals.taxBreakup = (raw.totals?.taxBreakup || []).map((tb) => ({
      ratePercent: tb.ratePercent,
      taxable: toRupees(tb.taxablePaise),
      tax: toRupees(tb.taxPaise),
      cgst: toRupees(tb.cgstPaise),
      sgst: toRupees(tb.sgstPaise),
    }));
  }

  const payment = {
    mode: raw.payment?.mode,
    paidAmount: toRupees(raw.payment?.paidPaise),
    balanceAmount: toRupees(raw.payment?.balancePaise),
    reference: raw.payment?.reference || '',
    notes: raw.payment?.notes || '',
  };

  if (isAdmin) {
    payment.amountReceived = toRupees(raw.payment?.amountReceivedPaise);
    payment.changeReturned = toRupees(raw.payment?.changeReturnedPaise);
  }

  return {
    id,
    _id: id,
    invoiceNumber: raw.invoiceNumber,
    draftId: raw.draftId ? String(raw.draftId) : null,
    draftNumber: raw.draftNumber,
    postingDate: raw.postingDate,
    billType: raw.billType,
    settlementStatus: raw.settlementStatus,
    customer: raw.customer || null,
    walkIn: raw.walkIn || null,
    lines,
    totals,
    payment,
    dueDate: raw.dueDate || null,
    isOverdue,
    overdueDays,
    status: raw.status,
    createdBy: raw.createdBy,
    createdAt: raw.createdAt,
  };
}

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;

