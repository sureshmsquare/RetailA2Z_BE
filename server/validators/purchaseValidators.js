import { body, param, header, query } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const collapseSpaces = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const validatePurchaseId = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid purchase ID format'),
];

export const validateCreatePurchaseDraft = [
  body('supplierId')
    .notEmpty()
    .withMessage('Supplier is required')
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID format'),

  body('supplierInvoiceNo')
    .optional({ nullable: true, checkFalsy: true })
    .customSanitizer(collapseSpaces)
    .isLength({ max: 50 })
    .withMessage('Supplier invoice number must not exceed 50 characters'),

  body('receivedDate')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      const d = new Date(val);
      if (isNaN(d.getTime())) {
        throw new Error('Invalid received date format');
      }
      return true;
    }),

  body('notes')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),

  body('lines')
    .optional()
    .isArray()
    .withMessage('Lines must be an array'),

  body('lines.*.itemId')
    .if(body('lines').isArray({ min: 1 }))
    .notEmpty()
    .withMessage('Item is required for each line')
    .custom(isValidObjectId)
    .withMessage('Invalid item ID'),

  body('lines.*.unitType')
    .optional()
    .isIn(['UNIT', 'PACK'])
    .withMessage('Unit type must be UNIT or PACK'),

  body('lines.*.quantity')
    .if(body('lines').isArray({ min: 1 }))
    .notEmpty()
    .withMessage('Quantity is required')
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than 0'),

  body('lines.*.cost')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Cost cannot be negative'),

  body('lines.*.costPaise')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Cost paise cannot be negative'),
];

export const validateUpdatePurchaseDraft = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid purchase ID format'),

  body('supplierId')
    .optional()
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID format'),

  body('supplierInvoiceNo')
    .optional({ nullable: true })
    .customSanitizer(collapseSpaces)
    .isLength({ max: 50 })
    .withMessage('Supplier invoice number must not exceed 50 characters'),

  body('receivedDate')
    .optional({ nullable: true, checkFalsy: true })
    .custom((val) => {
      if (!val || String(val).trim() === '') return true;
      const d = new Date(val);
      if (isNaN(d.getTime())) {
        throw new Error('Invalid received date format');
      }
      return true;
    }),

  body('notes')
    .optional({ nullable: true })
    .isLength({ max: 500 })
    .withMessage('Notes must not exceed 500 characters'),

  body('lines')
    .optional()
    .isArray()
    .withMessage('Lines must be an array'),

  body('lines.*.itemId')
    .if(body('lines').isArray({ min: 1 }))
    .notEmpty()
    .withMessage('Item is required for each line')
    .custom(isValidObjectId)
    .withMessage('Invalid item ID'),

  body('lines.*.unitType')
    .optional()
    .isIn(['UNIT', 'PACK'])
    .withMessage('Unit type must be UNIT or PACK'),

  body('lines.*.quantity')
    .if(body('lines').isArray({ min: 1 }))
    .notEmpty()
    .withMessage('Quantity is required')
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than 0'),

  body('lines.*.cost')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Cost cannot be negative'),

  body('lines.*.costPaise')
    .optional({ nullable: true })
    .isInt({ min: 0 })
    .withMessage('Cost paise cannot be negative'),
];

export const validatePostPurchase = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid purchase ID format'),

  header('idempotency-key')
    .custom((val, { req }) => {
      const key = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
      if (!key || !String(key).trim()) {
        throw new Error('Idempotency-Key header is required for posting');
      }
      return true;
    }),
];

export const validateCancelPurchase = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid purchase ID format'),

  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Cancel reason is mandatory')
    .isLength({ min: 5 })
    .withMessage('Cancel reason is mandatory (minimum 5 characters)'),
];

export const validateListPurchases = [
  query('supplierId')
    .optional({ nullable: true, checkFalsy: true })
    .custom(isValidObjectId)
    .withMessage('Invalid supplier ID filter format'),

  query('status')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(['draft', 'posted', 'cancelled'])
    .withMessage('Status must be draft, posted, or cancelled'),

  query('fromDate')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('Invalid fromDate format'),

  query('toDate')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('Invalid toDate format'),

  query('page')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional({ nullable: true, checkFalsy: true })
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
];

