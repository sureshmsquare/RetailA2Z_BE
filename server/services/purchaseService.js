import mongoose from 'mongoose';
import Purchase, { computeInvoiceKey } from '../models/Purchase.js';
import Supplier from '../models/Supplier.js';
import Item from '../models/Item.js';
import Store from '../models/Store.js';
import StockMovement from '../models/StockMovement.js';
import Counter, { PURCHASE_NO_COUNTER_KEY } from '../models/Counter.js';
import stockService from './stockService.js';
import auditService from './auditService.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toPaise, toRupees } from '../utils/money.js';
import { computeLineAmount, computePurchaseTotal } from '../utils/purchaseTotals.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a given date is in the future based on the store's timezone (default: Asia/Kolkata).
 */
export function isDateInFuture(dateInput, timezone = 'Asia/Kolkata') {
  if (!dateInput) return false;
  const inputDate = new Date(dateInput);
  if (isNaN(inputDate.getTime())) return false;

  const now = new Date();
  const tz = timezone || 'Asia/Kolkata';

  let todayStr;
  let inputStr;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    todayStr = formatter.format(now);
    inputStr = formatter.format(inputDate);
  } catch {
    // Fallback if timezone string is invalid
    todayStr = now.toISOString().slice(0, 10);
    inputStr = inputDate.toISOString().slice(0, 10);
  }

  return inputStr > todayStr;
}

/**
 * Atomically increments the purchase sequence counter for a store.
 */
async function incrementPurchaseNoCounter(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: PURCHASE_NO_COUNTER_KEY }, storeObjectId);

  let counter = await Counter.findOneAndUpdate(
    filter,
    { $inc: { seq: 1 } },
    { new: true, session: session || undefined }
  );
  if (counter) {
    return counter.seq;
  }

  try {
    await Counter.updateOne(
      filter,
      {
        $setOnInsert: {
          storeId: storeObjectId,
          key: PURCHASE_NO_COUNTER_KEY,
          seq: 0,
        },
      },
      { upsert: true, session: session || undefined }
    );
  } catch (err) {
    if (!err || err.code !== 11000) {
      throw err;
    }
  }

  counter = await Counter.findOneAndUpdate(
    filter,
    { $inc: { seq: 1 } },
    { new: true, session: session || undefined }
  );
  return counter.seq;
}

/**
 * Formats a purchase document for API responses, including rupees conversions.
 */
export function formatPurchase(doc, movements = null) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  obj.totalRupees = toRupees(obj.totalPaise);
  obj.total = obj.totalRupees;

  if (Array.isArray(obj.lines)) {
    obj.lines = obj.lines.map((l) => {
      const lineObj = { ...l };
      lineObj.id = String(lineObj._id || lineObj.lineId);
      lineObj.cost = toRupees(lineObj.costPaise);
      lineObj.costRupees = lineObj.cost;
      lineObj.amount = toRupees(lineObj.amountPaise);
      lineObj.amountRupees = lineObj.amount;
      return lineObj;
    });
    obj.lineCount = obj.lines.length;
  } else {
    obj.lineCount = 0;
  }

  if (obj.supplierId && typeof obj.supplierId === 'object' && obj.supplierId.name) {
    obj.supplierName = obj.supplierId.name;
    obj.supplier = {
      id: String(obj.supplierId._id || obj.supplierId.id),
      name: obj.supplierId.name,
      contactPerson: obj.supplierId.contactPerson || null,
      mobile: obj.supplierId.mobile || null,
      city: obj.supplierId.address?.city || null,
    };
  }

  if (movements) {
    obj.movements = movements.map((m) => ({
      ...m,
      id: String(m._id),
    }));
  }

  return obj;
}

/**
 * Validates and processes line items against items in the database.
 */
