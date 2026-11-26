import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value));

export const validateListCollectionCustomers = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('overdueOnly')
    .optional()
    .isIn(['true', 'false', '1', '0', true, false])
    .withMessage('overdueOnly must be a boolean'),
];

export const validateCustomerIdParam = [
  param('customerId')
    .notEmpty()
    .withMessage('Customer ID is required')
    .custom(isValidObjectId)
    .withMessage('Invalid customer ID format'),
];

const isPositiveInt = (val) => {
  if (typeof val === 'boolean' || val === null || val === undefined || val === '') {
    return false;
  }
  if (typeof val === 'string' && !/^\d+$/.test(val.trim())) {
    return false;
  }
  const num = Number(val);
  return Number.isInteger(num) && num > 0;
};

export const validateRecordReceipt = [
  body('customerId')
    .notEmpty()
    .withMessage('customerId is required')
    .custom(isValidObjectId)
    .withMessage('Invalid customerId format'),

  body('amountPaise')
    .notEmpty()
    .withMessage('amountPaise is required')
    .custom(isPositiveInt)
    .withMessage('amountPaise must be a positive integer'),

  body('mode')
    .notEmpty()
    .withMessage('Payment mode is required')
    .trim()
    .toUpperCase()
    .isIn(['CASH', 'UPI', 'CARD', 'OTHER'])
    .withMessage('Payment mode must be one of CASH, UPI, CARD, OTHER'),

  body('reference')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Reference cannot exceed 100 characters'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),

  body('allocations')
    .isArray({ min: 1 })
    .withMessage('allocations must be a non-empty array'),

  body('allocations.*.invoiceId')
    .notEmpty()
    .withMessage('Each allocation requires an invoiceId')
    .custom(isValidObjectId)
    .withMessage('Invalid invoiceId format in allocations'),

  body('allocations.*.allocatedAmountPaise')
    .notEmpty()
    .withMessage('Each allocation requires allocatedAmountPaise')
    .custom(isPositiveInt)
    .withMessage('allocatedAmountPaise must be a positive integer'),
];
