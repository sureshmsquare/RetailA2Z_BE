import mongoose from 'mongoose';
import CreditOverrideRequest from '../models/CreditOverrideRequest.js';
import BillDraft from '../models/BillDraft.js';
import Customer from '../models/Customer.js';
import billingService from './billingService.js';
import auditService from './auditService.js';
import { getCreditProfile } from './customerCreditAdapter.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toRupees } from '../utils/money.js';
import { buildLineSignature, computeCreditImpact } from '../utils/billTotals.js';
import { serializeDraftForRole } from '../utils/serializer.js';

export const creditOverrideService = {
  /**
   * Submits a credit override request for a bill draft (BRD APR-04, CR-04).
   */
  async requestCreditOverride({
    storeId,
    draftId,
    actor,
    userRole = 'salesman',
    reason,
    expectedVersion,
  }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draftObjectId = new mongoose.Types.ObjectId(String(draftId));

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const draft = await BillDraft.findOne(
        scopeToStore({ _id: draftObjectId }, storeObjectId)
      ).session(session);

      if (!draft) {
        throw new AppError('Bill draft not found', 404);
      }

      if (draft.status !== 'open') {
        throw new AppError(`Cannot request credit override on a ${draft.status} draft`, 400);
      }

      // Concurrency check
      if (expectedVersion !== undefined && draft.version !== Number(expectedVersion)) {
        throw new AppError('DRAFT_VERSION_MISMATCH', 409, {
          code: 'DRAFT_VERSION_MISMATCH',
          currentVersion: draft.version,
        });
      }

      // Check if already pending
      if (draft.creditOverrideStatus === 'pending') {
        throw new AppError('A credit override request is already pending for this draft', 409, {
          code: 'OVERRIDE_ALREADY_PENDING',
        });
      }

      if (draft.billType !== 'credit' || !draft.customerId) {
        throw new AppError('Credit override is only available for credit bills with a customer account', 400);
      }

      // Validate reason length
      const trimmedReason = String(reason || '').trim();
      if (trimmedReason.length < 3 || trimmedReason.length > 500) {
        throw new AppError('Override reason must be between 3 and 500 characters', 400);
      }

      // Run validation context
      const valContext = await billingService.buildValidationContext(storeObjectId, draft, session);
      const validation = valContext.validation || {};
      const creditProfile = valContext.creditProfile;

      if (!creditProfile) {
        throw new AppError('Customer credit profile not found', 400);
      }

      // 1. Check for non-credit blockers
      const nonCreditBlockers = (validation.blockers || []).filter(
        (b) => !['CUSTOMER_INACTIVE', 'CREDIT_NOT_ALLOWED', 'CREDIT_RESTRICTED', 'CREDIT_CUSTOMER_REQUIRED', 'OVERDUE_BLOCKED'].includes(b.code)
      );

      if (nonCreditBlockers.length > 0) {
        const msg = nonCreditBlockers.map((b) => b.message).join(' ');
        throw new AppError(`Cannot request credit override while draft has item or stock blockers: ${msg}`, 400);
      }

      // 2. Check for Hard Blocks (BRD APR-04: Hard blocks cannot be bypassed)
      if (!creditProfile.isActive || !creditProfile.creditAllowed || creditProfile.creditRestricted) {
        let reasonMsg = 'Customer account is not eligible for credit override.';
        if (!creditProfile.isActive) reasonMsg = 'Customer account is inactive. Hard block cannot be overridden.';
        else if (!creditProfile.creditAllowed) reasonMsg = 'Customer is not approved for credit purchases. Hard block cannot be overridden.';
        else if (creditProfile.creditRestricted) reasonMsg = 'Customer credit is restricted. Hard block cannot be overridden.';

        throw new AppError('CREDIT_HARD_BLOCK', 422, {
          code: 'CREDIT_HARD_BLOCK',
          message: reasonMsg,
          ruleTriggered: 'hard_block',
        });
      }

      // 3. Determine rule triggered
      const billTotalPaise = Number(draft.totalPaise) || 0;
      const impact = computeCreditImpact({
        outstandingPaise: creditProfile.outstandingPaise,
        creditLimitPaise: creditProfile.creditLimitPaise,
        totalPaise: billTotalPaise,
      });

      let ruleTriggered = null;
      if (impact.overLimit || creditProfile.creditLimitPaise === 0) {
        ruleTriggered = 'credit_limit_exceeded';
      } else if (creditProfile.overduePaise > 0) {
        ruleTriggered = 'overdue_present';
      }

      if (!ruleTriggered) {
        throw new AppError('Draft does not require credit override approval (within credit limits and not overdue)', 400);
      }

      // 4. Build invoiceContext snapshot
      const currentOutstandingPaise = Number(creditProfile.outstandingPaise) || 0;
      const creditLimitPaise = Number(creditProfile.creditLimitPaise) || 0;
      const overduePaise = Number(creditProfile.overduePaise) || 0;
      const oldestOverdueDays = Number(creditProfile.oldestOverdueDays) || 0;
      const proposedSalePaise = billTotalPaise;
      const projectedExposurePaise = currentOutstandingPaise + proposedSalePaise;

      const [overrideRequest] = await CreditOverrideRequest.create(
        [
          {
            storeId: storeObjectId,
            draftId: draft._id,
            draftVersion: draft.version,
            requestedBy: actor._id,
            requestedAt: new Date(),
            customerId: draft.customerId,
            invoiceContext: {
              currentOutstandingPaise,
              creditLimitPaise,
              overduePaise,
              oldestOverdueDays,
              proposedSalePaise,
              projectedExposurePaise,
            },
            ruleTriggered,
            reason: trimmedReason,
            status: 'pending',
          },
        ],
        { session }
      );

      draft.creditOverrideStatus = 'pending';
      draft.creditOverrideRequestId = overrideRequest._id;
      draft.creditOverrideReason = trimmedReason;
      await draft.save({ session });

      await session.commitTransaction();

      await auditService.log({
        actor,
        storeId: storeObjectId,
        action: 'CREDIT_OVERRIDE_REQUESTED',
        entity: 'CreditOverrideRequest',
        entityId: overrideRequest._id,
        after: {
          draftId: draft._id,
          draftNumber: draft.draftNumber,
          ruleTriggered,
          projectedExposurePaise,
          reason: trimmedReason,
        },
      });

      const updatedContext = await billingService.buildValidationContext(storeObjectId, draft);
      return {
        success: true,
        message: 'Credit override request submitted successfully',
        draft: serializeDraftForRole(draft, userRole, updatedContext),
        request: overrideRequest,
      };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  },

  /**
   * Cancels a pending credit override request (by salesman or admin).
   */
  async cancelCreditOverride({ storeId, draftId, actor, userRole = 'salesman', expectedVersion }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draftObjectId = new mongoose.Types.ObjectId(String(draftId));

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const draft = await BillDraft.findOne(
        scopeToStore({ _id: draftObjectId }, storeObjectId)
      ).session(session);

      if (!draft) {
        throw new AppError('Bill draft not found', 404);
      }

      if (expectedVersion !== undefined && draft.version !== Number(expectedVersion)) {
        throw new AppError('DRAFT_VERSION_MISMATCH', 409, {
          code: 'DRAFT_VERSION_MISMATCH',
          currentVersion: draft.version,
        });
      }

      if (draft.creditOverrideStatus !== 'pending') {
        throw new AppError('No pending credit override request to cancel', 400);
      }

      const request = await CreditOverrideRequest.findOne(
        scopeToStore({ draftId: draft._id, status: 'pending' }, storeObjectId)
      ).session(session);

      if (request) {
        request.status = 'cancelled';
        await request.save({ session });
      }

      draft.creditOverrideStatus = 'none';
      draft.creditOverrideRequestId = null;
      draft.creditOverrideReason = '';
      draft.version = (draft.version || 1) + 1;
      await draft.save({ session });

      await session.commitTransaction();

      await auditService.log({
        actor,
        storeId: storeObjectId,
        action: 'CREDIT_OVERRIDE_CANCELLED',
        entity: 'CreditOverrideRequest',
        entityId: request?._id,
        reason: 'Staff cancelled request',
      });

      const context = await billingService.buildValidationContext(storeObjectId, draft);
      return {
        success: true,
        message: 'Credit override request cancelled',
        draft: serializeDraftForRole(draft, userRole, context),
      };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  },

  /**
   * Lists credit override requests for approvals page (admin only).
   */
  async listCreditOverrides({ storeId, query = {} }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = scopeToStore({}, storeObjectId);
    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    } else if (!query.status) {
      filter.status = 'pending';
    }

    const [requests, total] = await Promise.all([
      CreditOverrideRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('requestedBy', 'name email role')
        .populate('decidedBy', 'name email role')
        .populate('customerId', 'customerCode name mobile creditLimitPaise')
        .populate({
          path: 'draftId',
          select: 'draftNumber createdBy billType customer customerId walkIn lines totalPaise version status creditOverrideStatus',
        })
        .lean(),
      CreditOverrideRequest.countDocuments(filter),
    ]);

    const data = requests.map((req) => {
      const d = req.draftId || {};
      const c = req.customerId || {};
      const ctx = req.invoiceContext || {};

      return {
        id: req._id.toString(),
        _id: req._id.toString(),
        status: req.status,
        requestedAt: req.requestedAt,
        ruleTriggered: req.ruleTriggered,
        reason: req.reason,
        invoiceContext: {
          currentOutstanding: toRupees(ctx.currentOutstandingPaise || 0),
          currentOutstandingPaise: ctx.currentOutstandingPaise || 0,
          creditLimit: toRupees(ctx.creditLimitPaise || 0),
          creditLimitPaise: ctx.creditLimitPaise || 0,
          overdue: toRupees(ctx.overduePaise || 0),
          overduePaise: ctx.overduePaise || 0,
          oldestOverdueDays: ctx.oldestOverdueDays || 0,
          proposedSale: toRupees(ctx.proposedSalePaise || 0),
          proposedSalePaise: ctx.proposedSalePaise || 0,
          projectedExposure: toRupees(ctx.projectedExposurePaise || 0),
          projectedExposurePaise: ctx.projectedExposurePaise || 0,
        },
        decidedAt: req.decidedAt,
        decidedBy: req.decidedBy
          ? { id: req.decidedBy._id, name: req.decidedBy.name, role: req.decidedBy.role }
          : null,
        decisionReason: req.decisionReason,
        customer: {
          id: c._id ? c._id.toString() : null,
          code: c.customerCode || '',
          name: c.name || 'Customer',
          mobile: c.mobile || '',
        },
        draftSummary: {
          id: d._id ? d._id.toString() : null,
          draftNumber: d.draftNumber || '',
          billType: d.billType || 'credit',
          total: toRupees(d.totalPaise || ctx.proposedSalePaise || 0),
          totalPaise: d.totalPaise || ctx.proposedSalePaise || 0,
          owner: d.createdBy?.name || req.requestedBy?.name || 'Staff',
          version: d.version || req.draftVersion,
          creditOverrideStatus: d.creditOverrideStatus || req.status,
        },
      };
    });

    return {
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  /**
   * Retrieves single credit override detail with line-level pricing for admin (BRD Section 05).
   */
  async getCreditOverrideById({ storeId, requestId }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const requestObjectId = new mongoose.Types.ObjectId(String(requestId));

    const req = await CreditOverrideRequest.findOne(
      scopeToStore({ _id: requestObjectId }, storeObjectId)
    )
      .populate('requestedBy', 'name email role')
      .populate('decidedBy', 'name email role')
      .populate('customerId')
      .populate('draftId')
      .lean();

    if (!req) {
      throw new AppError('Credit override request not found', 404);
    }

    const d = req.draftId || {};
    const c = req.customerId || {};
    const ctx = req.invoiceContext || {};

    const lines = (d.lines || []).map((l) => ({
      lineId: l.lineId ? l.lineId.toString() : null,
      itemId: l.itemId ? l.itemId.toString() : null,
      productCode: l.productCode,
      itemName: l.itemName,
      specText: l.specText || '',
      quantity: l.quantity,
      unitLabel: l.unitLabel || 'PCS',
      quantityBase: l.quantityBase,
      rate: toRupees(l.rateSnapshotPaise),
      rateSnapshotPaise: l.rateSnapshotPaise,
      amount: toRupees(l.amountPaise),
      amountPaise: l.amountPaise,
      taxRatePercent: l.taxRatePercent || 0,
    }));

    return {
      success: true,
      data: {
        id: req._id.toString(),
        _id: req._id.toString(),
        status: req.status,
        requestedAt: req.requestedAt,
        ruleTriggered: req.ruleTriggered,
        reason: req.reason,
        invoiceContext: {
          currentOutstanding: toRupees(ctx.currentOutstandingPaise || 0),
          currentOutstandingPaise: ctx.currentOutstandingPaise || 0,
          creditLimit: toRupees(ctx.creditLimitPaise || 0),
          creditLimitPaise: ctx.creditLimitPaise || 0,
          overdue: toRupees(ctx.overduePaise || 0),
          overduePaise: ctx.overduePaise || 0,
          oldestOverdueDays: ctx.oldestOverdueDays || 0,
          proposedSale: toRupees(ctx.proposedSalePaise || 0),
          proposedSalePaise: ctx.proposedSalePaise || 0,
          projectedExposure: toRupees(ctx.projectedExposurePaise || 0),
          projectedExposurePaise: ctx.projectedExposurePaise || 0,
        },
        requestedBy: req.requestedBy
          ? { id: req.requestedBy._id, name: req.requestedBy.name, role: req.requestedBy.role }
          : null,
        decidedAt: req.decidedAt,
        decidedBy: req.decidedBy
          ? { id: req.decidedBy._id, name: req.decidedBy.name, role: req.decidedBy.role }
          : null,
        decisionReason: req.decisionReason,
        customer: {
          id: c._id ? c._id.toString() : null,
          code: c.customerCode || '',
          name: c.name || 'Customer',
          mobile: c.mobile || '',
          creditDays: c.creditDays || 0,
        },
        draft: {
          id: d._id ? d._id.toString() : null,
          draftNumber: d.draftNumber,
          billType: d.billType,
          total: toRupees(d.totalPaise),
          totalPaise: d.totalPaise,
          version: d.version,
          creditOverrideStatus: d.creditOverrideStatus,
          lines,
        },
      },
    };
  },

  /**
   * Approves or rejects a credit override request (BRD APR-04, CR-04).
   */
  async decideCreditOverride({ storeId, requestId, actor, decision, decisionReason }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const requestObjectId = new mongoose.Types.ObjectId(String(requestId));

    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError('Decision must be either "approved" or "rejected"', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const request = await CreditOverrideRequest.findOne(
        scopeToStore({ _id: requestObjectId }, storeObjectId)
      ).session(session);

      if (!request) {
        throw new AppError('Credit override request not found', 404);
      }

      const draft = await BillDraft.findOne(
        scopeToStore({ _id: request.draftId }, storeObjectId)
      ).session(session);

      if (!draft) {
        throw new AppError('Bill draft not found', 404);
      }

      // Check draft version mismatch or already auto-expired due to draft edit -> 409 DRAFT_CHANGED (BRD APR-04)
      if (draft.version !== request.draftVersion || request.status === 'expired') {
        request.status = 'expired';
        await request.save({ session });

        draft.creditOverrideStatus = 'none';
        draft.creditOverrideRequestId = null;
        await draft.save({ session });

        await session.commitTransaction();

        throw new AppError('DRAFT_CHANGED', 409, {
          code: 'DRAFT_CHANGED',
          message: 'Draft has been modified since credit override was requested',
        });
      }

      if (request.status !== 'pending') {
        throw new AppError('Credit override request is no longer pending', 400);
      }

      // Re-run validation NOW: check if customer is now inactive or hard-blocked
      const customer = await Customer.findOne(
        scopeToStore({ _id: draft.customerId }, storeObjectId)
      ).session(session);

      if (!customer || !customer.isActive || !customer.creditEnabled || customer.creditRestricted) {
        request.status = 'expired';
        await request.save({ session });

        draft.creditOverrideStatus = 'none';
        draft.creditOverrideRequestId = null;
        await draft.save({ session });

        await session.commitTransaction();

        throw new AppError('CREDIT_HARD_BLOCK', 422, {
          code: 'CREDIT_HARD_BLOCK',
          message: 'Customer account is deactivated, restricted, or not approved for credit. Hard block cannot be approved.',
        });
      }

      if (decision === 'approved') {
        const lineSignature = buildLineSignature(draft);
        const exposurePaise = request.invoiceContext.projectedExposurePaise;

        const snapshot = {
          version: draft.version,
          lineSignature,
          exposurePaise,
        };

        draft.creditOverrideStatus = 'approved';
        draft.creditOverrideApprovedAt = new Date();
        draft.creditOverrideApprovedBy = actor._id;
        draft.creditOverrideApprovalSnapshot = snapshot;
        draft.creditOverrideReason = decisionReason ? decisionReason.trim() : '';
        await draft.save({ session });

        request.status = 'approved';
        request.decidedBy = actor._id;
        request.decidedAt = new Date();
        request.decisionReason = decisionReason ? decisionReason.trim() : null;
        request.approvalSnapshot = snapshot;
        await request.save({ session });

        await session.commitTransaction();

        await auditService.log({
          actor,
          storeId: storeObjectId,
          action: 'CREDIT_OVERRIDE_APPROVED',
          entity: 'CreditOverrideRequest',
          entityId: request._id,
          after: {
            draftId: draft._id,
            exposurePaise,
          },
        });
      } else {
        // Rejected
        const reasonTrimmed = String(decisionReason || '').trim();
        if (!reasonTrimmed || reasonTrimmed.length < 3) {
          throw new AppError('Decision reason is required when rejecting a credit override (at least 3 characters)', 400);
        }

        draft.creditOverrideStatus = 'rejected';
        draft.creditOverrideReason = reasonTrimmed;
        draft.version = (draft.version || 1) + 1;
        await draft.save({ session });

        request.status = 'rejected';
        request.decidedBy = actor._id;
        request.decidedAt = new Date();
        request.decisionReason = reasonTrimmed;
        await request.save({ session });

        await session.commitTransaction();

        await auditService.log({
          actor,
          storeId: storeObjectId,
          action: 'CREDIT_OVERRIDE_REJECTED',
          entity: 'CreditOverrideRequest',
          entityId: request._id,
          reason: reasonTrimmed,
        });
      }

      const context = await billingService.buildValidationContext(storeObjectId, draft);
      return {
        success: true,
        message: `Credit override request ${decision}`,
        request,
        draft: serializeDraftForRole(draft, 'admin', context),
      };
    } catch (err) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw err;
    } finally {
      session.endSession();
    }
  },

  /**
   * Pending credit override count for sidebar badge.
   */
  async getPendingCreditCount({ storeId }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const pendingCount = await CreditOverrideRequest.countDocuments(
      scopeToStore({ status: 'pending' }, storeObjectId)
    );
    return { success: true, pendingCount };
  },
};

export default creditOverrideService;
