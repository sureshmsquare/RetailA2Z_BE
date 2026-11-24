import mongoose from 'mongoose';
import { computeLineAmount, computePurchaseTotal } from '../utils/purchaseTotals.js';

export function computeInvoiceKey(invoiceNo) {
  if (!invoiceNo) return '';
  return String(invoiceNo).trim().toLowerCase().replace(/\s+/g, '');
}

const purchaseLineSchema = new mongoose.Schema(
  {
    lineId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: [true, 'Item reference is required'],
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
    unitType: {
      type: String,
      enum: ['UNIT', 'PACK'],
      default: 'UNIT',
      required: true,
    },
    unitsPerPack: {
      type: Number,
      default: 1,
      min: 1,
    },
    quantity: {
      type: Number,
      required: true,
      min: [0.001, 'Quantity must be greater than 0'],
    },
    quantityBase: {
      type: Number,
      required: true,
    },
    unitLabel: {
      type: String,
      trim: true,
      default: 'UNIT',
    },
    costPaise: {
      type: Number,
      required: true,
      min: [0, 'Cost in paise must be non-negative'],
      default: 0,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: [0, 'Amount in paise must be non-negative'],
      default: 0,
    },
  },
  { _id: true }
);

const purchaseSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    purchaseNumber: {
      type: String,
      trim: true,
      default: null,
    },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required: [true, 'Supplier reference is required'],
      index: true,
    },
    supplierInvoiceNo: {
      type: String,
      trim: true,
      maxlength: [50, 'Supplier invoice number must be at most 50 characters'],
      default: '',
    },
    invoiceKey: {
      type: String,
      trim: true,
      default: '',
    },
    receivedDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes must be at most 500 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: ['draft', 'posted', 'cancelled'],
      default: 'draft',
      index: true,
    },
    lines: {
      type: [purchaseLineSchema],
      default: [],
    },
    totalPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    postedAt: {
      type: Date,
      default: null,
    },
    postedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    postIdempotencyKey: {
      type: String,
      trim: true,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    cancelReason: {
      type: String,
      trim: true,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'purchases',
  }
);

// Pre-validate hook: normalize supplier invoice, compute invoiceKey, line amounts and totalPaise
purchaseSchema.pre('validate', function (next) {
  if (this.supplierInvoiceNo !== undefined && this.supplierInvoiceNo !== null) {
    this.supplierInvoiceNo = String(this.supplierInvoiceNo).trim();
    this.invoiceKey = computeInvoiceKey(this.supplierInvoiceNo);
  } else {
    this.invoiceKey = '';
  }

  if (Array.isArray(this.lines)) {
    for (const line of this.lines) {
      if (!line.lineId) {
        line.lineId = line._id || new mongoose.Types.ObjectId();
      }
      const unitsPerPack = Number(line.unitsPerPack) || 1;
      const qty = Number(line.quantity) || 0;
      if (line.unitType === 'PACK') {
        line.quantityBase = Number((qty * unitsPerPack).toFixed(3));
      } else {
        line.quantityBase = Number(qty.toFixed(3));
      }
      line.amountPaise = computeLineAmount({
        quantity: line.quantity,
        costPaise: line.costPaise,
      });
    }
    this.totalPaise = computePurchaseTotal(this.lines);
  } else {
    this.totalPaise = 0;
  }

  next();
});

// Unique index on storeId + purchaseNumber (sparse so multiple drafts without purchaseNumber are allowed)
purchaseSchema.index({ storeId: 1, purchaseNumber: 1 }, { unique: true, sparse: true });

// Unique partial index on (storeId, supplierId, invoiceKey) for draft and posted purchases
purchaseSchema.index(
  { storeId: 1, supplierId: 1, invoiceKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['draft', 'posted'] },
      invoiceKey: { $type: 'string', $gt: '' },
    },
  }
);

// Idempotency lookup index per store
purchaseSchema.index({ storeId: 1, postIdempotencyKey: 1 }, { sparse: true });

// Listing & filter index
purchaseSchema.index({ storeId: 1, status: 1, receivedDate: -1, createdAt: -1 });

const Purchase = mongoose.model('Purchase', purchaseSchema);
export default Purchase;

