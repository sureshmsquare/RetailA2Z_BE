import { validationResult } from 'express-validator';

/**
 * Middleware that inspects express-validator results
 * Returns 400 with descriptive error messages
 */
export function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array().map((err) => ({
        field: err.path || err.param,
        message: err.msg,
      })),
    });
  }
  next;
  next();
}

