import customerService from '../services/customerService.js';

/**
 * Customer Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, and sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const customerController = {
  /**
   * POST /api/customers
   * Admin and Sales Staff
   */
  async createCustomer(req, res, next) {
    try {
      const customer = await customerService.createCustomer({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        userRole: req.user?.role,
        data: req.body,
      });

      return res.status(201).json({
        success: true,
        message: 'Customer created successfully.',
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/customers
   * Admin, Sales Staff, Collections Staff
   */
  async listCustomers(req, res, next) {
    try {
      const result = await customerService.listCustomers({
        storeId: req.storeId,
        filters: req.query,
        pagination: req.query,
      });

      return res.status(200).json({
        success: true,
        data: result.customers,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/customers/lookup?mobile=
   * Admin, Sales Staff, Collections Staff
   */
  async lookupCustomers(req, res, next) {
    try {
      const customers = await customerService.lookupCustomersByMobile({
        storeId: req.storeId,
        mobile: req.query.mobile,
      });

      return res.status(200).json({
        success: true,
        data: customers,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/customers/:id
   * Admin, Sales Staff, Collections Staff
   */
  async getCustomerById(req, res, next) {
    try {
      const customer = await customerService.getCustomerById({
        storeId: req.storeId,
        customerId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/customers/:id
   * Admin and Sales Staff (basic fields only)
   */
  async updateCustomer(req, res, next) {
    try {
      const isConfirmed =
        req.body.confirmDuplicate === true ||
        req.body.confirmDuplicate === 'true' ||
        req.body.confirm_duplicate === true ||
        req.body.confirm_duplicate === 'true';

      const customer = await customerService.updateCustomerBasic({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        customerId: req.params.id,
        updateData: req.body,
        confirmDuplicate: Boolean(isConfirmed),
      });

      return res.status(200).json({
        success: true,
        message: 'Customer updated successfully.',
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/customers/:id/credit-terms
   * Admin only
   */
  async updateCreditTerms(req, res, next) {
    try {
      const isCreditEnabled =
        req.body.credit_enabled !== undefined
          ? req.body.credit_enabled
          : req.body.creditEnabled;
      const creditLimit =
        req.body.credit_limit !== undefined
          ? req.body.credit_limit
          : req.body.creditLimit;
      const creditDays =
        req.body.credit_days !== undefined
          ? req.body.credit_days
          : req.body.creditDays;

      const result = await customerService.updateCreditTerms({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        customerId: req.params.id,
        creditEnabled: isCreditEnabled,
        creditLimit,
        creditDays,
        reason: req.body.reason,
      });

      return res.status(200).json({
        success: true,
        message: 'Customer credit terms updated successfully.',
        data: result.customer,
        history: result.history,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/customers/:id/status
   * Admin only
   */
  async setCustomerStatus(req, res, next) {
    try {
      const isActive =
        req.body.is_active !== undefined ? req.body.is_active : req.body.isActive;

      const customer = await customerService.setCustomerStatus({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        customerId: req.params.id,
        isActive,
      });

      return res.status(200).json({
        success: true,
        message: `Customer ${customer.isActive ? 'activated' : 'deactivated'} successfully.`,
        data: customer,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/customers/:id/credit-history
   * Admin and Collections Staff
   */
  async getCreditHistory(req, res, next) {
    try {
      const history = await customerService.getCreditHistory({
        storeId: req.storeId,
        customerId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default customerController;
