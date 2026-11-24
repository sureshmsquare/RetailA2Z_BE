import mongoose from 'mongoose';
import Item from '../models/Item.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import Counter, { ITEM_CODE_COUNTER_KEY, ITEM_CODE_START_SEQ } from '../models/Counter.js';
import PriceHistory from '../models/PriceHistory.js';
import StockMovement from '../models/StockMovement.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toPaise, toRupees } from '../utils/money.js';
import auditService from './auditService.js';
import stockService from './stockService.js';

const MAX_CODE_GEN_ATTEMPTS = 20;

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats a numeric sequence into an 8-digit zero-padded string (e.g. "10000001").
 */
function formatItemCodeSeq(seq) {
  return String(seq).padStart(8, '0');
}

/**
 * Atomically increments the store's "itemCode" counter starting from ITEM_CODE_START_SEQ (10000000),
 * so the first value returned is 10000001. Race-safe on concurrent first-time initialization.
 */
async function incrementItemCodeCounter(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: ITEM_CODE_COUNTER_KEY }, storeObjectId);

  // Fast path: counter already exists -> single atomic $inc
  let counter = await Counter.findOneAndUpdate(
    filter,
    { $inc: { seq: 1 } },
    { new: true, session: session || undefined }
  );
  if (counter) {
    return counter.seq;
  }

  // First-time initialization: seed base seq = 10000000 via $setOnInsert upsert (race-safe)
  try {
    await Counter.updateOne(
      filter,
      {
        $setOnInsert: {
          storeId: storeObjectId,
          key: ITEM_CODE_COUNTER_KEY,
          seq: ITEM_CODE_START_SEQ,
        },
      },
      { upsert: true, session: session || undefined }
    );
  } catch (err) {
    // Duplicate key (11000) means another concurrent request just seeded the counter; retry $inc safely
    if (!err || err.code !== 11000) {
      throw err;
    }
  }

  // Counter is now guaranteed to exist -> atomically increment by 1
  counter = await Counter.findOneAndUpdate(
    filter,
    { $inc: { seq: 1 } },
    { new: true, session: session || undefined }
  );
  return counter.seq;
}

/**
 * Validates that a categoryId exists in the same store and is active.
 * Returns the Category document, or null if categoryId is empty/null.
 * Throws AppError 400 "Invalid category" otherwise.
 */
async function resolveActiveCategory({ storeId, categoryId, session = null }) {
  if (categoryId === null || categoryId === undefined || categoryId === '') {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
    throw new AppError('Invalid category', 400);
  }

  const category = await Category.findOne(
    scopeToStore({ _id: categoryId, isActive: true }, storeId)
  ).session(session || null);

  if (!category) {
    throw new AppError('Invalid category', 400);
  }

  return category;
}

/**
 * Validates that a brandId exists in the same store and is active.
 * Returns the Brand document, or null if brandId is empty/null.
 * Throws AppError 400 "Invalid brand" otherwise.
 */
async function resolveActiveBrand({ storeId, brandId, session = null }) {
  if (brandId === null || brandId === undefined || brandId === '') {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(String(brandId))) {
    throw new AppError('Invalid brand', 400);
  }

  const brand = await Brand.findOne(
    scopeToStore({ _id: brandId, isActive: true }, storeId)
  ).session(session || null);

  if (!brand) {
    throw new AppError('Invalid brand', 400);
  }

  return brand;
}

/**
 * Format item doc to expose rupees, category { id, name }, brand { id, name }, and standard API fields.
 */
