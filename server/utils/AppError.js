/**
 * Standard Operational Error class for RetailA2Z.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    if (typeof details === 'object' && details !== null) {
      Object.assign(this, details);
    }

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
