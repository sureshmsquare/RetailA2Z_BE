import importService from '../services/importService.js';
import { AppError } from '../utils/AppError.js';

/**
 * Import Controller - Thin Controller Layer.
 * Reads req, calls ONE importService function, sends response.
 * Contains NO business rules and NO direct DB queries.
 */
export const importController = {
  /**
   * POST /api/items/import/stage
   * Admin only (multipart file)
   */
  async stageImport(req, res, next) {
    try {
      if (!req.file) {
        throw new AppError('File upload is required (multipart field name: file)', 400);
      }

      const sourceInfo = {
        sourceName: req.body.sourceName,
        sourceVersion: req.body.sourceVersion,
        sourceDate: req.body.sourceDate,
      };

      const result = await importService.stageImport({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        file: req.file,
        sourceInfo,
      });

      return res.status(201).json({
        success: true,
        message: 'Import file staged and validated successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * GET /api/items/import/:batchId
   * Admin only
   */
  async getImportBatch(req, res, next) {
    try {
      const batch = await importService.getImportBatch({
        storeId: req.storeId,
        batchId: req.params.batchId,
      });

      return res.status(200).json({
        success: true,
        data: batch,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/items/import/:batchId/approve
   * Admin only
   */
  async approveImport(req, res, next) {
    try {
      const options = {
        allValid: req.body.allValid === true,
        rowNumbers: req.body.rowNumbers,
      };

      const result = await importService.approveImport({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        batchId: req.params.batchId,
        options,
      });

      return res.status(200).json({
        success: true,
        message: 'Import batch approved and processed successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * POST /api/items/import/:batchId/cancel
   * Admin only
   */
  async cancelImport(req, res, next) {
    try {
      const result = await importService.cancelImport({
        storeId: req.storeId,
        actor: req.user?._id || req.user?.id || 'admin',
        batchId: req.params.batchId,
      });

      return res.status(200).json({
        success: true,
        message: 'Import batch cancelled successfully.',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  },
};

export default importController;

