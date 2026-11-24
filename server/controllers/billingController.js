import billingService from '../services/billingService.js';
import salesService from '../services/salesService.js';

/**
 * Billing Controller - Thin wrapper over billingService.
 * Routes handle HTTP, authentication, store-scoping, and express-validator.
 * Controllers simply pass parameters to billingService and return results.
 */
export const billingController = {
  /**
   * POST /api/billing/drafts
   */
  async createDraft(req, res, next) {
    try {
      const draft = await billingService.createDraft({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        data: req.body,
      });
      return res.status(201).json({
        success: true,
        data: draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/billing/drafts
   */
  async listDrafts(req, res, next) {
    try {
      const result = await billingService.listDrafts({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        query: req.query,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/billing/drafts/:id
   */
  async getDraft(req, res, next) {
    try {
      const draft = await billingService.getDraftById({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
      });
      return res.status(200).json({
        success: true,
        data: draft,
        draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/billing/drafts/:id
   */
  async updateDraft(req, res, next) {
    try {
      const draft = await billingService.updateDraft({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        data: req.body,
      });
      return res.status(200).json({
        success: true,
        data: draft,
        draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/billing/drafts/:id (Discard)
   */
  async discardDraft(req, res, next) {
    try {
      const expectedVersion = req.body?.expectedVersion || req.query?.expectedVersion;
      const draft = await billingService.discardDraft({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        expectedVersion,
      });
      return res.status(200).json({
        success: true,
        data: draft,
        draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/billing/drafts/:id/lines/parse
   */
  async parseLines(req, res, next) {
    try {
      const result = await billingService.parseAndAddLines({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        text: req.body.text,
        expectedVersion: req.body.expectedVersion,
      });
      return res.status(200).json({
        success: true,
        data: result.draft,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/billing/drafts/:id/lines (Add single line by itemId)
   */
  async addLine(req, res, next) {
    try {
      const result = await billingService.addLineByItem({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        data: req.body,
      });
      return res.status(200).json({
        success: true,
        data: result.draft,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/billing/drafts/:id/lines/:lineId
   */
  async updateLine(req, res, next) {
    try {
      const draft = await billingService.updateLine({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        lineId: req.params.lineId,
        data: req.body,
      });
      return res.status(200).json({
        success: true,
        data: draft,
        draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/billing/drafts/:id/lines/:lineId
   */
  async deleteLine(req, res, next) {
    try {
      const expectedVersion = req.body?.expectedVersion || req.query?.expectedVersion;
      const draft = await billingService.deleteLine({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        lineId: req.params.lineId,
        expectedVersion,
      });
      return res.status(200).json({
        success: true,
        data: draft,
        draft,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/billing/drafts/:id/refresh-prices
   */
  async refreshPrices(req, res, next) {
    try {
      const result = await billingService.refreshPrices({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        draftId: req.params.id,
        expectedVersion: req.body?.expectedVersion,
      });
      return res.status(200).json({
        success: true,
        data: result.draft,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/billing/items/search?q=&limit=
   */
  async searchItems(req, res, next) {
    try {
      const result = await billingService.searchItems({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        q: req.query.q,
        limit: req.query.limit,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/billing/customers/:customerId/credit
   */
  async getCustomerCredit(req, res, next) {
    try {
      const result = await billingService.getCustomerCredit({
        storeId: req.storeId,
        actor: req.user,
        userRole: req.user.role,
        customerId: req.params.customerId,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/billing/drafts/:id/post
   */
  async postDraft(req, res, next) {
    try {
      const result = await salesService.postDraftBill({
        storeId: req.storeId,
        draftId: req.params.id,
        actor: req.user,
        userRole: req.user.role,
        paymentDetails: req.body,
      });
      return res.status(201).json({
        success: true,
        message: result.isDuplicate ? 'Draft was already posted' : 'Bill posted successfully',
        data: result.invoice,
        receipt: result.receipt,
        isDuplicate: result.isDuplicate,
      });
    } catch (err) {
      next(err);
    }
  },
};

export default billingController;

