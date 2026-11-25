import mongoose from 'mongoose';
import DiscountRequest from '../models/DiscountRequest.js';
import BillDraft from '../models/BillDraft.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toRupees } from '../utils/money.js';
import { computeTotals, computeDiscount, buildLineSignature } from '../utils/billTotals.js';
import { serializeDraftForRole } from '../utils/serializer.js';
import billingService from './billingService.js';
import auditService from './auditService.js';

export const discountService = {
  /**
   * Submits a discount request for an open bill draft (BRD APR-01).
   */
  async requestDiscount({
    storeId,
    draftId,
    actor,
    userRole = 'salesman',
    reason,
    requestedAmountPaise,
    requestedPercent,
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

      if (draft.status !== 'open' && draft.status !== 'draft') {
        throw new AppError('Discount can only be requested for open drafts', 400);
      }

      // Salesman can only request for their own draft
      if (userRole === 'salesman') {
        const ownerId = draft.createdBy?.id || draft.createdBy?._id?.toString();
        if (ownerId && ownerId !== actor._id.toString()) {
          throw new AppError('Not authorized to request discount for another staff member draft', 403);
        }
      }

      // Concurrency check
      if (expectedVersion !== undefined && draft.version !== Number(expectedVersion)) {
        throw new AppError('DRAFT_VERSION_MISMATCH', 409, {
          code: 'DRAFT_VERSION_MISMATCH',
          currentVersion: draft.version,
        });
      }

      // Check for unclear or missing items
      const matchedLines = (draft.lines || []).filter((l) => l.status === 'matched');
      const unclearLines = (draft.lines || []).filter((l) => l.status === 'unclear');
      if (unclearLines.length > 0) {
        throw new AppError('Cannot request discount for draft with unclear or unpriced items', 400);
      }
      if (matchedLines.length === 0) {
        throw new AppError('Cannot request discount for empty draft', 400);
      }

      // Check existing pending request
      const existingPending = await DiscountRequest.findOne({
        draftId: draft._id,
        status: 'pending',
      }).session(session);

      if (existingPending) {
        throw new AppError('A pending discount request already exists for this draft', 409, {
          code: 'PENDING_REQUEST_EXISTS',
        });
      }

      // Compute eligible value
      const eligibleValuePaise = matchedLines.reduce(
        (sum, l) => sum + (Number(l.amountPaise) || 0),
        0
      );
      if (eligibleValuePaise <= 0) {
        throw new AppError('Draft has no eligible value for discount', 400);
      }

      // Validate reason
      const trimmedReason = String(reason || '').trim();
      if (trimmedReason.length < 3 || trimmedReason.length > 500) {
        throw new AppError('Reason must be between 3 and 500 characters', 400);
      }

      // Validate requested amount or percent
      let reqAmountPaise = null;
      let reqPercent = null;

      if (requestedPercent !== undefined && requestedPercent !== null) {
        reqPercent = Number(requestedPercent);
        if (isNaN(reqPercent) || reqPercent <= 0 || reqPercent > 100) {
          throw new AppError('Discount percent must be between 0.01 and 100', 400);
        }
        reqAmountPaise = Math.round((eligibleValuePaise * reqPercent) / 100);
      } else if (requestedAmountPaise !== undefined && requestedAmountPaise !== null) {
        reqAmountPaise = Math.round(Number(requestedAmountPaise));
        if (isNaN(reqAmountPaise) || reqAmountPaise <= 0 || reqAmountPaise > eligibleValuePaise) {
          throw new AppError(
            `Discount amount cannot exceed eligible bill value of Rs ${toRupees(eligibleValuePaise)}`,
            400
          );
        }
        reqPercent = Math.round((reqAmountPaise / eligibleValuePaise) * 10000) / 100;
      } else {
        throw new AppError('Either requestedAmountPaise or requestedPercent must be provided', 400);
      }

      const lineSignatureAtRequest = buildLineSignature(draft);

      const [discountRequest] = await DiscountRequest.create(
        [
          {
            storeId: storeObjectId,
            draftId: draft._id,
            draftVersion: draft.version,
            requestedBy: actor._id,
            requestedAt: new Date(),
            requestedAmountPaise: reqAmountPaise,
            requestedPercent: reqPercent,
            reason: trimmedReason,
            status: 'pending',
            billTotalAtRequestPaise: draft.totalPaise || eligibleValuePaise,
            eligibleValuePaise,
            lineSignatureAtRequest,
          },
        ],
        { session }
      );

      draft.discountStatus = 'pending';
      draft.discountRequestId = discountRequest._id;
      draft.discountReason = trimmedReason;
      await draft.save({ session });

      await session.commitTransaction();

      await auditService.log({
        actor,
        storeId: storeObjectId,
        action: 'DISCOUNT_REQUESTED',
        entity: 'DiscountRequest',
        entityId: discountRequest._id,
        after: {
          draftId: draft._id,
          draftNumber: draft.draftNumber,
          requestedAmountPaise: reqAmountPaise,
          requestedPercent: reqPercent,
          reason: trimmedReason,
        },
      });

      const context = await billingService.buildValidationContext(storeObjectId, draft);
      const serialized = serializeDraftForRole(draft, userRole, context);

      return {
        success: true,
        message: 'Discount requested successfully',
        draft: serialized,
        request: discountRequest,
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
   * Cancels a pending discount request (BRD APR-01).
   */
  async cancelDiscount({ storeId, draftId, actor, userRole = 'salesman' }) {
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

      if (userRole === 'salesman') {
        const ownerId = draft.createdBy?.id || draft.createdBy?._id?.toString();
        if (ownerId && ownerId !== actor._id.toString()) {
          throw new AppError('Not authorized to cancel discount on this draft', 403);
        }
      }

      const request = await DiscountRequest.findOne({
        draftId: draft._id,
        status: 'pending',
      }).session(session);

      if (!request) {
        throw new AppError('No pending discount request found to cancel', 400);
      }

      request.status = 'cancelled';
      await request.save({ session });

      draft.discountStatus = 'none';
      draft.discountRequestId = null;
      draft.version = (draft.version || 1) + 1;
      await draft.save({ session });

      await session.commitTransaction();

      await auditService.log({
        actor,
        storeId: storeObjectId,
        action: 'DISCOUNT_CANCELLED',
        entity: 'DiscountRequest',
        entityId: request._id,
        reason: 'Staff cancelled request',
      });

      const context = await billingService.buildValidationContext(storeObjectId, draft);
      return {
        success: true,
        message: 'Discount request cancelled',
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
   * Lists discount requests for approvals page (admin only).
   */
  async listDiscountApprovals({ storeId, query = {} }) {
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
      DiscountRequest.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('requestedBy', 'name email role')
        .populate('decidedBy', 'name email role')
        .populate({
          path: 'draftId',
          select: 'draftNumber createdBy billType customer customerId walkIn lines totalPaise version status discountStatus',
        })
        .lean(),
      DiscountRequest.countDocuments(filter),
    ]);

    const data = requests.map((req) => {
      const d = req.draftId || {};
      const lines = d.lines || [];
      const customerName = d.customer?.name || d.walkIn?.name || 'Walk-in Customer';
      const customerMobile = d.customer?.mobile || d.walkIn?.mobile || '';

      return {
        id: req._id.toString(),
        _id: req._id.toString(),
        status: req.status,
        requestedAt: req.requestedAt,
        reason: req.reason,
        requestedAmount: toRupees(req.requestedAmountPaise),
        requestedAmountPaise: req.requestedAmountPaise,
        requestedPercent: req.requestedPercent,
        approvedAmount: req.approvedAmountPaise ? toRupees(req.approvedAmountPaise) : null,
        approvedAmountPaise: req.approvedAmountPaise,
        approvedPercent: req.approvedPercent,
        eligibleValue: toRupees(req.eligibleValuePaise),
        eligibleValuePaise: req.eligibleValuePaise,
        billTotalAtRequest: toRupees(req.billTotalAtRequestPaise),
        decidedAt: req.decidedAt,
        decidedBy: req.decidedBy
          ? { id: req.decidedBy._id, name: req.decidedBy.name, role: req.decidedBy.role }
          : null,
        decisionReason: req.decisionReason,
        draftSummary: {
          id: d._id ? d._id.toString() : null,
          draftNumber: d.draftNumber || '',
          billType: d.billType || 'cash',
          total: toRupees(d.totalPaise || req.billTotalAtRequestPaise),
          totalPaise: d.totalPaise || req.billTotalAtRequestPaise,
          lineCount: lines.length,
          owner: d.createdBy?.name || req.requestedBy?.name || 'Staff',
          customer: customerName,
          customerMobile,
          version: d.version || req.draftVersion,
          discountStatus: d.discountStatus || req.status,
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
   * Retrieves single discount approval detail with line-level pricing for admin (BRD Section 05).
   */
  async getDiscountApprovalById({ storeId, requestId }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const requestObjectId = new mongoose.Types.ObjectId(String(requestId));

    const req = await DiscountRequest.findOne(
      scopeToStore({ _id: requestObjectId }, storeObjectId)
    )
      .populate('requestedBy', 'name email role')
      .populate('decidedBy', 'name email role')
      .populate('draftId')
      .lean();

    if (!req) {
      throw new AppError('Discount request not found', 404);
    }

    const d = req.draftId || {};
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
        reason: req.reason,
        requestedAmount: toRupees(req.requestedAmountPaise),
        requestedAmountPaise: req.requestedAmountPaise,
        requestedPercent: req.requestedPercent,
        approvedAmount: req.approvedAmountPaise ? toRupees(req.approvedAmountPaise) : null,
        approvedAmountPaise: req.approvedAmountPaise,
        approvedPercent: req.approvedPercent,
        eligibleValue: toRupees(req.eligibleValuePaise),
        eligibleValuePaise: req.eligibleValuePaise,
        billTotalAtRequest: toRupees(req.billTotalAtRequestPaise),
        decidedAt: req.decidedAt,
        decidedBy: req.decidedBy
          ? { id: req.decidedBy._id, name: req.decidedBy.name, role: req.decidedBy.role }
          : null,
        decisionReason: req.decisionReason,
        draft: {
          id: d._id ? d._id.toString() : null,
          draftNumber: d.draftNumber,
          billType: d.billType,
          total: toRupees(d.totalPaise),
          totalPaise: d.totalPaise,
          customer: d.customer?.name || d.walkIn?.name || 'Walk-in Customer',
          customerMobile: d.customer?.mobile || d.walkIn?.mobile || '',
          version: d.version,
          discountStatus: d.discountStatus,
          lines,
        },
      },
    };
  },

  /**
   * Approves or rejects a discount request (BRD APR-02, APR-03).
   */
  async decideDiscount({
    storeId,
    requestId,
    actor,
    decision,
    approvedAmountPaise,
    approvedPercent,
    decisionReason,
  }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const requestObjectId = new mongoose.Types.ObjectId(String(requestId));

    if (!['approved', 'rejected'].includes(decision)) {
      throw new AppError('Decision must be either "approved" or "rejected"', 400);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const request = await DiscountRequest.findOne(
        scopeToStore({ _id: requestObjectId }, storeObjectId)
      ).session(session);

      if (!request) {
        throw new AppError('Discount request not found', 404);
      }

      const draft = await BillDraft.findOne(
        scopeToStore({ _id: request.draftId }, storeObjectId)
      ).session(session);

      if (!draft) {
        throw new AppError('Bill draft not found', 404);
      }

      // Check draft version mismatch or already auto-expired due to draft edit -> return 409 DRAFT_CHANGED (BRD APR-03)
      if (draft.version !== request.draftVersion || request.status === 'expired') {
        request.status = 'expired';
        await request.save({ session });

        draft.discountStatus = 'none';
        draft.discountRequestId = null;
        await draft.save({ session });

        await session.commitTransaction();

        throw new AppError('DRAFT_CHANGED', 409, {
          code: 'DRAFT_CHANGED',
          message: 'Draft has been modified since discount was requested',
        });
      }

      if (request.status !== 'pending') {
        throw new AppError('Discount request is no longer pending', 400);
      }

      if (decision === 'approved') {
        let valAmountPaise = null;
        let valPercent = null;

        if (approvedPercent !== undefined && approvedPercent !== null) {
          valPercent = Number(approvedPercent);
          if (isNaN(valPercent) || valPercent <= 0 || valPercent > 100) {
            throw new AppError('Approved percent must be between 0.01 and 100', 400);
          }
          valAmountPaise = Math.round((request.eligibleValuePaise * valPercent) / 100);
        } else if (approvedAmountPaise !== undefined && approvedAmountPaise !== null) {
          valAmountPaise = Math.round(Number(approvedAmountPaise));
          if (isNaN(valAmountPaise) || valAmountPaise <= 0 || valAmountPaise > request.eligibleValuePaise) {
            throw new AppError(
              `Approved amount cannot exceed eligible bill value of Rs ${toRupees(request.eligibleValuePaise)}`,
              400
            );
          }
          valPercent = Math.round((valAmountPaise / request.eligibleValuePaise) * 10000) / 100;
        } else {
          // Use original requested amount
          valAmountPaise = request.requestedAmountPaise;
          valPercent = request.requestedPercent;
        }

        const { discountPaise } = computeDiscount({
          lines: draft.lines,
          lineGrossPaise: request.eligibleValuePaise,
          discountAmountPaise: valAmountPaise,
        });

        draft.discountStatus = 'approved';
        draft.discountPaise = discountPaise;
        draft.discountApprovedPaise = discountPaise;
        draft.discountApprovedPercent = valPercent;
        draft.discountApprovedAt = new Date();
        draft.discountApprovedBy = actor._id;
        draft.version = (draft.version || 1) + 1;

        // Recompute draft totals with discount
        const valContext = await billingService.buildValidationContext(storeObjectId, draft, session);
        const computedTotals = computeTotals(draft.lines, valContext.config, discountPaise);
        draft.totalPaise = computedTotals.totalPaise;

        draft.discountApprovalSnapshot = {
          version: draft.version,
          billTotalPaise: computedTotals.totalPaise,
          lineSignature: buildLineSignature(draft),
        };

        await draft.save({ session });

        request.status = 'approved';
        request.decidedBy = actor._id;
        request.decidedAt = new Date();
        request.decisionReason = decisionReason ? decisionReason.trim() : null;
        request.approvedAmountPaise = discountPaise;
        request.approvedPercent = valPercent;
        await request.save({ session });

        await session.commitTransaction();

        await auditService.log({
          actor,
          storeId: storeObjectId,
          action: 'DISCOUNT_APPROVED',
          entity: 'DiscountRequest',
          entityId: request._id,
          after: {
            approvedAmountPaise: discountPaise,
            approvedPercent: valPercent,
            billTotalPaise: draft.totalPaise,
          },
        });
      } else {
        // Rejected path
        const reasonTrimmed = String(decisionReason || '').trim();
        if (!reasonTrimmed) {
          throw new AppError('Decision reason is required when rejecting a discount', 400);
        }

        draft.discountStatus = 'rejected';
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
          action: 'DISCOUNT_REJECTED',
          entity: 'DiscountRequest',
          entityId: request._id,
          reason: reasonTrimmed,
        });
      }

      const context = await billingService.buildValidationContext(storeObjectId, draft);
      return {
        success: true,
        message: `Discount request ${decision}`,
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
   * Returns count of pending discount approvals for store badge (admin only).
   */
  async getPendingCount({ storeId }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const count = await DiscountRequest.countDocuments(
      scopeToStore({ status: 'pending' }, storeObjectId)
    );
    return { success: true, count };
  },
};

export default discountService;
