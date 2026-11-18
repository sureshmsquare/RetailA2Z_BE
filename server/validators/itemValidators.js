import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const validateCreateItem = [
  body('productCode')
    .optional({ nullable: true })
    .isString()
    .withMessage('Product code must be a string')
    .trim(),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Item name is required'),
  body('unitsPerPack')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Units per pack must be an integer of at least 1'),
  body('mrp')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('MRP must be a non-negative number'),
  body('sellingPrice')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a non-negative number'),
  body('tax.taxRatePercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Tax rate percent must be between 0 and 100'),
];

export const validateUpdateItem = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid item ID format'),
  body('productCode')
    .optional({ nullable: true }),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Item name cannot be empty'),
  body('unitsPerPack')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Units per pack must be at least 1'),
  body('sellingPrice')
    .custom((val) => {
      if (val !== undefined) {
        throw new Error('Selling price cannot be updated via this endpoint. Use PATCH /api/items/:id/price');
      }
      return true;
    }),
  body('mrp')
    .custom((val) => {
      if (val !== undefined) {
        throw new Error('MRP cannot be updated directly. Update via import or dedicated pricing flow');
      }
      return true;
    }),
];

export const validateSetPrice = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid item ID format'),
  body('price')
    .notEmpty()
    .withMessage('Selling price is required')
    .isFloat({ min: 0 })
    .withMessage('Selling price must be a non-negative number'),
  body('reason')
    .optional()
    .trim(),
];

export const validateSetStatus = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid item ID format'),
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['draft', 'active', 'inactive'])
    .withMessage("Status must be 'draft', 'active', or 'inactive'"),
];

export const validateOpeningStock = [
  body('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .custom(isValidObjectId)
    .withMessage('Invalid Item ID format'),
  body('quantity')
    .notEmpty()
    .withMessage('Opening stock quantity is required')
    .isFloat({ min: 0 })
    .withMessage('Opening stock quantity cannot be negative'),
  body('reference')
    .optional()
    .trim(),
];

export const validateStockAdjustment = [
  body('itemId')
    .notEmpty()
    .withMessage('Item ID is required')
    .custom(isValidObjectId)
    .withMessage('Invalid Item ID format'),
  body('quantity')
    .notEmpty()
    .withMessage('Adjustment quantity is required')
    .isFloat()
    .custom((val) => {
      if (Number(val) === 0) {
        throw new Error('Adjustment quantity cannot be zero');
      }
      return true;
    }),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Reason is mandatory for stock adjustment'),
  body('reference')
    .optional()
    .trim(),
];

export const validateApproveImport = [
  param('batchId')
    .custom(isValidObjectId)
    .withMessage('Invalid import batch ID'),
  body().custom((val) => {
    if (!val.allValid && (!Array.isArray(val.rowNumbers) || val.rowNumbers.length === 0)) {
      throw new Error("Either 'allValid: true' or a non-empty 'rowNumbers' array must be provided.");
    }
    return true;
  }),
];

export const validateCancelImport = [
  param('batchId')
    .custom(isValidObjectId)
    .withMessage('Invalid import batch ID'),
];

