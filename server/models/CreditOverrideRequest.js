import mongoose from 'mongoose';

/**
 * CreditOverrideRequest Model (BRD APR-04, CR-04, CR-05)
 * Captures store authorization requests when a credit bill exceeds credit limits or has overdue amounts.
 */
const invoiceContextSchema = new mongoose.Schema(
  {
    currentOutstandingPaise: {
      type: Number,
      required: true,
    },
    creditLimitPaise: {
      type: Number,
      required: true,
    },
    overduePaise: {
      type: Number,
      default: 0,
    },
    oldestOverdueDays: {
      type: Number,
      default: 0,
    },
    proposedSalePaise: {
      type: Number,
      required: true,
    },
    projectedExposurePaise: {
      type: Number,
      required: true,
    },
  },
  { _id: false }
);

const approvalSnapshotSchema = new mongoose.Schema(
  {
    version: { type: Number, default: null },
    lineSignature: { type: String, default: null },
    exposurePaise: { type: Number, default: null },
  },
  { _id: false }
);

const creditOverrideRequestSchema = new mongoose.Schema(
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
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    invoiceContext: {
      type: invoiceContextSchema,
      required: true,
    },
    ruleTriggered: {
      type: String,
      enum: ['credit_limit_exceeded', 'overdue_present', 'hard_block'],
      required: true,
    },
    reason: {
      type: String,
      required: [true, 'Override reason is required'],
      trim: true,
      minlength: [3, 'Reason must be at least 3 characters'],
      maxlength: [500, 'Reason cannot exceed 500 characters'],
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
      trim: true,
      maxlength: [500, 'Decision reason cannot exceed 500 characters'],
      default: null,
    },
    approvalSnapshot: {
      type: approvalSnapshotSchema,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'credit_override_requests',
  }
);

// Compound indexes
creditOverrideRequestSchema.index({ draftId: 1, status: 1 });
creditOverrideRequestSchema.index({ storeId: 1, status: 1, requestedAt: -1 });
creditOverrideRequestSchema.index({ customerId: 1, status: 1 });

const CreditOverrideRequest = mongoose.model('CreditOverrideRequest', creditOverrideRequestSchema);

export default CreditOverrideRequest;

