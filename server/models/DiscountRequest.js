import mongoose from 'mongoose';

const discountRequestSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BillDraft',
      required: true,
      index: true,
    },
    draftVersion: {
      type: Number,
      required: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    requestedAmountPaise: {
      type: Number,
      default: null,
    },
    requestedPercent: {
      type: Number,
      default: null,
    },
    reason: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 500,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired', 'cancelled'],
      default: 'pending',
      index: true,
    },
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
    decisionReason: {
      type: String,
      default: null,
      trim: true,
    },
    approvedAmountPaise: {
      type: Number,
      default: null,
    },
    approvedPercent: {
      type: Number,
      default: null,
    },
    billTotalAtRequestPaise: {
      type: Number,
      required: true,
    },
    eligibleValuePaise: {
      type: Number,
      required: true,
    },
    lineSignatureAtRequest: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'discount_requests',
  }
);

discountRequestSchema.index({ draftId: 1, status: 1 });
discountRequestSchema.index({ storeId: 1, status: 1 });

const DiscountRequest = mongoose.model('DiscountRequest', discountRequestSchema);
export default DiscountRequest;

