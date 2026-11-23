import { body, param, query } from 'express-validator';
import mongoose from 'mongoose';
import { normalizeIndianMobile, isValidGSTIN } from '../models/Customer.js';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const validateCreateCustomer = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Customer name must be between 2 and 100 characters'),
  body('mobile')
    .trim()
    .notEmpty()
    .withMessage('Enter a valid 10-digit mobile number')
    .custom((val) => {
      const { isValid } = normalizeIndianMobile(val);
      if (!isValid) {
        throw new Error('Enter a valid 10-digit mobile number');
      }
      return true;
    }),
  body('locality').optional().trim(),
  body('business_name').optional().trim(),
  body('businessName').optional().trim(),
  body('gst_number')
    .optional()
    .trim()
    .custom((val) => {
      if (val && !isValidGSTIN(val)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)');
      }
      return true;
    }),
  body('gstNumber')
    .optional()
    .trim()
    .custom((val) => {
      if (val && !isValidGSTIN(val)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)');
      }
      return true;
    }),
  body('credit_enabled')
    .optional()
    .isBoolean()
    .withMessage('credit_enabled must be a boolean'),
  body('creditEnabled')
    .optional()
    .isBoolean()
    .withMessage('credit_enabled must be a boolean'),
  body('credit_limit')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Credit limit must be a non-negative number'),
  body('creditLimit')
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage('Credit limit must be a non-negative number'),
  body('credit_days')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('Credit days must be an integer of at least 1'),
  body('creditDays')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('Credit days must be an integer of at least 1'),
  // If credit is explicitly enabled by admin on create, validate required credit fields
  body().custom((_, { req }) => {
    const isCreditEnabled =
      req.body.credit_enabled !== undefined
        ? req.body.credit_enabled
        : req.body.creditEnabled;
    // Only check if explicitly sent as true (and will only be applied if user is admin)
    if (isCreditEnabled === true && req.user?.role === 'admin') {
      const limit =
        req.body.credit_limit !== undefined
          ? req.body.credit_limit
          : req.body.creditLimit;
      if (
        limit === undefined ||
        limit === null ||
        isNaN(Number(limit)) ||
        Number(limit) < 0
      ) {
        throw new Error(
          'Credit limit is required and must be a non-negative number when credit is enabled'
        );
      }
      const days =
        req.body.credit_days !== undefined
          ? req.body.credit_days
          : req.body.creditDays;
      if (
        days === undefined ||
        days === null ||
        !Number.isInteger(Number(days)) ||
        Number(days) < 1
      ) {
        throw new Error(
          'Credit days is required and must be an integer of at least 1 when credit is enabled'
        );
      }
    }
    return true;
  }),
];

export const validateUpdateCustomer = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid customer ID format'),
  body('name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Customer name cannot be empty')
    .isLength({ min: 2, max: 100 })
    .withMessage('Customer name must be between 2 and 100 characters'),
  body('mobile')
    .optional()
    .trim()
    .custom((val) => {
      if (val !== undefined && val !== null && val !== '') {
        const { isValid } = normalizeIndianMobile(val);
        if (!isValid) {
          throw new Error('Enter a valid 10-digit mobile number');
        }
      }
      return true;
    }),
  body('locality').optional().trim(),
  body('business_name').optional().trim(),
  body('businessName').optional().trim(),
  body('gst_number')
    .optional()
    .trim()
    .custom((val) => {
      if (val && !isValidGSTIN(val)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)');
      }
      return true;
    }),
  body('gstNumber')
    .optional()
    .trim()
    .custom((val) => {
      if (val && !isValidGSTIN(val)) {
        throw new Error('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)');
      }
      return true;
    }),
  // Forbid updating credit terms via basic update endpoint
  body('credit_enabled').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('creditEnabled').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('credit_limit').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('creditLimit').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('credit_days').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('creditDays').custom((val) => {
    if (val !== undefined) {
      throw new Error(
        'Credit terms cannot be updated via this endpoint. Use PUT /api/customers/:id/credit-terms'
      );
    }
    return true;
  }),
  body('confirmDuplicate')
    .optional()
    .isBoolean()
    .withMessage('confirmDuplicate must be a boolean'),
  body('confirm_duplicate')
    .optional()
    .isBoolean()
    .withMessage('confirm_duplicate must be a boolean'),
];

export const validateUpdateCreditTerms = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid customer ID format'),
  body().custom((_, { req }) => {
    const isCreditEnabled =
      req.body.credit_enabled !== undefined
        ? req.body.credit_enabled
        : req.body.creditEnabled;

    if (isCreditEnabled === undefined || typeof isCreditEnabled !== 'boolean') {
      throw new Error('credit_enabled must be a boolean');
    }

    if (isCreditEnabled === true) {
      const limit =
        req.body.credit_limit !== undefined
          ? req.body.credit_limit
          : req.body.creditLimit;
      if (
        limit === undefined ||
        limit === null ||
        isNaN(Number(limit)) ||
        Number(limit) < 0
      ) {
        throw new Error(
          'Credit limit is required and must be a non-negative number when credit is enabled'
        );
      }
      const days =
        req.body.credit_days !== undefined
          ? req.body.credit_days
          : req.body.creditDays;
      if (
        days === undefined ||
        days === null ||
        !Number.isInteger(Number(days)) ||
        Number(days) < 1
      ) {
        throw new Error(
          'Credit days is required and must be an integer of at least 1 when credit is enabled'
        );
      }
    }
    return true;
  }),
  body('reason').optional().trim(),
];

export const validateSetCustomerStatus = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid customer ID format'),
  body().custom((_, { req }) => {
    const isActive =
      req.body.is_active !== undefined ? req.body.is_active : req.body.isActive;
    if (isActive === undefined || typeof isActive !== 'boolean') {
      throw new Error('is_active must be a boolean');
    }
    return true;
  }),
];

export const validateLookupCustomer = [
  query('mobile')
    .trim()
    .notEmpty()
    .withMessage('Mobile query parameter is required'),
];
