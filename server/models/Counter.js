import mongoose from 'mongoose';

export const ITEM_CODE_COUNTER_KEY = 'itemCode';
export const ITEM_CODE_START_SEQ = 10000000;
export const PURCHASE_NO_COUNTER_KEY = 'purchaseNo';

export const CUSTOMER_CODE_COUNTER_KEY = 'customerCode';
export const CUSTOMER_CODE_START_SEQ = 0;

const counterSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    key: {
      type: String,
      required: [true, 'Counter key is required'],
      trim: true,
    },
    seq: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'counters',
  }
);

// Unique counter key per store
counterSchema.index({ storeId: 1, key: 1 }, { unique: true });

const Counter = mongoose.model('Counter', counterSchema);
export default Counter;
