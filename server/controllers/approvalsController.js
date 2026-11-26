import discountService from '../services/discountService.js';
import creditOverrideService from '../services/creditOverrideService.js';
import { toPaise } from '../utils/money.js';

export const approvalsController = {
  /**
   * GET /api/approvals/discounts
   */
  async listDiscountApprovals(req, res, next) {
    try {
      const result = await discountService.listDiscountApprovals({
        storeId: req.storeId,
        actor: req.user,
        query: req.query,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/approvals/discounts/:id
   */
  async getDiscountApproval(req, res, next) {
    try {
      const result = await discountService.getDiscountApprovalById({
        storeId: req.storeId,
        requestId: req.params.id,
        actor: req.user,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/approvals/discounts/:id/decide
   */
  async decideDiscount(req, res, next) {
    try {
      let approvedAmountPaise = req.body.approvedAmountPaise;
      if (approvedAmountPaise === undefined && req.body.approvedAmount !== undefined) {
        approvedAmountPaise = toPaise(req.body.approvedAmount);
      }

      const result = await discountService.decideDiscount({
        storeId: req.storeId,
        requestId: req.params.id,
        actor: req.user,
        decision: req.body.decision,
        approvedAmountPaise,
        approvedPercent: req.body.approvedPercent,
        decisionReason: req.body.decisionReason,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/approvals/credit-overrides
   */
  async listCreditOverrides(req, res, next) {
    try {
      const result = await creditOverrideService.listCreditOverrides({
        storeId: req.storeId,
        query: req.query,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/approvals/credit-overrides/:id
   */
  async getCreditOverride(req, res, next) {
    try {
      const result = await creditOverrideService.getCreditOverrideById({
        storeId: req.storeId,
        requestId: req.params.id,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/approvals/credit-overrides/:id/decide
   */
  async decideCreditOverride(req, res, next) {
    try {
      const result = await creditOverrideService.decideCreditOverride({
        storeId: req.storeId,
        requestId: req.params.id,
        actor: req.user,
        decision: req.body.decision,
        decisionReason: req.body.decisionReason,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/approvals/credit-overrides/pending-count
   */
  async getPendingCreditCount(req, res, next) {
    try {
      const result = await creditOverrideService.getPendingCreditCount({
        storeId: req.storeId,
      });
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/approvals/pending-counts and /api/approvals/discounts/pending-count
   */
  async getPendingCounts(req, res, next) {
    try {
      const [discountResult, creditResult] = await Promise.all([
        discountService.getPendingCount({ storeId: req.storeId }),
        creditOverrideService.getPendingCreditCount({ storeId: req.storeId }),
      ]);

      const pendingDiscounts = discountResult?.pendingCount || 0;
      const pendingCreditOverrides = creditResult?.pendingCount || 0;
      const pendingCount = pendingDiscounts + pendingCreditOverrides;

      return res.status(200).json({
        success: true,
        pendingCount,
        pendingTotal: pendingCount,
        pendingDiscounts,
        pendingCreditOverrides,
      });
    } catch (err) {
      next(err);
    }
  },
};

export default approvalsController;

