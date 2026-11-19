import mongoose from 'mongoose';
import Brand, { normalizeBrandName } from '../models/Brand.js';
import Item from '../models/Item.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import auditService from './auditService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatBrand(doc, itemCount = undefined) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  if (itemCount !== undefined) {
    obj.itemCount = itemCount;
  }
  return obj;
}

/**
 * Brand Service - All business rules and DB access for Brand Master.
 * Every function receives storeId explicitly, uses scopeToStore, and accepts optional Mongoose session.
 */
export const brandService = {
  /**
   * Creates a new brand in the store.
   * Duplicate nameKey in the same store throws AppError 409 "Brand already exists".
   */
  async createBrand({ storeId, actor, name, session = null }) {
    const { name: cleanName, nameKey } = normalizeBrandName(name);

    if (!cleanName) {
      throw new AppError('Brand name is required', 400);
    }
    if (cleanName.length > 60) {
      throw new AppError('Brand name must be at most 60 characters', 400);
    }

    const existing = await Brand.findOne(scopeToStore({ nameKey }, storeId)).session(
      session || null
    );
    if (existing) {
      throw new AppError('Brand already exists', 409);
    }

    const brand = new Brand({
      storeId,
      name: cleanName,
      nameKey,
      isActive: true,
      createdBy: actor,
      updatedBy: actor,
    });

    try {
      await brand.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Brand already exists', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'BRAND_CREATE',
      entity: 'Brand',
      entityId: brand._id,
      after: brand.toObject(),
      reason: 'Brand created',
    });

    return formatBrand(brand, 0);
  },

  /**
   * Renames an existing brand in the same store while keeping the same _id.
   * Duplicate check ignores the brand itself.
   */
  async renameBrand({ storeId, actor, brandId, name, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(brandId))) {
      throw new AppError('Invalid brand ID format', 400);
    }

    const brand = await Brand.findOne(scopeToStore({ _id: brandId }, storeId)).session(
      session || null
    );
    if (!brand) {
      throw new AppError('Brand not found in this store', 404);
    }

    const { name: cleanName, nameKey } = normalizeBrandName(name);
    if (!cleanName) {
      throw new AppError('Brand name is required', 400);
    }
    if (cleanName.length > 60) {
      throw new AppError('Brand name must be at most 60 characters', 400);
    }

    // Duplicate check ignoring itself
    const duplicate = await Brand.findOne(
      scopeToStore({ nameKey, _id: { $ne: brand._id } }, storeId)
    ).session(session || null);
    if (duplicate) {
      throw new AppError('Brand already exists', 409);
    }

    const beforeState = brand.toObject();

    brand.name = cleanName;
    brand.nameKey = nameKey;
    brand.updatedBy = actor;

    try {
      await brand.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Brand already exists', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'BRAND_RENAME',
      entity: 'Brand',
      entityId: brand._id,
      before: beforeState,
      after: brand.toObject(),
      reason: `Brand renamed from "${beforeState.name}" to "${brand.name}"`,
    });

    const itemCount = await Item.countDocuments(
      scopeToStore({ brandId: brand._id }, storeId)
    ).session(session || null);

    return formatBrand(brand, itemCount);
  },

  /**
   * Activates or deactivates a brand.
   * Allowed at any time; deactivating does NOT modify existing items.
   */
  async setBrandStatus({ storeId, actor, brandId, isActive, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(brandId))) {
      throw new AppError('Invalid brand ID format', 400);
    }

    if (typeof isActive !== 'boolean') {
      throw new AppError('isActive must be a boolean', 400);
    }

    const brand = await Brand.findOne(scopeToStore({ _id: brandId }, storeId)).session(
      session || null
    );
    if (!brand) {
      throw new AppError('Brand not found in this store', 404);
    }

    const beforeState = { isActive: brand.isActive };

    brand.isActive = isActive;
    brand.updatedBy = actor;
    await brand.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: 'BRAND_STATUS_CHANGE',
      entity: 'Brand',
      entityId: brand._id,
      before: beforeState,
      after: { isActive: brand.isActive },
      reason: `Brand ${isActive ? 'activated' : 'deactivated'}`,
    });

    const itemCount = await Item.countDocuments(
      scopeToStore({ brandId: brand._id }, storeId)
    ).session(session || null);

    return formatBrand(brand, itemCount);
  },

  /**
   * Hard-deletes a brand if it has no items in the same store (in draft, active, or inactive status).
   * If the brand has any items, throws AppError 409:
   * "Brand has <N> item(s). Deactivate it instead."
   */
  async deleteBrand({ storeId, id, brandId, actor, session = null }) {
    const targetId = id || brandId;
    if (!mongoose.Types.ObjectId.isValid(String(targetId))) {
      throw new AppError('Invalid brand ID format', 400);
    }

    const executeDelete = async (activeSession) => {
      const brand = await Brand.findOne(scopeToStore({ _id: targetId }, storeId)).session(
        activeSession || null
      );
      if (!brand) {
        throw new AppError('Brand not found in this store', 404);
      }

      const itemCount = await Item.countDocuments(
        scopeToStore({ brandId: brand._id }, storeId)
      ).session(activeSession || null);

      if (itemCount > 0) {
        throw new AppError(`Brand has ${itemCount} item(s). Deactivate it instead.`, 409);
      }

      const beforeState = brand.toObject();

      await brand.deleteOne({ session: activeSession || undefined });

      await auditService.log({
        actor,
        storeId,
        action: 'BRAND_DELETE',
        entity: 'Brand',
        entityId: brand._id,
        before: beforeState,
        reason: `Brand "${brand.name}" deleted`,
      });

      return {
        id: String(brand._id),
        name: brand.name,
      };
    };

    if (session) {
      return executeDelete(session);
    }

    const isReplicaSet = Boolean(mongoose.connection?.client?.topology?.description?.setName);
    if (isReplicaSet) {
      const internalSession = await mongoose.startSession();
      try {
        let result;
        await internalSession.withTransaction(async () => {
          result = await executeDelete(internalSession);
        });
        return result;
      } finally {
        await internalSession.endSession();
      }
    }

    return executeDelete(null);
  },

  /**
   * Lists all brands for admin with itemCount per brand, search, and status filter.
   */
  async listBrands({ storeId, filters = {}, session = null }) {
    const query = {};

    // Status filter: 'active', 'inactive', or 'all'
    if (filters.status === 'active' || filters.isActive === 'true' || filters.isActive === true) {
      query.isActive = true;
    } else if (
      filters.status === 'inactive' ||
      filters.isActive === 'false' ||
      filters.isActive === false
    ) {
      query.isActive = false;
    }

    // Search by name
    if (filters.search && String(filters.search).trim()) {
      const escaped = escapeRegex(String(filters.search).trim());
      query.name = new RegExp(escaped, 'i');
    }

    const scopedQuery = scopeToStore(query, storeId);
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

    const [brands, itemCounts] = await Promise.all([
      Brand.find(scopedQuery).sort({ name: 1 }).session(session || null),
      Item.aggregate([
        {
          $match: {
            storeId: storeObjectId,
            brandId: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$brandId',
            count: { $sum: 1 },
          },
        },
      ]).session(session || null),
    ]);

    const countMap = new Map();
    for (const row of itemCounts) {
      countMap.set(String(row._id), row.count);
    }

    return brands.map((b) => formatBrand(b, countMap.get(String(b._id)) || 0));
  },

  /**
   * Lightweight list of active brands ({ id, name }) for dropdowns.
   * Allowed for admin and salesman.
   */
  async listActiveBrandOptions({ storeId, session = null }) {
    const brands = await Brand.find(scopeToStore({ isActive: true }, storeId))
      .select('_id name')
      .sort({ name: 1 })
      .lean()
      .session(session || null);

    return brands.map((b) => ({
      id: String(b._id),
      name: b.name,
    }));
  },
};

export default brandService;

