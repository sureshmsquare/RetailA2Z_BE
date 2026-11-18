import mongoose from 'mongoose';

/**
 * StockMovement model (APPEND-ONLY).
 * Records physical stock balance adjustments and entries.
 * Do not write any update or delete functions for this model.
 * Stock balance = SUM(quantityBase) per item and store.
 */
const stockMovementSchema = new mongoose.Schema(
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
    type: {
      type: String,
      enum: ['OPENING', 'PURCHASE', 'SALE', 'ADJUSTMENT', 'RETURN'],
      required: true,
      index: true,
    },
    quantityBase: {
      type: Number,
      required: true,
    },
    effectiveDate: {
      type: Date,
      default: Date.now,
    },
    reference: {
      type: String,
      trim: true,
      default: '',
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
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
    collection: 'stock_movements',
    timestamps: false,
  }
);

stockMovementSchema.index({ storeId: 1, itemId: 1, createdAt: -1 });
stockMovementSchema.index({ storeId: 1, itemId: 1, type: 1 });

const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export default StockMovement;

