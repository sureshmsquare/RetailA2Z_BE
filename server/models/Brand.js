import mongoose from 'mongoose';

/**
 * Normalizes a brand name by trimming and collapsing repeated whitespace to a single space,
 * and computes its case-insensitive lookup key.
 */
export function normalizeBrandName(rawName) {
  const name = String(rawName ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  const nameKey = name.toLowerCase();
  return { name, nameKey };
}

const brandSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Brand name is required'],
      trim: true,
      maxlength: [60, 'Brand name must be at most 60 characters'],
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isActive: {
      type: Boolean,
      default: true,
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
    collection: 'brands',
  }
);

// Automatically normalize name and compute nameKey on save and rename
brandSchema.pre('validate', function (next) {
  if (typeof this.name === 'string') {
    const { name, nameKey } = normalizeBrandName(this.name);
    this.name = name;
    this.nameKey = nameKey;
  }
  next();
});

// Unique per store (case-insensitive & space-collapsed)
brandSchema.index({ storeId: 1, nameKey: 1 }, { unique: true });

// Performance index for active option dropdowns and status filtering
brandSchema.index({ storeId: 1, isActive: 1, name: 1 });

const Brand = mongoose.model('Brand', brandSchema);
export default Brand;