function formatItemForResponse(itemDoc, stockBalance = null, categoryDoc = null, brandDoc = null) {
  if (!itemDoc) return null;
  const obj = itemDoc.toObject ? itemDoc.toObject() : { ...itemDoc };

  obj.sellingPrice = toRupees(obj.sellingPricePaise);
  obj.mrp = toRupees(obj.mrpPaise);
  obj.codeSource = obj.codeSource || 'manual';

  // Format category as { id, name } (or null if unset) and keep categoryId as ID
  if (obj.categoryId && typeof obj.categoryId === 'object' && obj.categoryId._id) {
    obj.category = {
      id: String(obj.categoryId._id),
      name: obj.categoryId.name,
    };
    obj.categoryId = obj.categoryId._id;
  } else if (categoryDoc && categoryDoc._id) {
    obj.category = {
      id: String(categoryDoc._id),
      name: categoryDoc.name,
    };
    obj.categoryId = categoryDoc._id;
  } else {
    obj.category = null;
    obj.categoryId = obj.categoryId || null;
  }

  // Format brand as { id, name } (or null if unset) and keep brandId as ID
  if (obj.brandId && typeof obj.brandId === 'object' && obj.brandId._id) {
    obj.brand = {
      id: String(obj.brandId._id),
      name: obj.brandId.name,
    };
    obj.brandId = obj.brandId._id;
  } else if (brandDoc && brandDoc._id) {
    obj.brand = {
      id: String(brandDoc._id),
      name: brandDoc.name,
    };
    obj.brandId = brandDoc._id;
  } else {
    obj.brand = null;
    obj.brandId = obj.brandId || null;
  }

  if (stockBalance !== null && stockBalance !== undefined) {
    obj.stockBalance = stockBalance;
  }

  return obj;
}