async function processPurchaseLines({ storeId, rawLines = [], session = null }) {
  if (!Array.isArray(rawLines)) {
    throw new AppError('Lines must be an array', 400);
  }

  const processed = [];

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    if (!rawLine.itemId) {
      throw new AppError(`Line ${i + 1}: Item is required`, 400);
    }

    if (!mongoose.Types.ObjectId.isValid(String(rawLine.itemId))) {
      throw new AppError(`Line ${i + 1}: Invalid item ID`, 400);
    }

    const item = await Item.findOne(
      scopeToStore({ _id: rawLine.itemId }, storeId)
    ).session(session || null);

    if (!item) {
      throw new AppError(`Line ${i + 1}: Item not found in this store`, 400);
    }

    if (item.status === 'inactive') {
      throw new AppError(`Line ${i + 1}: Item "${item.name}" is inactive`, 400);
    }

    const qty = Number(rawLine.quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new AppError(`Line ${i + 1}: Quantity must be greater than 0`, 400);
    }
    const cleanQty = Number(qty.toFixed(3));

    // Support both cost (in rupees) and costPaise (in paise)
    let costPaise = 0;
    if (rawLine.costPaise !== undefined && rawLine.costPaise !== null) {
      costPaise = Number(rawLine.costPaise);
    } else if (rawLine.cost !== undefined && rawLine.cost !== null) {
      costPaise = toPaise(rawLine.cost);
    }
    if (isNaN(costPaise) || costPaise < 0) {
      throw new AppError(`Line ${i + 1}: Cost cannot be negative`, 400);
    }

    const unitType = rawLine.unitType === 'PACK' ? 'PACK' : 'UNIT';
    const unitsPerPack = Number(item.unitsPerPack) || 1;

    let quantityBase = cleanQty;
    let unitLabel = item.sellingUnit || 'UNIT';

    if (unitType === 'PACK') {
      quantityBase = Number((cleanQty * unitsPerPack).toFixed(3));
      unitLabel = unitsPerPack > 1 ? `Pack of ${unitsPerPack}` : 'PACK';
    }

    const amountPaise = computeLineAmount({ quantity: cleanQty, costPaise });

    processed.push({
      lineId: rawLine.lineId || new mongoose.Types.ObjectId(),
      itemId: item._id,
      productCode: item.productCode,
      itemName: item.name,
      unitType,
      unitsPerPack,
      quantity: cleanQty,
      quantityBase,
      unitLabel,
      costPaise,
      amountPaise,
    });
  }

  return processed;
}

