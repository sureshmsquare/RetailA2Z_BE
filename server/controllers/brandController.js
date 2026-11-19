import brandService from '../services/brandService.js';

/**
 * Brand Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, and sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const brandController = {
  /**
   * GET /api/brands
   * Admin only
   */
  async listBrands(req, res, next) {
    try {
      const brands = await brandService.listBrands({
        storeId: req.storeId,
        filters: req.query,
      });

      return res.status(200).json({
        success: true,
        data: brands,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/brands/options
   * Admin and Salesman (active brands only: { id, name })
   */
  async listActiveBrandOptions(req, res, next) {
    try {
      const options = await brandService.listActiveBrandOptions({
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
   * POST /api/brands
   * Admin only
   */
  async createBrand(req, res, next) {
    try {
      const brand = await brandService.createBrand({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        name: req.body.name,
      });

      return res.status(201).json({
        success: true,
        message: 'Brand created successfully.',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/brands/:id
   * Admin only (rename)
   */
  async renameBrand(req, res, next) {
    try {
      const brand = await brandService.renameBrand({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        brandId: req.params.id,
        name: req.body.name,
      });

      return res.status(200).json({
        success: true,
        message: 'Brand renamed successfully.',
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/brands/:id/status
   * Admin only (activate/deactivate)
   */
  async setBrandStatus(req, res, next) {
    try {
      const brand = await brandService.setBrandStatus({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        brandId: req.params.id,
        isActive: req.body.isActive,
      });

      return res.status(200).json({
        success: true,
        message: `Brand ${req.body.isActive ? 'activated' : 'deactivated'} successfully.`,
        data: brand,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/brands/:id
   * Admin only
   */
  async deleteBrand(req, res, next) {
    try {
      await brandService.deleteBrand({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        id: req.params.id,
      });

      return res.status(200).json({
        success: true,
        message: 'Brand deleted successfully.',
      });
    } catch (error) {
      next(error);
    }
  },
};

export default brandController;

