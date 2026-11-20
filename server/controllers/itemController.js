import itemService from '../services/itemService.js';
import stockService from '../services/stockService.js';
import { serializeItemForRole, serializeItemListForRole } from '../utils/serializer.js';

/**
 * Item Controller - Thin Controller Layer.
 * Reads req, calls ONE service function, serializes via serializeItemForRole, and sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const itemController = {
  /**
   * GET /api/items/next-code
   * Admin only - preview next auto-generated productCode without reserving or incrementing
   */
  async getNextProductCode(req, res, next) {
    try {
      const nextCode = await itemService.previewNextProductCode({
        storeId: req.storeId,
      });

      return res.status(200).json({
        success: true,
        nextCode,
        data: { nextCode },
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/items
   * Admin only
   */
  async createItem(req, res, next) {
    try {
      const item = await itemService.createItem({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemData: req.body,
      });

      const serialized = serializeItemForRole(item, req.user?.role);

      return res.status(201).json({
        success: true,
        message: 'Item created successfully.',
        data: serialized,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/items/:id
   * Admin only - non-price fields
   */
  async updateItem(req, res, next) {
    try {
      const item = await itemService.updateItem({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemId: req.params.id,
        updateData: req.body,
      });

      const serialized = serializeItemForRole(item, req.user?.role);

      return res.status(200).json({
        success: true,
        message: 'Item updated successfully.',
        data: serialized,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/items/:id/price
   * Admin only
   */
  async setSellingPrice(req, res, next) {
    try {
      const item = await itemService.setSellingPrice({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemId: req.params.id,
        price: req.body.price,
        effectiveFrom: req.body.effectiveFrom,
        reason: req.body.reason,
      });

      const serialized = serializeItemForRole(item, req.user?.role);

      return res.status(200).json({
        success: true,
        message: 'Selling price updated successfully.',
        data: serialized,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * PATCH /api/items/:id/status
   * Admin only
   */
  async setStatus(req, res, next) {
    try {
      const item = await itemService.setStatus({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        itemId: req.params.id,
        status: req.body.status,
      });

      const serialized = serializeItemForRole(item, req.user?.role);

      return res.status(200).json({
        success: true,
        message: `Item status set to '${req.body.status}'.`,
        data: serialized,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/items/:id
   * Admin and Salesman
   */
  async getItemById(req, res, next) {
    try {
      const item = await itemService.getItemById({
        storeId: req.storeId,
        itemId: req.params.id,
      });

      const serialized = serializeItemForRole(item, req.user?.role);

      return res.status(200).json({
        success: true,
        data: serialized,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/items
   * Admin only listing
   */
  async listItems(req, res, next) {
    try {
      const result = await itemService.listItems({
        storeId: req.storeId,
        filters: req.query,
        pagination: req.query,
      });

      const serializedItems = serializeItemListForRole(result.items, req.user?.role);

      return res.status(200).json({
        success: true,
        data: serializedItems,
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
   * GET /api/items/search
   * Admin and Salesman
   */
  async searchItems(req, res, next) {
    try {
      const search = req.query.q || req.query.search || '';
      const result = await itemService.searchActiveItems({
        storeId: req.storeId,
        search,
        categoryId: req.query.categoryId || null,
        brandId: req.query.brandId || null,
        pagination: req.query,
      });

      const serializedItems = serializeItemListForRole(result.items, req.user?.role);

      return res.status(200).json({
        success: true,
        data: serializedItems,
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
   * GET /api/items/:id/price-history
   * Admin only
   */
  async getPriceHistory(req, res, next) {
    try {
      const history = await itemService.getPriceHistory({
        storeId: req.storeId,
        itemId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: history,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/items/:id/stock-movements
   * Admin only
   */
  async getStockMovements(req, res, next) {
    try {
      const movements = await itemService.getStockMovements({
        storeId: req.storeId,
        itemId: req.params.id,
      });

      return res.status(200).json({
        success: true,
        data: movements,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default itemController;