export const purchaseService = {
  /**
   * Creates a new draft purchase.
   * Saving a draft NEVER creates any StockMovement.
   */
  async createDraft({ storeId, actor, purchaseData = {}, session = null }) {
    if (!purchaseData.supplierId) {
      throw new AppError('Supplier is required', 400);
    }
    if (!mongoose.Types.ObjectId.isValid(String(purchaseData.supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }

    // Verify supplier exists and is active in this store
    const supplier = await Supplier.findOne(
      scopeToStore({ _id: purchaseData.supplierId }, storeId)
    ).session(session || null);

    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }
    if (!supplier.isActive) {
      throw new AppError('Supplier is inactive', 400);
    }

    // Load store to inspect timezone
    const store = await Store.findById(storeId).session(session || null);
    const storeTimezone = store?.timezone || 'Asia/Kolkata';

    // Received date validation
    let receivedDate = null;
    if (purchaseData.receivedDate) {
      receivedDate = new Date(purchaseData.receivedDate);
      if (isNaN(receivedDate.getTime())) {
        throw new AppError('Invalid received date format', 400);
      }
      if (isDateInFuture(receivedDate, storeTimezone)) {
        throw new AppError('Received date cannot be in the future', 400);
      }
    }

    // Supplier invoice duplicate check
    const supplierInvoiceNo = purchaseData.supplierInvoiceNo ? String(purchaseData.supplierInvoiceNo).trim() : '';
    const invoiceKey = computeInvoiceKey(supplierInvoiceNo);

    if (invoiceKey) {
      const existing = await Purchase.findOne(
        scopeToStore(
          {
            supplierId: supplier._id,
            invoiceKey,
            status: { $in: ['draft', 'posted'] },
          },
          storeId
        )
      ).session(session || null);

      if (existing) {
        const ref = existing.purchaseNumber || existing._id;
        throw new AppError(`This supplier invoice number is already used by purchase ${ref}`, 409);
      }
    }

    // Process lines (drafts may have 0 lines)
    const lines = await processPurchaseLines({
      storeId,
      rawLines: purchaseData.lines || [],
      session,
    });

    const totalPaise = computePurchaseTotal(lines);

    const purchase = new Purchase({
      storeId,
      supplierId: supplier._id,
      supplierInvoiceNo,
      invoiceKey,
      receivedDate,
      notes: purchaseData.notes ? String(purchaseData.notes).trim() : '',
      status: 'draft',
      lines,
      totalPaise,
      createdBy: actor,
      updatedBy: actor,
    });

    try {
      await purchase.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('This supplier invoice number is already used by another purchase', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'PURCHASE_DRAFT_CREATE',
      entity: 'Purchase',
      entityId: purchase._id,
      after: purchase.toObject(),
      reason: 'Draft purchase created',
    });

    const populated = await Purchase.findById(purchase._id)
      .populate('supplierId', 'name contactPerson mobile address gstin')
      .session(session || null);

    return formatPurchase(populated || purchase);
  },

  /**
   * Replaces an existing draft purchase (header + lines).
   * Only purchases in 'draft' status can be edited.
   */
  async updateDraft({ storeId, actor, purchaseId, updateData = {}, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(purchaseId))) {
      throw new AppError('Invalid purchase ID format', 400);
    }

    const purchase = await Purchase.findOne(
      scopeToStore({ _id: purchaseId }, storeId)
    ).session(session || null);

    if (!purchase) {
      throw new AppError('Purchase not found in this store', 404);
    }

    if (purchase.status !== 'draft') {
      throw new AppError('Only draft purchases can be edited', 400);
    }

    // Validate supplier
    const supplierId = updateData.supplierId || purchase.supplierId;
    if (!mongoose.Types.ObjectId.isValid(String(supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }

    const supplier = await Supplier.findOne(
      scopeToStore({ _id: supplierId }, storeId)
    ).session(session || null);

    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }
    if (!supplier.isActive) {
      throw new AppError('Supplier is inactive', 400);
    }

    // Inspect timezone
    const store = await Store.findById(storeId).session(session || null);
    const storeTimezone = store?.timezone || 'Asia/Kolkata';

    let receivedDate = purchase.receivedDate;
    if (updateData.receivedDate !== undefined) {
      if (updateData.receivedDate) {
        receivedDate = new Date(updateData.receivedDate);
        if (isNaN(receivedDate.getTime())) {
          throw new AppError('Invalid received date format', 400);
        }
        if (isDateInFuture(receivedDate, storeTimezone)) {
          throw new AppError('Received date cannot be in the future', 400);
        }
      } else {
        receivedDate = null;
      }
    }

    const supplierInvoiceNo =
      updateData.supplierInvoiceNo !== undefined
        ? String(updateData.supplierInvoiceNo).trim()
        : purchase.supplierInvoiceNo;
    const invoiceKey = computeInvoiceKey(supplierInvoiceNo);

    if (invoiceKey) {
      const existing = await Purchase.findOne(
        scopeToStore(
          {
            supplierId: supplier._id,
            invoiceKey,
            status: { $in: ['draft', 'posted'] },
            _id: { $ne: purchase._id },
          },
          storeId
        )
      ).session(session || null);

      if (existing) {
        const ref = existing.purchaseNumber || existing._id;
        throw new AppError(`This supplier invoice number is already used by purchase ${ref}`, 409);
      }
    }

    const lines = await processPurchaseLines({
      storeId,
      rawLines: updateData.lines !== undefined ? updateData.lines : purchase.lines,
      session,
    });

    const totalPaise = computePurchaseTotal(lines);

    const beforeState = purchase.toObject();

    purchase.supplierId = supplier._id;
    purchase.supplierInvoiceNo = supplierInvoiceNo;
    purchase.invoiceKey = invoiceKey;
    purchase.receivedDate = receivedDate;
    if (updateData.notes !== undefined) {
      purchase.notes = String(updateData.notes).trim();
    }
    purchase.lines = lines;
    purchase.totalPaise = totalPaise;
    purchase.updatedBy = actor;

    try {
      await purchase.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('This supplier invoice number is already used by another purchase', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'PURCHASE_DRAFT_UPDATE',
      entity: 'Purchase',
      entityId: purchase._id,
      before: beforeState,
      after: purchase.toObject(),
      reason: 'Draft purchase updated',
    });

    const populated = await Purchase.findById(purchase._id)
      .populate('supplierId', 'name contactPerson mobile address gstin')
      .session(session || null);

    return formatPurchase(populated || purchase);
  },

  /**
   * Posts a purchase within a single Mongoose transaction.
   * Atomically claims the draft, assigns purchaseNumber, and creates StockMovements.
   */
  async postPurchase({ storeId, purchaseId, idempotencyKey, actor }) {
    if (!idempotencyKey || !String(idempotencyKey).trim()) {
      throw new AppError('Idempotency-Key header is required for posting', 400);
    }
    const cleanIdempotency = String(idempotencyKey).trim();

    if (!mongoose.Types.ObjectId.isValid(String(purchaseId))) {
      throw new AppError('Invalid purchase ID format', 400);
    }

    // Initial check outside transaction
    const initialPurchase = await Purchase.findOne(
      scopeToStore({ _id: purchaseId }, storeId)
    ).populate('supplierId', 'name contactPerson mobile address gstin');

    if (!initialPurchase) {
      throw new AppError('Purchase not found in this store', 404);
    }

    if (initialPurchase.status === 'posted') {
      if (initialPurchase.postIdempotencyKey === cleanIdempotency) {
        return formatPurchase(initialPurchase);
      }
      throw new AppError('Purchase is already posted', 409);
    }

    if (initialPurchase.status === 'cancelled') {
      throw new AppError('Cannot post a cancelled purchase', 409);
    }

    // Posting validation requirements
    if (!initialPurchase.supplierInvoiceNo || !initialPurchase.supplierInvoiceNo.trim()) {
      throw new AppError('Supplier invoice number is required to post purchase', 400);
    }

    if (!initialPurchase.receivedDate) {
      throw new AppError('Received date is required to post purchase', 400);
    }

    const store = await Store.findById(storeId);
    const storeTimezone = store?.timezone || 'Asia/Kolkata';
    if (isDateInFuture(initialPurchase.receivedDate, storeTimezone)) {
      throw new AppError('Received date cannot be in the future', 400);
    }

    if (!initialPurchase.lines || initialPurchase.lines.length === 0) {
      throw new AppError('At least one line item is required to post purchase', 400);
    }

    // Validate supplier is active
    const supplier = await Supplier.findOne(
      scopeToStore({ _id: initialPurchase.supplierId }, storeId)
    );
    if (!supplier || !supplier.isActive) {
      throw new AppError('Supplier is inactive or not found', 400);
    }

    // Validate all items are still active or draft
    const itemIds = initialPurchase.lines.map((l) => l.itemId);
    const items = await Item.find(scopeToStore({ _id: { $in: itemIds } }, storeId));
    if (items.length !== itemIds.length) {
      throw new AppError('One or more items in the purchase were not found', 400);
    }
    for (const item of items) {
      if (item.status === 'inactive') {
        throw new AppError(`Item "${item.name}" is inactive`, 400);
      }
    }

    // Ensure database supports transactions
    const isReplicaSet = Boolean(mongoose.connection?.client?.topology?.description?.setName);
    if (!isReplicaSet) {
      throw new AppError('Transactions are not available: MongoDB must run as a replica set', 500);
    }

    const session = await mongoose.startSession();
    let finalPostedDoc = null;

    try {
      await session.withTransaction(async () => {
        // Atomically claim the draft
        const claimed = await Purchase.findOneAndUpdate(
          scopeToStore({ _id: purchaseId, status: 'draft' }, storeId),
          {
            $set: {
              status: 'posted',
              postedAt: new Date(),
              postedBy: actor,
              postIdempotencyKey: cleanIdempotency,
              updatedBy: actor,
            },
          },
          { new: true, session }
        );

        if (!claimed) {
          // Concurrent post attempt
          const current = await Purchase.findOne(
            scopeToStore({ _id: purchaseId }, storeId)
          ).session(session);

          if (current && current.status === 'posted') {
            if (current.postIdempotencyKey === cleanIdempotency) {
              finalPostedDoc = current;
              return;
            }
            throw new AppError('Purchase is already posted', 409);
          }
          throw new AppError('Concurrent modification or invalid state on purchase', 409);
        }

        // Assign purchaseNumber from per-store Counter (PUR-000001)
        const seq = await incrementPurchaseNoCounter(storeId, session);
        const purchaseNumber = `PUR-${String(seq).padStart(6, '0')}`;
        claimed.purchaseNumber = purchaseNumber;
        await claimed.save({ session });

        // Create one StockMovement per line
        for (const line of claimed.lines) {
          const movement = new StockMovement({
            storeId,
            itemId: line.itemId,
            type: 'PURCHASE',
            quantityBase: line.quantityBase,
            effectiveDate: claimed.receivedDate,
            reference: `${claimed.purchaseNumber} / ${claimed.supplierInvoiceNo}`,
            reason: `Purchase receipt ${claimed.purchaseNumber}`,
            sourceType: 'Purchase',
            sourceId: claimed._id,
            sourceLineId: line.lineId || line._id,
            createdBy: actor,
            createdAt: new Date(),
          });
          await movement.save({ session });
        }

        // Write audit entry
        await auditService.log({
          actor,
          storeId,
          action: 'PURCHASE_POST',
          entity: 'Purchase',
          entityId: claimed._id,
          after: claimed.toObject(),
          reason: `Purchase ${claimed.purchaseNumber} posted`,
        });

        finalPostedDoc = claimed;
      });
    } finally {
      await session.endSession();
    }

    const populated = await Purchase.findById(finalPostedDoc._id)
      .populate('supplierId', 'name contactPerson mobile address gstin');

    return formatPurchase(populated || finalPostedDoc);
  },

  /**
   * Cancels a posted purchase within a single transaction.
   * Creates reverse StockMovements for all lines.
   * Aborts if cancelling would cause any item's stock balance to become negative.
   */
  async cancelPurchase({ storeId, purchaseId, reason, actor }) {
    if (!reason || String(reason).trim().length < 5) {
      throw new AppError('Cancel reason is mandatory (minimum 5 characters)', 400);
    }
    const cleanReason = String(reason).trim();

    if (!mongoose.Types.ObjectId.isValid(String(purchaseId))) {
      throw new AppError('Invalid purchase ID format', 400);
    }

    const purchase = await Purchase.findOne(
      scopeToStore({ _id: purchaseId }, storeId)
    );

    if (!purchase) {
      throw new AppError('Purchase not found in this store', 404);
    }

    if (purchase.status === 'draft') {
      throw new AppError('Only posted purchases can be cancelled', 400);
    }

    if (purchase.status === 'cancelled') {
      throw new AppError('Purchase is already cancelled', 409);
    }

    const isReplicaSet = Boolean(mongoose.connection?.client?.topology?.description?.setName);
    if (!isReplicaSet) {
      throw new AppError('Transactions are not available: MongoDB must run as a replica set', 500);
    }

    const session = await mongoose.startSession();
    let finalCancelledDoc = null;

    try {
      await session.withTransaction(async () => {
        // Load original movements
        const originalMovements = await StockMovement.find(
          scopeToStore({ sourceId: purchase._id, sourceType: 'Purchase' }, storeId)
        ).session(session);

        // Group required deductions per item
        const requiredDeductions = new Map();
        for (const mov of originalMovements) {
          const key = String(mov.itemId);
          const current = requiredDeductions.get(key) || 0;
          requiredDeductions.set(key, current + mov.quantityBase);
        }

        // Verify stock balance for each item will not become negative
        for (const [itemIdStr, deductQty] of requiredDeductions.entries()) {
          const currentBalance = await stockService.getStockBalance(storeId, itemIdStr, session);
          if (currentBalance - deductQty < 0) {
            const item = await Item.findById(itemIdStr).session(session);
            throw new AppError(
              `Cannot cancel: stock of ${item?.name || 'item'} would become negative`,
              409
            );
          }
        }

        // Create reversal movements
        for (const orig of originalMovements) {
          const reversal = new StockMovement({
            storeId,
            itemId: orig.itemId,
            type: 'PURCHASE',
            quantityBase: -orig.quantityBase,
            effectiveDate: new Date(),
            reference: `${purchase.purchaseNumber} cancelled`,
            reason: cleanReason,
            sourceType: 'PurchaseCancel',
            sourceId: purchase._id,
            sourceLineId: orig.sourceLineId,
            reversalOfMovementId: orig._id,
            createdBy: actor,
            createdAt: new Date(),
          });
          await reversal.save({ session });
        }

        // Set status cancelled
        purchase.status = 'cancelled';
        purchase.cancelledAt = new Date();
        purchase.cancelledBy = actor;
        purchase.cancelReason = cleanReason;
        purchase.updatedBy = actor;

        await purchase.save({ session });

        await auditService.log({
          actor,
          storeId,
          action: 'PURCHASE_CANCEL',
          entity: 'Purchase',
          entityId: purchase._id,
          reason: cleanReason,
        });

        finalCancelledDoc = purchase;
      });
    } finally {
      await session.endSession();
    }

    const populated = await Purchase.findById(finalCancelledDoc._id)
      .populate('supplierId', 'name contactPerson mobile address gstin');

    return formatPurchase(populated || finalCancelledDoc);
  },

  /**
   * Deletes a draft purchase.
   * Only purchases in 'draft' status can be deleted.
   */
  async deleteDraft({ storeId, purchaseId, actor, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(purchaseId))) {
      throw new AppError('Invalid purchase ID format', 400);
    }

    const purchase = await Purchase.findOne(
      scopeToStore({ _id: purchaseId }, storeId)
    ).session(session || null);

    if (!purchase) {
      throw new AppError('Purchase not found in this store', 404);
    }

    if (purchase.status !== 'draft') {
      throw new AppError('Only draft purchases can be deleted', 400);
    }

    const beforeState = purchase.toObject();

    await Purchase.deleteOne(scopeToStore({ _id: purchaseId }, storeId)).session(session || null);

    await auditService.log({
      actor,
      storeId,
      action: 'PURCHASE_DRAFT_DELETE',
      entity: 'Purchase',
      entityId: purchase._id,
      before: beforeState,
      reason: 'Draft purchase deleted',
    });

    return {
      id: String(purchase._id),
      message: 'Draft purchase deleted successfully',
    };
  },

  /**
   * Lists purchases for a store with filtering, pagination, and sorting.
   */
  async listPurchases({ storeId, filters = {}, pagination = {}, session = null }) {
    const query = {};

    if (filters.supplierId && String(filters.supplierId).trim()) {
      if (mongoose.Types.ObjectId.isValid(String(filters.supplierId).trim())) {
        query.supplierId = new mongoose.Types.ObjectId(String(filters.supplierId).trim());
      }
    }

    if (filters.status && ['draft', 'posted', 'cancelled'].includes(filters.status)) {
      query.status = filters.status;
    }

    if (filters.fromDate || filters.toDate) {
      query.receivedDate = {};
      if (filters.fromDate) {
        query.receivedDate.$gte = new Date(filters.fromDate);
      }
      if (filters.toDate) {
        query.receivedDate.$lte = new Date(filters.toDate);
      }
    }

    if (filters.search && String(filters.search).trim()) {
      const term = escapeRegex(String(filters.search).trim());
      const regex = new RegExp(term, 'i');
      query.$or = [{ purchaseNumber: regex }, { supplierInvoiceNo: regex }];
    }

    const scopedQuery = scopeToStore(query, storeId);

    const page = Math.max(1, parseInt(pagination.page || filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pagination.limit || filters.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [purchases, total] = await Promise.all([
      Purchase.find(scopedQuery)
        .populate('supplierId', 'name contactPerson mobile address gstin')
        .sort({ receivedDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .session(session || null),
      Purchase.countDocuments(scopedQuery).session(session || null),
    ]);

    const formatted = purchases.map((p) => formatPurchase(p));

    return {
      purchases: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  /**
   * Retrieves full details of a single purchase, including movements if posted/cancelled.
   */
  async getPurchase({ storeId, purchaseId, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(purchaseId))) {
      throw new AppError('Invalid purchase ID format', 400);
    }

    const purchase = await Purchase.findOne(
      scopeToStore({ _id: purchaseId }, storeId)
    )
      .populate('supplierId', 'name contactPerson mobile address gstin')
      .session(session || null);

    if (!purchase) {
      throw new AppError('Purchase not found in this store', 404);
    }

    let movements = null;
    if (purchase.status === 'posted' || purchase.status === 'cancelled') {
      movements = await StockMovement.find(
        scopeToStore({ sourceId: purchase._id }, storeId)
      )
        .sort({ createdAt: 1 })
        .session(session || null)
        .lean();
    }

    return formatPurchase(purchase, movements);
  },
};

export default purchaseService;

