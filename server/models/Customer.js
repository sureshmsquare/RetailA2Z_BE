import mongoose from 'mongoose';
import { toRupees } from '../utils/money.js';

/**
 * Normalizes an Indian mobile number.
 * Strips spaces, dashes, parentheses, +91 / 91 or leading 0,
 * resulting in a 10-digit Indian mobile.
 * Validates that the normalized number is 10 digits starting with 6, 7, 8, or 9.
 *
 * @param {string} rawMobile
 * @returns {{ mobile: string, normalizedMobile: string, isValid: boolean }}
 */
export function normalizeIndianMobile(rawMobile) {
  if (rawMobile === null || rawMobile === undefined) {
    return { mobile: '', normalizedMobile: '', isValid: false };
  }

  const raw = String(rawMobile).trim();
  // Strip non-digit characters
  let digits = raw.replace(/\D/g, '');

  // Strip leading 91 if 12 digits (e.g. +91 9876543210 or 919876543210)
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    // Strip leading 0 if 11 digits (e.g. 09876543210)
    digits = digits.slice(1);
  }

  const isValid = /^[6-9]\d{9}$/.test(digits);

  return {
    mobile: raw,
    normalizedMobile: digits,
    isValid,
  };
}

/**
 * Validates Indian GSTIN format:
 * 15 characters alphanumeric: 2 digits state code + 10 char PAN + 1 entity num + 'Z' + 1 check digit.
 *
 * @param {string} gstin
 * @returns {boolean}
 */
export function isValidGSTIN(gstin) {
  if (!gstin) return true; // Optional when empty
  const clean = String(gstin).trim().toUpperCase();
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(clean);
}

const customerSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'Store reference is required'],
      index: true,
    },
    customerCode: {
      type: String,
      trim: true,
      uppercase: true,
      index: true,
      default: '',
    },
    name: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      minlength: [2, 'Customer name must be between 2 and 100 characters'],
      maxlength: [100, 'Customer name must be between 2 and 100 characters'],
    },
    mobile: {
      type: String,
      required: [true, 'Enter a valid 10-digit mobile number'],
      trim: true,
    },
    normalizedMobile: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    locality: {
      type: String,
      trim: true,
      default: '',
    },
    businessName: {
      type: String,
      trim: true,
      default: '',
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    creditEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    creditLimitPaise: {
      type: Number,
      default: null,
      min: [0, 'Credit limit must be a non-negative number'],
    },
    creditDays: {
      type: Number,
      default: null,
      min: [1, 'Credit days must be an integer of at least 1'],
    },
    creditRestricted: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
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
    collection: 'customers',
  }
);

// Indexes for performance and lookup
// Note: (storeId, normalizedMobile) is intentionally non-unique in MongoDB to allow
// shared numbers after user confirmation.
customerSchema.index({ storeId: 1, customerCode: 1 }, { sparse: true });
customerSchema.index({ storeId: 1, normalizedMobile: 1 });
customerSchema.index({ storeId: 1, name: 1 });
customerSchema.index({ storeId: 1, businessName: 1 });
customerSchema.index({ storeId: 1, gstNumber: 1 });
customerSchema.index({ storeId: 1, isActive: 1 });
customerSchema.index({ storeId: 1, creditEnabled: 1 });

/**
 * Formats a Customer document for API responses.
 * Provides both camelCase and snake_case properties to ensure complete compatibility.
 * Outstanding amount, overdue amount, and oldest overdue days return 0 placeholders.
 */
export function formatCustomerForResponse(customerDoc) {
  if (!customerDoc) return null;
  const raw = customerDoc.toObject ? customerDoc.toObject() : { ...customerDoc };

  const creditEnabled = Boolean(raw.creditEnabled);
  const creditLimit =
    creditEnabled && raw.creditLimitPaise !== null && raw.creditLimitPaise !== undefined
      ? toRupees(raw.creditLimitPaise)
      : 0;
  const creditDays = creditEnabled && raw.creditDays ? raw.creditDays : null;
  const creditTermsLabel = creditEnabled && creditDays ? `${creditDays} days` : 'No credit';

  const customerId = raw._id ? String(raw._id) : raw.id;
  const storeId = raw.storeId ? (raw.storeId._id ? String(raw.storeId._id) : String(raw.storeId)) : null;

  return {
    id: customerId,
    _id: customerId,
    storeId,
    store_id: storeId,
    customerCode: raw.customerCode || '',
    customer_code: raw.customerCode || '',
    name: raw.name,
    mobile: raw.mobile,
    normalizedMobile: raw.normalizedMobile,
    normalized_mobile: raw.normalizedMobile,
    locality: raw.locality || '',
    businessName: raw.businessName || '',
    business_name: raw.businessName || '',
    gstNumber: raw.gstNumber || '',
    gst_number: raw.gstNumber || '',
    creditEnabled,
    credit_enabled: creditEnabled,
    creditLimit,
    credit_limit: creditLimit,
    creditDays,
    credit_days: creditDays,
    creditTermsLabel,
    credit_terms_label: creditTermsLabel,
    outstandingAmount: 0,
    outstanding_amount: 0,
    overdueAmount: 0,
    overdue_amount: 0,
    oldestOverdueDays: 0,
    oldest_overdue_days: 0,
    isActive: Boolean(raw.isActive),
    is_active: Boolean(raw.isActive),
    createdBy: raw.createdBy,
    created_by: raw.createdBy,
    updatedBy: raw.updatedBy,
    updated_by: raw.updatedBy,
    createdAt: raw.createdAt,
    created_at: raw.createdAt,
    updatedAt: raw.updatedAt,
    updated_at: raw.updatedAt,
  };
}

const Customer = mongoose.model('Customer', customerSchema);

export default Customer;
