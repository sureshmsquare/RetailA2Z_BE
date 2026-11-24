import purchaseService from '../services/purchaseService.js';

/**
 * Purchase Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, and sends response.
 * Contains NO business rules and NO direct DB queries.
 * storeId is ALWAYS read from req.storeId, NEVER from the body.
 */
export const purchaseController = {
  /**
   * GET /api/purchases
   * List purchases with optional filtering and pagination.
   */
  async listPurchases(req, res, next) {
    try {
      const result = await purchaseService.listPurchases({
        storeId: req.storeId,
        filters: req.query,
        pagination: req.query,
      });

      return res.status(200).json({
        success: true,
        data: result.purchases,
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
   * GET /api/purchases/:id
   * Get single purchase details (includes stock movements if posted or cancelled).
   */
  async getPurchase(req, res, next) {
    try {
      const purchase = await purchaseService.getPurchase({
        storeId: req.storeId,
        purchaseId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: purchase,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/purchases
   * Create a new draft purchase.
   */
  async createDraft(req, res, next) {
    try {
      const purchase = await purchaseService.createDraft({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        purchaseData: req.body,
      });

      return res.status(201).json({
        success: true,
        message: 'Draft purchase created successfully',
        data: purchase,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PUT /api/purchases/:id
   * Update an existing draft purchase.
   */
  async updateDraft(req, res, next) {
    try {
      const purchase = await purchaseService.updateDraft({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        purchaseId: req.params.id,
        updateData: req.body,
      });

      return res.status(200).json({
        success: true,
        message: 'Draft purchase updated successfully',
        data: purchase,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/purchases/:id/post
   * Post a purchase receipt, allocating purchaseNumber and creating StockMovements.
   */
  async postPurchase(req, res, next) {
    try {
      const idempotencyKey = req.headers['idempotency-key'] || req.headers['Idempotency-Key'];
      const purchase = await purchaseService.postPurchase({
        storeId: req.storeId,
        purchaseId: req.params.id,
        idempotencyKey,
        actor: req.user?._id || req.user?.id || 'admin',
      });

      return res.status(200).json({
        success: true,
        message: 'Purchase posted successfully',
        data: purchase,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/purchases/:id/cancel
   * Cancel a posted purchase, creating reversal movements.
   */
  async cancelPurchase(req, res, next) {
    try {
      const purchase = await purchaseService.cancelPurchase({
        storeId: req.storeId,
        purchaseId: req.params.id,
        reason: req.body?.reason,
        actor: req.user?._id || req.user?.id || 'admin',
      });

      return res.status(200).json({
        success: true,
        message: 'Purchase cancelled successfully',
        data: purchase,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * DELETE /api/purchases/:id
   * Delete an existing draft purchase.
   */
  async deleteDraft(req, res, next) {
    try {
      const result = await purchaseService.deleteDraft({
        storeId: req.storeId,
        purchaseId: req.params.id,
        actor: req.user?._id || req.user?.id || 'admin',
      });

      return res.status(200).json({
        success: true,
        message: 'Draft purchase deleted successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default purchaseController;

