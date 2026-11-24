import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import billingConfig from '../config/billingConfig.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isValidQuantity = (val) => {
  const num = Number(val);
  if (isNaN(num) || num <= 0) {
    throw new Error('Quantity must be a positive number');
  }
  const maxQty = billingConfig.MAX_QUANTITY || 999999.999;
  if (num > maxQty) {
    throw new Error(`Quantity cannot exceed ${maxQty}`);
  }
  const str = String(val).trim();
  if (str.includes('.') && str.split('.')[1].length > 3) {
    throw new Error('Quantity cannot have more than 3 decimal places');
  }
  return true;
};

export const validateCreateDraft = [
  body('billType')
    .optional()
    .isIn(['cash', 'credit'])
    .withMessage('billType must be either "cash" or "credit"'),
  body('customerId')
    .optional({ nullable: true })
    .custom((val) => {
      if (val && !isValidObjectId(val)) {
        throw new Error('Invalid customerId format');
      }
      return true;
    }),
  body('walkIn.name')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Walk-in name cannot exceed 100 characters'),
  body('walkIn.mobile')
    .optional()
    .isString()
    .trim(),
];

export const validateUpdateDraft = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  body('billType')
    .optional()
    .isIn(['cash', 'credit'])
    .withMessage('billType must be either "cash" or "credit"'),
  body('customerId')
    .optional({ nullable: true })
    .custom((val) => {
      if (val && !isValidObjectId(val)) {
        throw new Error('Invalid customerId format');
      }
      return true;
    }),
  body('walkIn.name')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Walk-in name cannot exceed 100 characters'),
  body('walkIn.mobile')
    .optional()
    .isString()
    .trim(),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateParseLines = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  body('text')
    .isString()
    .withMessage('Text must be a string')
    .trim()
    .notEmpty()
    .withMessage('Text is required')
    .isLength({ max: 5000 })
    .withMessage('Text exceeds maximum limit of 5000 characters'),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateAddLine = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  body('itemId')
    .notEmpty()
    .withMessage('itemId is required')
    .custom(isValidObjectId)
    .withMessage('Invalid itemId format'),
  body('quantity')
    .notEmpty()
    .withMessage('Quantity is required')
    .custom(isValidQuantity),
  body('unitType')
    .optional()
    .isIn(['UNIT', 'PACK'])
    .withMessage('unitType must be "UNIT" or "PACK"'),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateUpdateLine = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  param('lineId')
    .custom(isValidObjectId)
    .withMessage('Invalid lineId format'),
  body('quantity')
    .optional()
    .custom(isValidQuantity),
  body('unitType')
    .optional()
    .isIn(['UNIT', 'PACK'])
    .withMessage('unitType must be "UNIT" or "PACK"'),
  body('itemId')
    .optional()
    .custom(isValidObjectId)
    .withMessage('Invalid itemId format'),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateDeleteLine = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  param('lineId')
    .custom(isValidObjectId)
    .withMessage('Invalid lineId format'),
  query('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateDraftId = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid draft ID format'),
  body('expectedVersion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be an integer of at least 1'),
];

export const validateItemSearch = [
  query('q')
    .isString()
    .withMessage('Query parameter "q" must be a string')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Query parameter "q" must have at least 1 character'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Limit must be an integer between 1 and 20'),
];

export const validateCustomerId = [
  param('customerId')
    .custom(isValidObjectId)
    .withMessage('Invalid customerId format'),
];

export default {
  validateCreateDraft,
  validateUpdateDraft,
  validateParseLines,
  validateAddLine,
  validateUpdateLine,
  validateDeleteLine,
  validateDraftId,
  validateItemSearch,
  validateCustomerId,
};

