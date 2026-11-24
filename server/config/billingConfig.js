/**
 * Billing Module Configuration
 * Default configuration driven by environment variables with fallback defaults.
 * Uses dynamic getters so that runtime/test environment variable overrides are immediately observed.
 */
export const billingConfig = {
  get ROUND_OFF_MODE() {
    return process.env.BILLING_ROUND_OFF_MODE || 'none'; // 'none' | 'nearest_rupee'
  },
  get STOCK_POLICY() {
    return process.env.BILLING_STOCK_POLICY || 'block'; // 'block' | 'warn'
  },
  get OVERDUE_POLICY() {
    return process.env.BILLING_OVERDUE_POLICY || 'warn'; // 'warn' | 'approval' | 'block'
  },
  get MAX_LINES_PER_DRAFT() {
    return parseInt(process.env.BILLING_MAX_LINES_PER_DRAFT, 10) || 200;
  },
  get MAX_QUANTITY() {
    return parseFloat(process.env.BILLING_MAX_QUANTITY) || 999999.999;
  },
};

export default billingConfig;