export const itemService = {
  /**
   * Atomically generates the next in-house productCode for a store (starting at 10000001).
   * Ignores existing supplier/manual codes completely; skips any colliding code in the same store (max 20 tries).
   */
  async generateNextProductCode(storeId, session = null) {
    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      const seq = await incrementItemCodeCounter(storeId, session);
      const candidate = formatItemCodeSeq(seq);

      const exists = await Item.exists(
        scopeToStore({ productCode: candidate }, storeId)
      ).session(session || null);

      if (!exists) {
        return candidate;
      }
    }

    throw new AppError('Unable to generate a unique product code after maximum retries', 500);
  },

  /**
   * Returns the next in-house productCode that WOULD be generated, WITHOUT reserving or incrementing the counter.
   */
  async previewNextProductCode({ storeId, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const counter = await Counter.findOne(
      scopeToStore({ key: ITEM_CODE_COUNTER_KEY }, storeObjectId)
    )
      .lean()
      .session(session || null);

    let candidateSeq = (counter ? counter.seq : ITEM_CODE_START_SEQ) + 1;

    for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
      const candidate = formatItemCodeSeq(candidateSeq);
      const exists = await Item.exists(
        scopeToStore({ productCode: candidate }, storeId)
      ).session(session || null);

      if (!exists) {
        return candidate;
      }
      candidateSeq++;
    }

    return formatItemCodeSeq(candidateSeq);
  },

  /**
   * Creates an item in draft status.
   * - If productCode is omitted/empty: auto-generates from the store's in-house counter (codeSource = "auto").
   * - If productCode is provided: treats as manual supplier code (codeSource = "manual"), duplicate -> 409, does NOT touch counter.
   */
  async createItem({ storeId, actor, itemData, session = null }) {
    const {
      productCode,
      name,
      brandId = null,
      categoryId = null,
      classSeries = '',
      size = '',
      length = '',
      variant = '',
      sellingUnit = 'PCS',
      unitsPerPack = 1,
      mrp = null,
      mrpSource = {},
      sellingPrice = null,
      tax = {},
    } = itemData;

    if (!name || !name.trim()) {
      throw new AppError('Item name is mandatory', 400);
    }

    const rawManualCode =
      productCode !== undefined && productCode !== null ? String(productCode).trim() : '';
    const isAutoCode = rawManualCode === '';

    // Manual code duplicate check (never touches counter)
    if (!isAutoCode) {
      const existing = await Item.findOne(
        scopeToStore({ productCode: rawManualCode }, storeId)
      ).session(session || null);
      if (existing) {
        throw new AppError('An item with this product code already exists in this store', 409);
      }
    }

    // Validate categoryId if provided (must exist, belong to same store, and be active)
    const resolvedCategory = await resolveActiveCategory({ storeId, categoryId, session });

    // Validate brandId if provided (must exist, belong to same store, and be active)
    const resolvedBrand = await resolveActiveBrand({ storeId, brandId, session });

    const mrpPaise = toPaise(mrp);
    const sellingPricePaise = toPaise(sellingPrice);

    const buildItemDoc = (code, codeSource) =>
      new Item({
        storeId,
        productCode: code,
        codeSource,
        name: name.trim(),
        brandId: resolvedBrand ? resolvedBrand._id : null,
        categoryId: resolvedCategory ? resolvedCategory._id : null,
        classSeries: classSeries.trim(),
        size: size.trim(),
        length: length.trim(),
        variant: variant.trim(),
        sellingUnit: sellingUnit.trim() || 'PCS',
        unitsPerPack: Number(unitsPerPack) || 1,
        mrpPaise,
        mrpSource: {
          sourceName: mrpSource.sourceName || '',
          sourceVersion: mrpSource.sourceVersion || '',
          sourceDate: mrpSource.sourceDate ? new Date(mrpSource.sourceDate) : null,
        },
        sellingPricePaise,
        tax: {
          hsnCode: tax.hsnCode || '',
          taxRatePercent: Number(tax.taxRatePercent) || 0,
        },
        status: 'draft',
        createdBy: actor,
        updatedBy: actor,
      });

    let item = null;

    if (!isAutoCode) {
      item = buildItemDoc(rawManualCode, 'manual');
      try {
        await item.save({ session: session || undefined });
      } catch (err) {
        if (err && err.code === 11000) {
          throw new AppError('An item with this product code already exists in this store', 409);
        }
        throw err;
      }
    } else {
      // Auto-generated code with retry on E11000 productCode collision
      let saved = false;
      for (let attempt = 0; attempt < MAX_CODE_GEN_ATTEMPTS; attempt++) {
        const generatedCode = await this.generateNextProductCode(storeId, session);
        item = buildItemDoc(generatedCode, 'auto');
        try {
          await item.save({ session: session || undefined });
          saved = true;
          break;
        } catch (err) {
          const isDuplicateProductCode =
            err &&
            err.code === 11000 &&
            (!err.keyPattern || Boolean(err.keyPattern.productCode));
          if (isDuplicateProductCode) {
            continue;
          }
          throw err;
        }
      }

      if (!saved) {
        throw new AppError('Unable to generate a unique product code after maximum retries', 500);
      }
    }

    // If an initial MRP was provided, record initial PriceHistory for MRP
    if (mrpPaise !== null) {
      const mrpHistory = new PriceHistory({
        storeId,
        itemId: item._id,
        field: 'mrp',
        oldValuePaise: null,
        newValuePaise: mrpPaise,
        effectiveFrom: new Date(),
        reason: 'Initial creation MRP',
        changedBy: actor,
      });
      await mrpHistory.save({ session: session || undefined });
    }

    // If an initial selling price was provided, record initial PriceHistory
    if (sellingPricePaise !== null) {
      const priceHistory = new PriceHistory({
        storeId,
        itemId: item._id,
        field: 'sellingPrice',
        oldValuePaise: null,
        newValuePaise: sellingPricePaise,
        effectiveFrom: new Date(),
        reason: 'Initial creation price',
        changedBy: actor,
      });
      await priceHistory.save({ session: session || undefined });
    }

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'ITEM_CREATE',
      entity: 'Item',
      entityId: item._id,
      after: item.toJSON(),
      reason: isAutoCode ? 'Auto-coded in-house item creation' : 'Manual item creation',
    });

    return formatItemForResponse(item, 0, resolvedCategory, resolvedBrand);
  },

  /**
   * Updates non-price item attributes.
   * Does NOT allow direct updates to sellingPrice, mrp, or productCode.
   */
  async updateItem({ storeId, actor, itemId, updateData, session = null }) {
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    // productCode is IMMUTABLE after creation
    if (updateData.productCode !== undefined) {
      const incomingCode = String(updateData.productCode ?? '').trim();
      if (incomingCode !== item.productCode) {
        throw new AppError('Product code cannot be changed', 400);
      }
    }

    const beforeState = item.toObject();

    // Validate categoryId change if provided
    if (updateData.categoryId !== undefined) {
      const incoming = updateData.categoryId;
      if (incoming === null || incoming === '') {
        item.categoryId = null;
      } else {
        const currentCatId = item.categoryId ? String(item.categoryId) : '';
        if (String(incoming) !== currentCatId) {
          // Changing category: must exist, belong to same store, and be active
          const resolvedCategory = await resolveActiveCategory({
            storeId,
            categoryId: incoming,
            session,
          });
          item.categoryId = resolvedCategory._id;
        }
      }
    }

    // Validate brandId change if provided
    if (updateData.brandId !== undefined) {
      const incoming = updateData.brandId;
      if (incoming === null || incoming === '') {
        item.brandId = null;
      } else {
        const currentBrandId = item.brandId ? String(item.brandId) : '';
        if (String(incoming) !== currentBrandId) {
          // Changing brand: must exist, belong to same store, and be active
          const resolvedBrand = await resolveActiveBrand({
            storeId,
            brandId: incoming,
            session,
          });
          item.brandId = resolvedBrand._id;
        }
      }
    }

    // Whitelist non-price fields
    const allowedFields = [
      'name',
      'classSeries',
      'size',
      'length',
      'variant',
      'sellingUnit',
      'unitsPerPack',
      'tax',
    ];

    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        if (field === 'tax' && typeof updateData.tax === 'object') {
          item.tax = {
            hsnCode: updateData.tax.hsnCode !== undefined ? updateData.tax.hsnCode : item.tax.hsnCode,
            taxRatePercent:
              updateData.tax.taxRatePercent !== undefined
                ? Number(updateData.tax.taxRatePercent)
                : item.tax.taxRatePercent,
          };
        } else {
          item[field] = updateData[field];
        }
      }
    }

    item.updatedBy = actor;
    await item.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'ITEM_UPDATE',
      entity: 'Item',
      entityId: item._id,
      before: beforeState,
      after: item.toObject(),
      reason: 'Metadata update',
    });

    await item.populate('categoryId', 'name');
    await item.populate('brandId', 'name');
    const balance = await stockService.getStockBalance(storeId, item._id, session);
    return formatItemForResponse(item, balance);
  },

  /**
   * Sets selling price.
   * Records PriceHistory and AuditLog.
   * MRP never automatically becomes selling price.
   */
  async setSellingPrice({ storeId, actor, itemId, price, effectiveFrom, reason, session = null }) {
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    const newPricePaise = toPaise(price);
    if (newPricePaise === null || newPricePaise < 0) {
      throw new AppError('Selling price must be a valid non-negative number', 400);
    }

    const oldPricePaise = item.sellingPricePaise;

    item.sellingPricePaise = newPricePaise;
    item.updatedBy = actor;
    await item.save({ session: session || undefined });

    // Append-only PriceHistory
    const historyEntry = new PriceHistory({
      storeId,
      itemId: item._id,
      field: 'sellingPrice',
      oldValuePaise: oldPricePaise,
      newValuePaise: newPricePaise,
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      reason: (reason || '').trim() || 'Admin price revision',
      changedBy: actor,
    });
    await historyEntry.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'ITEM_PRICE_UPDATE',
      entity: 'Item',
      entityId: item._id,
      before: { sellingPrice: toRupees(oldPricePaise) },
      after: { sellingPrice: toRupees(newPricePaise) },
      reason: reason || 'Price set by admin',
    });

    await item.populate('categoryId', 'name');
    await item.populate('brandId', 'name');
    const balance = await stockService.getStockBalance(storeId, item._id, session);
    return formatItemForResponse(item, balance);
  },

  /**
   * Changes item status ('draft', 'active', 'inactive').
   * Activating without a selling price throws AppError 400.
   */
  async setStatus({ storeId, actor, itemId, status, session = null }) {
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    if (!['draft', 'active', 'inactive'].includes(status)) {
      throw new AppError("Invalid status. Allowed values: 'draft', 'active', 'inactive'", 400);
    }

    // Activating without a selling price is blocked
    if (status === 'active' && (item.sellingPricePaise === null || item.sellingPricePaise === undefined)) {
      throw new AppError('Set selling price before activation', 400);
    }

    const oldStatus = item.status;
    item.status = status;
    item.updatedBy = actor;
    await item.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'ITEM_STATUS_CHANGE',
      entity: 'Item',
      entityId: item._id,
      before: { status: oldStatus },
      after: { status },
      reason: `Status changed from ${oldStatus} to ${status}`,
    });

    await item.populate('categoryId', 'name');
    await item.populate('brandId', 'name');
    const balance = await stockService.getStockBalance(storeId, item._id, session);
    return formatItemForResponse(item, balance);
  },

  /**
   * Retrieves single item with stock balance and populated category { id, name } and brand { id, name }.
   */
  async getItemById({ storeId, itemId, session = null }) {
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId))
      .populate('categoryId', 'name')
      .populate('brandId', 'name')
      .session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    const balance = await stockService.getStockBalance(storeId, item._id, session);
    return formatItemForResponse(item, balance);
  },

  /**
   * Admin listing with search, filters, pagination, and stock balances.
   */
  async listItems({ storeId, filters = {}, pagination = {}, session = null }) {
    const query = {};

    // Search by productCode or name
    if (filters.search && filters.search.trim()) {
      const term = filters.search.trim();
      const regex = new RegExp(term, 'i');
      query.$or = [{ productCode: regex }, { name: regex }];
    }

    if (filters.brandId && String(filters.brandId).trim()) {
      const rawBrandId = String(filters.brandId).trim();
      if (!mongoose.Types.ObjectId.isValid(rawBrandId)) {
        throw new AppError('Invalid brand', 400);
      }
      query.brandId = new mongoose.Types.ObjectId(rawBrandId);
    }
    if (filters.categoryId && String(filters.categoryId).trim()) {
      const rawCategoryId = String(filters.categoryId).trim();
      if (!mongoose.Types.ObjectId.isValid(rawCategoryId)) {
        throw new AppError('Invalid category', 400);
      }
      query.categoryId = new mongoose.Types.ObjectId(rawCategoryId);
    }
    if (filters.status) {
      query.status = filters.status;
    }

    const scopedQuery = scopeToStore(query, storeId);

    const page = Math.max(1, parseInt(pagination.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Item.find(scopedQuery)
        .populate('categoryId', 'name')
        .populate('brandId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .session(session || null),
      Item.countDocuments(scopedQuery).session(session || null),
    ]);

    const itemIds = items.map((i) => i._id);
    const stockMap = await stockService.getStockBalances(storeId, itemIds, session);

    const formatted = items.map((item) => formatItemForResponse(item, stockMap[String(item._id)] || 0));

    return {
      items: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  /**
   * Resolves an item by product code exactly (trimmed, case-insensitive) within the store.
   * Scoped to storeId.
   *
   * Return status:
   *  - "matched"   -> exactly one active, priced item
   *  - "ambiguous" -> more than one item/variant shares this code; returns candidates (id, name, code, size/length/variant, unit)
   *  - "inactive"  -> item exists but is inactive or unpriced; do not allow use
   *  - "not_found" -> no item with this code in this store
   *
   * Reusable for billing lookup endpoint and draft parser.
   */
  async resolveItemByCode(storeIdOrOptions, codeParam = null, options = {}) {
    let storeId;
    let code;
    let session;

    if (
      typeof storeIdOrOptions === 'object' &&
      storeIdOrOptions !== null &&
      !storeIdOrOptions._bsontype &&
      !(storeIdOrOptions instanceof mongoose.Types.ObjectId)
    ) {
      storeId = storeIdOrOptions.storeId;
      code = storeIdOrOptions.code;
      session = storeIdOrOptions.session || null;
    } else {
      storeId = storeIdOrOptions;
      code = codeParam;
      session = options?.session || null;
    }

    if (!code || typeof code !== 'string' || !code.trim()) {
      return {
        status: 'not_found',
        item: null,
        candidates: [],
      };
    }

    const cleanCode = code.trim();
    const exactRegex = new RegExp(`^${escapeRegex(cleanCode)}$`, 'i');
    const scopedQuery = scopeToStore({ productCode: exactRegex }, storeId);

    const items = await Item.find(scopedQuery)
      .populate('categoryId', 'name')
      .populate('brandId', 'name')
      .session(session || null);

    if (!items || items.length === 0) {
      return {
        status: 'not_found',
        item: null,
        candidates: [],
      };
    }

    if (items.length > 1) {
      const candidates = items.map((i) => ({
        id: String(i._id),
        _id: i._id,
        name: i.name,
        code: i.productCode,
        productCode: i.productCode,
        size: i.size || '',
        length: i.length || '',
        variant: i.variant || '',
        unit: i.sellingUnit || 'PCS',
        sellingUnit: i.sellingUnit || 'PCS',
        status: i.status,
      }));

      return {
        status: 'ambiguous',
        item: null,
        candidates,
      };
    }

    const item = items[0];
    const isActive = item.status === 'active';
    const isPriced =
      item.sellingPricePaise !== null &&
      item.sellingPricePaise !== undefined &&
      Number(item.sellingPricePaise) > 0;

    if (!isActive || !isPriced) {
      return {
        status: 'inactive',
        item: null,
        candidates: [],
      };
    }

    const stockMap = await stockService.getStockBalances(storeId, [item._id], session);
    const formatted = formatItemForResponse(item, stockMap[String(item._id)] || 0);

    return {
      status: 'matched',
      item: formatted,
      candidates: [],
    };
  },

  /**
   * Search for active items (salesman & admin billing lookup).
   * Only returns ACTIVE items. Page size max 20. Supports optional categoryId and brandId filters.
   * If search matches a productCode exactly (case-insensitive), that exact match is returned FIRST.
   */
  async searchActiveItems({ storeId, search = '', categoryId = null, brandId = null, pagination = {}, session = null }) {
    const query = { status: 'active' };

    const cleanSearch = (search || '').trim();
    if (cleanSearch) {
      const regex = new RegExp(escapeRegex(cleanSearch), 'i');
      query.$or = [{ productCode: regex }, { name: regex }];
    }

    const rawCatId = categoryId || pagination.categoryId;
    if (rawCatId && String(rawCatId).trim()) {
      const cleanCatId = String(rawCatId).trim();
      if (!mongoose.Types.ObjectId.isValid(cleanCatId)) {
        throw new AppError('Invalid category', 400);
      }
      query.categoryId = new mongoose.Types.ObjectId(cleanCatId);
    }

    const rawBrandId = brandId || pagination.brandId;
    if (rawBrandId && String(rawBrandId).trim()) {
      const cleanBrandId = String(rawBrandId).trim();
      if (!mongoose.Types.ObjectId.isValid(cleanBrandId)) {
        throw new AppError('Invalid brand', 400);
      }
      query.brandId = new mongoose.Types.ObjectId(cleanBrandId);
    }

    const scopedQuery = scopeToStore(query, storeId);

    const page = Math.max(1, parseInt(pagination.page, 10) || 1);
    const limit = Math.min(20, Math.max(1, parseInt(pagination.limit, 10) || 20));
    const skip = (page - 1) * limit;

    let items = [];
    let total = 0;

    // Check if query exactly equals any productCode in this store
    if (cleanSearch) {
      const exactCodeRegex = new RegExp(`^${escapeRegex(cleanSearch)}$`, 'i');
      const exactCodeQuery = { ...scopedQuery, productCode: exactCodeRegex };
      delete exactCodeQuery.$or;

      const [exactMatches, totalCount] = await Promise.all([
        Item.find(exactCodeQuery)
          .populate('categoryId', 'name')
          .populate('brandId', 'name')
          .sort({ name: 1 })
          .session(session || null),
        Item.countDocuments(scopedQuery).session(session || null),
      ]);

      total = totalCount;

      if (exactMatches.length > 0) {
        // We have exact productCode match(es) that should appear FIRST
        const exactMatchIds = exactMatches.map((m) => m._id);
        const otherItemsQuery = { ...scopedQuery, _id: { $nin: exactMatchIds } };

        if (page === 1) {
          const exactOnFirstPage = exactMatches.slice(0, limit);
          const remainingSlots = limit - exactOnFirstPage.length;

          let otherItems = [];
          if (remainingSlots > 0) {
            otherItems = await Item.find(otherItemsQuery)
              .populate('categoryId', 'name')
              .populate('brandId', 'name')
              .sort({ name: 1 })
              .limit(remainingSlots)
              .session(session || null);
          }
          items = [...exactOnFirstPage, ...otherItems];
        } else {
          // If page > 1, shift offset by the number of exact matches placed on earlier page(s)
          const adjustedSkip = skip - exactMatches.length;
          const otherItems = await Item.find(otherItemsQuery)
            .populate('categoryId', 'name')
            .populate('brandId', 'name')
            .sort({ name: 1 })
            .skip(Math.max(0, adjustedSkip))
            .limit(limit)
            .session(session || null);
          items = otherItems;
        }
      } else {
        items = await Item.find(scopedQuery)
          .populate('categoryId', 'name')
          .populate('brandId', 'name')
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .session(session || null);
      }
    } else {
      const [fetchedItems, totalCount] = await Promise.all([
        Item.find(scopedQuery)
          .populate('categoryId', 'name')
          .populate('brandId', 'name')
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .session(session || null),
        Item.countDocuments(scopedQuery).session(session || null),
      ]);
      items = fetchedItems;
      total = totalCount;
    }

    const itemIds = items.map((i) => i._id);
    const stockMap = await stockService.getStockBalances(storeId, itemIds, session);

    const formatted = items.map((item) => formatItemForResponse(item, stockMap[String(item._id)] || 0));

    return {
      items: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  /**
   * Retrieves append-only PriceHistory for an item.
   */
  async getPriceHistory({ storeId, itemId, session = null }) {
    const item = await Item.findOne(scopeToStore({ _id: itemId }, storeId)).session(session || null);
    if (!item) {
      throw new AppError('Item not found in this store', 404);
    }

    const history = await PriceHistory.find(scopeToStore({ itemId }, storeId))
      .sort({ createdAt: -1 })
      .session(session || null);

    return history.map((h) => {
      const obj = h.toObject();
      obj.oldValue = toRupees(obj.oldValuePaise);
      obj.newValue = toRupees(obj.newValuePaise);
      return obj;
    });
  },

  /**
   * Retrieves chronological stock movements for an item in a store.
   * Includes sourceType, sourceId, and for purchase movements: purchaseNumber & supplier name.
   */
  async getStockMovements({ storeId, itemId, session = null }) {
    return stockService.getStockMovements({ storeId, itemId, session });
  },
};

export default itemService;

