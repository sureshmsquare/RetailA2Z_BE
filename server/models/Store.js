import mongoose from 'mongoose';

const addressSchema = new mongoose.Schema(
  {
    line1: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    pincode: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Store name is required'],
      trim: true,
    },
    storeCode: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: addressSchema,
      default: () => ({}),
    },
    gstin: {
      type: String,
      trim: true,
      default: null,
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'stores',
  }
);

storeSchema.index({ storeCode: 1 }, { unique: true, sparse: true });

const Store = mongoose.model('Store', storeSchema);
export default Store;
