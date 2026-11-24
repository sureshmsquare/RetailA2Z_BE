import { AppError } from '../utils/AppError.js';

/**
 * Central Error Handler Middleware.
 * Converts AppError to its status code, Mongo duplicate key (11000) to 409,
 * validation errors to 400; never leaks stack traces in responses.
 */
export function errorHandler(err, req, res, next) {
  // Operational errors created via AppError
  if (err instanceof AppError || err.isOperational) {
    const payload = {
      success: false,
      message: err.message,
    };
    if (err.code) payload.code = err.code;
    if (err.otherSupplierName) payload.otherSupplierName = err.otherSupplierName;
    if (err.details) payload.details = err.details;
    if (err.warning) payload.warning = err.warning;
    if (err.duplicates) payload.duplicates = err.duplicates;
    return res.status(err.statusCode || 400).json(payload);
  }

  // MongoDB Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const keys = err.keyValue ? Object.keys(err.keyValue).join(', ') : 'field';
    return res.status(409).json({
      success: false,
      message: `A duplicate record already exists with the same ${keys}.`,
      keyValue: err.keyValue,
    });
  }

  // Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors || {}).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: messages.length > 0 ? messages.join('. ') : 'Validation failed.',
      errors: messages,
    });
  }

  // Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: `Invalid format for field '${err.path}': ${err.value}.`,
    });
  }

  // Multer Error (e.g. file size exceeded)
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum allowed limit (5 MB).',
      });
    }
    return res.status(400).json({
      success: false,
      message: `File upload error: ${err.message}`,
    });
  }

  // Fallback for unexpected errors
  if (process.env.NODE_ENV !== 'test') {
    console.error('[Unhandled Internal Error]', err);
  }

  return res.status(500).json({
    success: false,
    message: err.message || 'Internal server error.',
  });
}

export default errorHandler;

