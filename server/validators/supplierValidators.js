import { body, param } from 'express-validator';
import mongoose from 'mongoose';
import { isValidIndianMobile, normalizeIndianMobile } from '../utils/phone.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const collapseSpaces = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/i;

const validateMobileField = (fieldName) =>
  body(fieldName)
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      if (!isValidIndianMobile(val)) {
        throw new Error(`Invalid ${fieldName}. Must be a valid 10-digit Indian mobile number.`);
      }
      return true;
    })
    .customSanitizer((val) => {
      if (!val || String(val).trim() === '') return null;
      return normalizeIndianMobile(val) || val;
    });

export const validateCreateSupplier = [
  body('name')
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Supplier name is required')
    .isLength({ max: 100 })
    .withMessage('Supplier name must be at most 100 characters'),

  body('contactPerson')
    .optional({ nullable: true })
    .customSanitizer(collapseSpaces)
    .isLength({ max: 100 })
    .withMessage('Contact person must be at most 100 characters'),

  validateMobileField('mobile'),
  validateMobileField('alternateMobile'),

  body('email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage('Invalid email format')
    .customSanitizer((val) => (!val || String(val).trim() === '' ? null : String(val).trim().toLowerCase())),

  body('address.line1')
    .optional({ nullable: true })
    .isLength({ max: 150 })
    .withMessage('Address line 1 must be at most 150 characters'),

  body('address.area')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('Address area must be at most 100 characters'),

  body('address.city')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('City must be at most 100 characters'),

  body('address.state')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('State must be at most 100 characters'),

  body('address.pincode')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      if (!/^\d{6}$/.test(String(val).trim())) {
        throw new Error('Pincode must be a 6-digit number');
      }
      return true;
    }),

  body('gstin')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      if (!GSTIN_REGEX.test(String(val).trim())) {
        throw new Error('Invalid GSTIN format. Must be a 15-character GSTIN.');
      }
      return true;
    })
    .customSanitizer((val) => (!val || String(val).trim() === '' ? null : String(val).trim().toUpperCase())),

  body('creditDays')
    .optional({ nullable: true })
    .custom((val) => {
      if (val === undefined || val === null || val === '') return true;
      const num = Number(val);
      if (!Number.isInteger(num) || num < 0 || num > 365) {
        throw new Error('Credit days must be an integer between 0 and 365');
      }
      return true;
    })
    .toInt(),

  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 500 })
    .withMessage('Notes must be at most 500 characters'),
];

export const validateUpdateSupplier = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID format'),

  body('name')
    .optional()
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Supplier name cannot be empty')
    .isLength({ max: 100 })
    .withMessage('Supplier name must be at most 100 characters'),

  body('contactPerson')
    .optional({ nullable: true })
    .customSanitizer(collapseSpaces)
    .isLength({ max: 100 })
    .withMessage('Contact person must be at most 100 characters'),

  validateMobileField('mobile'),
  validateMobileField('alternateMobile'),

  body('email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail()
    .withMessage('Invalid email format')
    .customSanitizer((val) => (!val || String(val).trim() === '' ? null : String(val).trim().toLowerCase())),

  body('address.line1')
    .optional({ nullable: true })
    .isLength({ max: 150 })
    .withMessage('Address line 1 must be at most 150 characters'),

  body('address.area')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('Address area must be at most 100 characters'),

  body('address.city')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('City must be at most 100 characters'),

  body('address.state')
    .optional({ nullable: true })
    .isLength({ max: 100 })
    .withMessage('State must be at most 100 characters'),

  body('address.pincode')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      if (!/^\d{6}$/.test(String(val).trim())) {
        throw new Error('Pincode must be a 6-digit number');
      }
      return true;
    }),

  body('gstin')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      if (!GSTIN_REGEX.test(String(val).trim())) {
        throw new Error('Invalid GSTIN format. Must be a 15-character GSTIN.');
      }
      return true;
    })
    .customSanitizer((val) => (!val || String(val).trim() === '' ? null : String(val).trim().toUpperCase())),

  body('creditDays')
    .optional({ nullable: true })
    .custom((val) => {
      if (val === undefined || val === null || val === '') return true;
      const num = Number(val);
      if (!Number.isInteger(num) || num < 0 || num > 365) {
        throw new Error('Credit days must be an integer between 0 and 365');
      }
      return true;
    })
    .toInt(),

  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 500 })
    .withMessage('Notes must be at most 500 characters'),
];

export const validateSetSupplierStatus = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID format'),
  body('isActive')
    .isBoolean({ strict: true })
    .withMessage('isActive must be a boolean'),
];

export const validateSupplierId = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID format'),
];

