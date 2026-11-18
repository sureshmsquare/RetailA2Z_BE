import mongoose from 'mongoose';

/**
 * PriceHistory model (APPEND-ONLY).
 * Every price or MRP modification creates an append-only entry.
 * Do not write any update or delete functions for this model.
 */
const priceHistorySchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
      index: true,
    },
    field: {
      type: String,
      enum: ['sellingPrice', 'mrp'],
      required: true,
    },
    oldValuePaise: {
      type: Number,
      default: null,
    },
    newValuePaise: {
      type: Number,
      required: true,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    changedBy: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },
  },
  {
    collection: 'price_histories',
    timestamps: false,
  }
);

// Compound index for querying an item's price history chronologically
priceHistorySchema.index({ storeId: 1, itemId: 1, createdAt: -1 });

const PriceHistory = mongoose.model('PriceHistory', priceHistorySchema);
export default PriceHistory;

