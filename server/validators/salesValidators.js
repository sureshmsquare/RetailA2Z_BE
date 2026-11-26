import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const validatePostDraft = [
  param('id')
    .notEmpty()
    .withMessage('Draft ID is required')
    .custom(isValidObjectId)
    .withMessage('Invalid Draft ID format'),

  body('expectedVersion')
    .notEmpty()
    .withMessage('expectedVersion is required')
    .isInt({ min: 1 })
    .withMessage('expectedVersion must be a positive integer'),

  body('mode')
    .optional()
    .trim()
    .toUpperCase()
    .isIn(['CASH', 'UPI', 'CARD', 'SPLIT', 'CREDIT'])
    .withMessage('Invalid payment mode. Must be one of CASH, UPI, CARD, SPLIT, CREDIT'),

  body('amountReceived')
    .optional()
    .isNumeric()
    .withMessage('amountReceived must be a valid number')
    .custom((val) => Number(val) >= 0)
    .withMessage('amountReceived must be non-negative'),

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
];

export const validateInvoiceId = [
  param('id')
    .notEmpty()
    .withMessage('Invoice ID is required')
    .custom(isValidObjectId)
    .withMessage('Invalid Invoice ID format'),
];

export const validateListInvoices = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),

  query('billType')
    .optional()
    .isIn(['cash', 'credit'])
    .withMessage('billType must be either cash or credit'),

  query('settlementStatus')
    .optional()
    .isIn(['unpaid', 'part_paid', 'settled'])
    .withMessage('settlementStatus must be one of unpaid, part_paid, settled'),
];

