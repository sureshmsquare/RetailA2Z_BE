import stockService from '../services/stockService.js';

/**
 * Stock Controller - Thin Controller Layer.
 * Reads req, calls ONE stockService function, sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const stockController = {
  /**
   * POST /api/stock/opening
   * Admin only
   */
  async postOpeningStock(req, res, next) {
    try {
      const result = await stockService.postOpeningStock({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemId: req.body.itemId,
        quantity: req.body.quantity,
        effectiveDate: req.body.effectiveDate,
        reference: req.body.reference,
      });

      return res.status(201).json({
        success: true,
        message: 'Opening stock recorded successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/stock/adjustment
   * Admin only
   */
  async postAdjustment(req, res, next) {
    try {
      const result = await stockService.postAdjustment({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemId: req.body.itemId,
        quantity: req.body.quantity,
        reason: req.body.reason,
        reference: req.body.reference,
        effectiveDate: req.body.effectiveDate,
        allowNegative: req.body.allowNegative === true,
      });

      return res.status(201).json({
        success: true,
        message: 'Stock adjustment recorded successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default stockController;

