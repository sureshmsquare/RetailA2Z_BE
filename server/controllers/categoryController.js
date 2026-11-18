import categoryService from '../services/categoryService.js';

/**
 * Category Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, and sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const categoryController = {
  /**
   * GET /api/categories
   * Admin only
   */
  async listCategories(req, res, next) {
    try {
      const categories = await categoryService.listCategories({
        storeId: req.storeId,
        filters: req.query,
      });

      return res.status(200).json({
        success: true,
        data: categories,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/categories/options
   * Admin and Salesman (active categories only: { id, name })
   */
  async listActiveCategoryOptions(req, res, next) {
    try {
      const options = await categoryService.listActiveCategoryOptions({
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
   * POST /api/categories
   * Admin only
   */
  async createCategory(req, res, next) {
    try {
      const category = await categoryService.createCategory({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        name: req.body.name,
      });

      return res.status(201).json({
        success: true,
        message: 'Category created successfully.',
        data: category,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/categories/:id
   * Admin only (rename)
   */
  async renameCategory(req, res, next) {
    try {
      const category = await categoryService.renameCategory({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        categoryId: req.params.id,
        name: req.body.name,
      });

      return res.status(200).json({
        success: true,
        message: 'Category renamed successfully.',
        data: category,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/categories/:id/status
   * Admin only (activate/deactivate)
   */
  async setCategoryStatus(req, res, next) {
    try {
      const category = await categoryService.setCategoryStatus({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        categoryId: req.params.id,
        isActive: req.body.isActive,
      });

      return res.status(200).json({
        success: true,
        message: `Category ${req.body.isActive ? 'activated' : 'deactivated'} successfully.`,
        data: category,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default categoryController;

