import mongoose from 'mongoose';
import StockMovement from '../models/StockMovement.js';
import Item from '../models/Item.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import auditService from './auditService.js';

/**
 * Stock Service - Business Logic for Stock Balances and Append-Only Movements.
 * Every function accepts storeId and actor explicitly, with an optional Mongoose session.
 * Every DB query is scoped to storeId.
 */
export const stockService = {
  /**
   * Calculates current stock balance for a single item via aggregation: SUM(quantityBase).
   * @param {string|ObjectId} storeId
   * @param {string|ObjectId} itemId
   * @param {ClientSession} [session]
   * @returns {Promise<number>} Current quantity in base units
   */
  async getStockBalance(storeId, itemId, session = null) {
    const itemObjectId = new mongoose.Types.ObjectId(String(itemId));
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

    const pipeline = [
      {
        $match: {
          storeId: storeObjectId,
          itemId: itemObjectId,
        },
      },
      {
        $group: {
          _id: '$itemId',
          balance: { $sum: '$quantityBase' },
        },
      },
    ];

    const result = await StockMovement.aggregate(pipeline).session(session || null);
    return result.length > 0 ? result[0].balance : 0;
  },

  /**
   * Batch calculates stock balances for multiple items.
   * @param {string|ObjectId} storeId
   * @param {Array<string|ObjectId>} itemIds
   * @param {ClientSession} [session]
   * @returns {Promise<Record<string, number>>} Map of itemId -> balance
   */
  async getStockBalances(storeId, itemIds, session = null) {
    if (!itemIds || itemIds.length === 0) return {};

    const objectIds = itemIds.map((id) => new mongoose.Types.ObjectId(String(id)));
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

    const pipeline = [
      {
        $match: {
          storeId: storeObjectId,
          itemId: { $in: objectIds },
        },
      },
      {
        $group: {
          _id: '$itemId',
          balance: { $sum: '$quantityBase' },
        },
      },
    ];

    const results = await StockMovement.aggregate(pipeline).session(session || null);
    const balanceMap = {};

    // Initialize all requested items to 0
    for (const id of itemIds) {
      balanceMap[String(id)] = 0;
    }

    for (const row of results) {
      balanceMap[String(row._id)] = row.balance;
    }

    return balanceMap;
  },

  /**
   * Posts opening stock.
   * RULE: Only ONE opening stock entry per item per store. Corrections must use adjustments.
   */
  async postOpeningStock({ storeId, actor, itemId, quantity, effectiveDate, reference, session = null }) {
    // 1. Verify item exists and belongs to the store
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    // 2. Quantity validation
    const qty = Number(quantity);
    if (isNaN(qty) || qty < 0) {
      throw new AppError('Opening stock quantity cannot be negative', 400);
    }

    // 3. Ensure no prior OPENING stock movement exists for this item in this store
    const existingOpening = await StockMovement.findOne(
      scopeToStore({ itemId, type: 'OPENING' }, storeId)
    ).session(session || null);

    if (existingOpening) {
      throw new AppError(
        'Opening stock already recorded for this item. Use stock adjustment for subsequent corrections.',
        400
      );
    }

    // 4. Create append-only StockMovement
    const movement = new StockMovement({
      storeId,
      itemId,
      type: 'OPENING',
      quantityBase: qty,
      effectiveDate: effectiveDate || new Date(),
      reference: reference || 'Initial Opening Stock',
      reason: 'Opening stock entry',
      createdBy: actor,
    });

    await movement.save({ session: session || undefined });

    // 5. Audit entry
    await auditService.log({
      actor,
      storeId,
      action: 'STOCK_OPENING',
      entity: 'Item',
      entityId: itemId,
      after: { quantityBase: qty, movementId: movement._id },
      reason: reference || 'Opening stock established',
    });

    const newBalance = await this.getStockBalance(storeId, itemId, session);

    return {
      movement,
      currentBalance: newBalance,
    };
  },

  /**
   * Posts an adjustment (+/-).
   * RULE: Reason is mandatory.
   * RULE: Must not make balance negative unless config flag allows it (default: block).
   */
  async postAdjustment({
    storeId,
    actor,
    itemId,
    quantity,
    reason,
    reference,
    effectiveDate,
    allowNegative = false,
    session = null,
  }) {
    if (!reason || !reason.trim()) {
      throw new AppError('Reason is mandatory for stock adjustment', 400);
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty === 0) {
      throw new AppError('Adjustment quantity must be a non-zero number', 400);
    }

    // Verify item belongs to store
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    // Check balance if reducing stock
    const currentBalance = await this.getStockBalance(storeId, itemId, session);
    const projectedBalance = currentBalance + qty;

    if (projectedBalance < 0 && !allowNegative) {
      throw new AppError(
        `Adjustment would result in negative stock balance (${projectedBalance}). Current balance: ${currentBalance}.`,
        400
      );
    }

    // Create append-only StockMovement
    const movement = new StockMovement({
      storeId,
      itemId,
      type: 'ADJUSTMENT',
      quantityBase: qty,
      effectiveDate: effectiveDate || new Date(),
      reference: reference || 'Stock Adjustment',
      reason: reason.trim(),
      createdBy: actor,
    });

    await movement.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'STOCK_ADJUSTMENT',
      entity: 'Item',
      entityId: itemId,
      before: { balance: currentBalance },
      after: { adjustment: qty, balance: projectedBalance, movementId: movement._id },
      reason: reason.trim(),
    });

    return {
      movement,
      currentBalance: projectedBalance,
    };
  },

  /**
   * Retrieves chronological stock movements for an item in a store.
   */
  async getStockMovements({ storeId, itemId, session = null }) {
    return StockMovement.find(scopeToStore({ itemId }, storeId))
      .sort({ createdAt: -1 })
      .session(session || null);
  },
};

export default stockService;

