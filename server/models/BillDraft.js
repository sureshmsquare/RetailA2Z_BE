import mongoose from 'mongoose';

const lineSuggestionSchema = new mongoose.Schema(
  {
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
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const draftLineSchema = new mongoose.Schema(
  {
    lineId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
      required: true,
    },
    status: {
      type: String,
      enum: ['matched', 'unclear'],
      required: true,
      default: 'matched',
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      default: null,
    },
    productCode: {
      type: String,
      trim: true,
      default: '',
    },
    itemName: {
      type: String,
      trim: true,
      default: '',
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
    unitsPerPack: {
      type: Number,
      default: 1,
      min: 1,
    },
    unitLabel: {
      type: String,
      trim: true,
      default: 'PCS',
    },
    quantity: {
      type: Number,
      required: true,
      min: [0.001, 'Quantity must be greater than zero'],
      max: [999999.999, 'Quantity exceeds maximum allowed limit'],
    },
    quantityBase: {
      type: Number,
      required: true,
      default: 0,
    },
    rateSnapshotPaise: {
      type: Number,
      default: 0,
    },
    amountPaise: {
      type: Number,
      default: 0,
    },
    unclearReason: {
      type: String,
      enum: [
        null,
        'not_found',
        'missing_quantity',
        'invalid_quantity',
        'invalid_unit',
        'no_pack_conversion',
        'not_priced',
        'inactive',
        'ambiguous',
      ],
      default: null,
    },
    inputText: {
      type: String,
      trim: true,
      default: '',
    },
    sourceKind: {
      type: String,
      enum: ['typed', 'search', 'upload'],
      default: 'typed',
    },
    suggestions: {
      type: [lineSuggestionSchema],
      default: [],
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const walkInSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Walk-in customer name cannot exceed 100 characters'],
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

const billDraftSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    draftNumber: {
      type: String,
      required: [true, 'Draft number is required'],
      trim: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Owner ID is required'],
      index: true,
    },
    billType: {
      type: String,
      enum: ['cash', 'credit'],
      default: 'cash',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    walkIn: {
      type: walkInSchema,
      default: () => ({ name: '', mobile: '' }),
    },
    lines: {
      type: [draftLineSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ['open', 'discarded', 'submitted', 'posted'],
      default: 'open',
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    totalPaise: {
      type: Number,
      default: 0,
    },
    discountStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
    discountPaise: {
      type: Number,
      default: 0,
    },
    discountRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DiscountRequest',
      default: null,
    },
    discountApprovedPaise: {
      type: Number,
      default: null,
    },
    discountApprovedPercent: {
      type: Number,
      default: null,
    },
    discountApprovedAt: {
      type: Date,
      default: null,
    },
    discountApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    discountApprovalSnapshot: {
      type: new mongoose.Schema(
        {
          version: { type: Number, default: null },
          billTotalPaise: { type: Number, default: null },
          lineSignature: { type: String, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    discountReason: {
      type: String,
      default: '',
      trim: true,
    },
    creditOverrideStatus: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
      index: true,
    },
    creditOverrideRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CreditOverrideRequest',
      default: null,
    },
    creditOverrideApprovedAt: {
      type: Date,
      default: null,
    },
    creditOverrideApprovedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    creditOverrideApprovalSnapshot: {
      type: new mongoose.Schema(
        {
          version: { type: Number, default: null },
          lineSignature: { type: String, default: null },
          exposurePaise: { type: Number, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    creditOverrideReason: {
      type: String,
      default: '',
      trim: true,
    },
    pricedAt: {
      type: Date,
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
    collection: 'bill_drafts',
  }
);

// Indexes
billDraftSchema.index({ storeId: 1, draftNumber: 1 }, { unique: true });
billDraftSchema.index({ storeId: 1, ownerId: 1, status: 1, updatedAt: -1 });
billDraftSchema.index({ storeId: 1, status: 1, updatedAt: -1 });

const BillDraft = mongoose.model('BillDraft', billDraftSchema);
export default BillDraft;

