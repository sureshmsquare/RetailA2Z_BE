import mongoose from 'mongoose';

const mrpSourceSchema = new mongoose.Schema(
  {
    sourceName: { type: String, trim: true, default: '' },
    sourceVersion: { type: String, trim: true, default: '' },
    sourceDate: { type: Date, default: null },
  },
  { _id: false }
);

const taxSchema = new mongoose.Schema(
  {
    hsnCode: { type: String, trim: true, default: '' },
    taxRatePercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false }
);

const itemSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    productCode: {
      type: String,
      required: [true, 'Product code is required'],
      trim: true,
    },
    codeSource: {
      type: String,
      enum: ['auto', 'manual', 'import'],
      default: 'manual',
    },
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true,
    },
    brandId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Brand',
      default: null,
      index: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
      index: true,
    },
    classSeries: {
      type: String,
      trim: true,
      default: '',
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    length: {
      type: String,
      trim: true,
      default: '',
    },
    variant: {
      type: String,
      trim: true,
      default: '',
    },
    sellingUnit: {
      type: String,
      trim: true,
      default: 'PCS',
    },
    unitsPerPack: {
      type: Number,
      default: 1,
      min: [1, 'Units per pack must be at least 1'],
    },
    mrpPaise: {
      type: Number,
      default: null,
    },
    mrpSource: {
      type: mrpSourceSchema,
      default: () => ({}),
    },
    sellingPricePaise: {
      type: Number,
      default: null,
    },
    tax: {
      type: taxSchema,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'inactive'],
      default: 'draft',
      index: true,
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
    collection: 'items',
  }
);

// Compound Unique Index: productCode must be unique within a store
itemSchema.index({ storeId: 1, productCode: 1 }, { unique: true });

// Performance indexes for search and filtering
itemSchema.index({ storeId: 1, name: 1 });
itemSchema.index({ storeId: 1, brandId: 1 });
itemSchema.index({ storeId: 1, categoryId: 1 });
itemSchema.index({ storeId: 1, status: 1 });

const Item = mongoose.model('Item', itemSchema);
export default Item;

