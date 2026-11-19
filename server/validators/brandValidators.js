import { body, param } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const collapseSpaces = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const validateCreateBrand = [
  body('name')
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Brand name is required')
    .isLength({ max: 60 })
    .withMessage('Brand name must be at most 60 characters'),
];

export const validateRenameBrand = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid brand ID format'),
  body('name')
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Brand name is required')
    .isLength({ max: 60 })
    .withMessage('Brand name must be at most 60 characters'),
];

export const validateSetBrandStatus = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid brand ID format'),
  body('isActive')
    .isBoolean({ strict: true })
    .withMessage('isActive must be a boolean'),
];

export const validateDeleteBrand = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid brand ID format'),
];

