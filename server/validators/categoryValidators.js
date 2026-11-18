import { body, param } from 'express-validator';
import mongoose from 'mongoose';

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const collapseSpaces = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

export const validateCreateCategory = [
  body('name')
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ max: 60 })
    .withMessage('Category name must be at most 60 characters'),
];

export const validateRenameCategory = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid category ID format'),
  body('name')
    .customSanitizer(collapseSpaces)
    .notEmpty()
    .withMessage('Category name is required')
    .isLength({ max: 60 })
    .withMessage('Category name must be at most 60 characters'),
];

export const validateSetCategoryStatus = [
  param('id')
    .custom(isValidObjectId)
    .withMessage('Invalid category ID format'),
  body('isActive')
    .isBoolean({ strict: true })
    .withMessage('isActive must be a boolean'),
];

