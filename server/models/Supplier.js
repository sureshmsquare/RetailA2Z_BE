import mongoose from 'mongoose';
import { normalizeIndianMobile } from '../utils/phone.js';

/**
 * Normalizes a supplier name by trimming and collapsing repeated whitespace to a single space,
 * and computes its case-insensitive lookup key.
 */
export function normalizeSupplierName(rawName) {
  const name = String(rawName ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  const nameKey = name.toLowerCase();
  return { name, nameKey };
}

const addressSchema = new mongoose.Schema(
  {
    line1: {
      type: String,
      trim: true,
      default: '',
    },
    area: {
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

const supplierSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Supplier name is required'],
      trim: true,
      maxlength: [100, 'Supplier name must be at most 100 characters'],
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    contactPerson: {
      type: String,
      trim: true,
      maxlength: [100, 'Contact person must be at most 100 characters'],
      default: '',
    },
    mobile: {
      type: String,
      trim: true,
      default: null,
    },
    alternateMobile: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    address: {
      type: addressSchema,
      default: () => ({}),
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    creditDays: {
      type: Number,
      default: 0,
      min: [0, 'Credit days must be between 0 and 365'],
      max: [365, 'Credit days must be between 0 and 365'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [500, 'Notes must be at most 500 characters'],
      default: '',
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
    collection: 'suppliers',
  }
);

// Pre-validate hook to normalize name, nameKey, mobile, alternateMobile, gstin, email
supplierSchema.pre('validate', function (next) {
  if (typeof this.name === 'string') {
    const { name, nameKey } = normalizeSupplierName(this.name);
    this.name = name;
    this.nameKey = nameKey;
  }

  if (this.mobile !== undefined) {
    if (this.mobile === null || String(this.mobile).trim() === '') {
      this.mobile = null;
    } else {
      const normalized = normalizeIndianMobile(this.mobile);
      if (normalized) {
        this.mobile = normalized;
      }
    }
  }

  if (this.alternateMobile !== undefined) {
    if (this.alternateMobile === null || String(this.alternateMobile).trim() === '') {
      this.alternateMobile = null;
    } else {
      const normalized = normalizeIndianMobile(this.alternateMobile);
      if (normalized) {
        this.alternateMobile = normalized;
      }
    }
  }

  if (this.email !== undefined) {
    if (this.email === null || String(this.email).trim() === '') {
      this.email = null;
    } else {
      this.email = String(this.email).trim().toLowerCase();
    }
  }

  if (this.gstin !== undefined) {
    if (this.gstin === null || String(this.gstin).trim() === '') {
      this.gstin = null;
    } else {
      this.gstin = String(this.gstin).trim().toUpperCase();
    }
  }

  next();
});

// Unique per store (case-insensitive & space-collapsed nameKey)
supplierSchema.index({ storeId: 1, nameKey: 1 }, { unique: true });

// Mobile lookup within store
supplierSchema.index({ storeId: 1, mobile: 1 });

// Performance index for active dropdown options and status filtering
supplierSchema.index({ storeId: 1, isActive: 1, name: 1 });

const Supplier = mongoose.model('Supplier', supplierSchema);
export default Supplier;

