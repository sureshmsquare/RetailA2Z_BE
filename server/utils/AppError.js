/**
 * Standard Operational Error class for RetailA2Z.
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, extra = {}) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Object.assign(this, extra);

    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;

