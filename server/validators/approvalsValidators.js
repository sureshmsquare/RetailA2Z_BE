import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const validateRequestId = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid discount request ID format'),
];

export const validateDecideDiscount = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid discount request ID format'),
  body('decision')
    .notEmpty()
    .withMessage('Decision is required')
    .isIn(['approved', 'rejected'])
    .withMessage('Decision must be either "approved" or "rejected"'),
  body('approvedAmountPaise')
    .optional()
    .isInt({ min: 0 })
    .withMessage('approvedAmountPaise must be a non-negative integer'),
  body('approvedAmount')
    .optional()
    .isNumeric()
    .withMessage('approvedAmount must be a number'),
  body('approvedPercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('approvedPercent must be between 0 and 100'),
  body('decisionReason')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('decisionReason cannot exceed 500 characters'),
];

export const validateDecideCreditOverride = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid credit override request ID format'),
  body('decision')
    .notEmpty()
    .withMessage('Decision is required')
    .isIn(['approved', 'rejected'])
    .withMessage('Decision must be either "approved" or "rejected"'),
  body('decisionReason')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('decisionReason cannot exceed 500 characters'),
];

export default {
  validateRequestId,
  validateDecideDiscount,
  validateDecideCreditOverride,
};

