import supplierService from '../services/supplierService.js';

/**
 * Supplier Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, and sends response.
 * Contains NO business rules and NO direct DB queries.
 * storeId is ALWAYS read from req.storeId, NEVER from the body.
 */
export const supplierController = {
  /**
   * GET /api/suppliers
   * Admin only
   */
  async listSuppliers(req, res, next) {
    try {
      const result = await supplierService.listSuppliers({
        storeId: req.storeId,
        filters: req.query,
        pagination: req.query,
      });

      return res.status(200).json({
        success: true,
        data: result.suppliers,
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
   * GET /api/suppliers/options
   * Admin only (active suppliers: { id, name })
   */
  async listActiveSupplierOptions(req, res, next) {
    try {
      const options = await supplierService.listActiveSupplierOptions({
        storeId: req.storeId,
      });

      return res.status(200).json({
        success: true,
        data: options,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/suppliers/:id
   * Admin only
   */
  async getSupplier(req, res, next) {
    try {
      const supplier = await supplierService.getSupplier({
        storeId: req.storeId,
        supplierId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: supplier,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/suppliers
   * Admin only
   */
  async createSupplier(req, res, next) {
    try {
      const supplier = await supplierService.createSupplier({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        supplierData: req.body,
        confirmDuplicateMobile: req.body.confirmDuplicateMobile === true,
      });

      return res.status(201).json({
        success: true,
        message: 'Supplier created successfully.',
        data: supplier,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/suppliers/:id
   * Admin only
   */
  async updateSupplier(req, res, next) {
    try {
      const supplier = await supplierService.updateSupplier({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        supplierId: req.params.id,
        updateData: req.body,
        confirmDuplicateMobile: req.body.confirmDuplicateMobile === true,
      });

      return res.status(200).json({
        success: true,
        message: 'Supplier updated successfully.',
        data: supplier,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/suppliers/:id/status
   * Admin only (activate/deactivate)
   */
  async setSupplierStatus(req, res, next) {
    try {
      const supplier = await supplierService.setSupplierStatus({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        supplierId: req.params.id,
        isActive: req.body.isActive,
      });

      return res.status(200).json({
        success: true,
        message: `Supplier ${req.body.isActive ? 'activated' : 'deactivated'} successfully.`,
        data: supplier,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/suppliers/:id
   * Admin only
   */
  async deleteSupplier(req, res, next) {
    try {
      await supplierService.deleteSupplier({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        supplierId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        message: 'Supplier deleted successfully.',
      });
    } catch (error) {
      next(error);
    }
  },
};

export default supplierController;

