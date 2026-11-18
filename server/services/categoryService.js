import mongoose from 'mongoose';
import Category, { normalizeCategoryName } from '../models/Category.js';
import Item from '../models/Item.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import auditService from './auditService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatCategory(doc, itemCount = undefined) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  if (itemCount !== undefined) {
    obj.itemCount = itemCount;
  }
  return obj;
}

/**
 * Category Service - All business rules and DB access for Category Master.
 * Every function receives storeId explicitly, uses scopeToStore, and accepts optional Mongoose session.
 */
export const categoryService = {
  /**
   * Creates a new category in the store.
   * Duplicate nameKey in the same store throws AppError 409 "Category already exists".
   */
  async createCategory({ storeId, actor, name, session = null }) {
    const { name: cleanName, nameKey } = normalizeCategoryName(name);

    if (!cleanName) {
      throw new AppError('Category name is required', 400);
    }
    if (cleanName.length > 60) {
      throw new AppError('Category name must be at most 60 characters', 400);
    }

    const existing = await Category.findOne(scopeToStore({ nameKey }, storeId)).session(
      session || null
    );
    if (existing) {
      throw new AppError('Category already exists', 409);
    }

    const category = new Category({
      storeId,
      name: cleanName,
      nameKey,
      isActive: true,
      createdBy: actor,
      updatedBy: actor,
    });

    try {
      await category.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Category already exists', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'CATEGORY_CREATE',
      entity: 'Category',
      entityId: category._id,
      after: category.toObject(),
      reason: 'Category created',
    });

    return formatCategory(category, 0);
  },

  /**
   * Renames an existing category in the same store while keeping the same _id.
   * Duplicate check ignores the category itself.
   */
  async renameCategory({ storeId, actor, categoryId, name, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
      throw new AppError('Invalid category ID format', 400);
    }

    const category = await Category.findOne(scopeToStore({ _id: categoryId }, storeId)).session(
      session || null
    );
    if (!category) {
      throw new AppError('Category not found in this store', 404);
    }

    const { name: cleanName, nameKey } = normalizeCategoryName(name);
    if (!cleanName) {
      throw new AppError('Category name is required', 400);
    }
    if (cleanName.length > 60) {
      throw new AppError('Category name must be at most 60 characters', 400);
    }

    // Duplicate check ignoring itself
    const duplicate = await Category.findOne(
      scopeToStore({ nameKey, _id: { $ne: category._id } }, storeId)
    ).session(session || null);
    if (duplicate) {
      throw new AppError('Category already exists', 409);
    }

    const beforeState = category.toObject();

    category.name = cleanName;
    category.nameKey = nameKey;
    category.updatedBy = actor;

    try {
      await category.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Category already exists', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'CATEGORY_RENAME',
      entity: 'Category',
      entityId: category._id,
      before: beforeState,
      after: category.toObject(),
      reason: `Category renamed from "${beforeState.name}" to "${category.name}"`,
    });

    const itemCount = await Item.countDocuments(
      scopeToStore({ categoryId: category._id }, storeId)
    ).session(session || null);

    return formatCategory(category, itemCount);
  },

  /**
   * Activates or deactivates a category.
   * Allowed at any time; deactivating does NOT modify existing items.
   */
  async setCategoryStatus({ storeId, actor, categoryId, isActive, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
      throw new AppError('Invalid category ID format', 400);
    }

    if (typeof isActive !== 'boolean') {
      throw new AppError('isActive must be a boolean', 400);
    }

    const category = await Category.findOne(scopeToStore({ _id: categoryId }, storeId)).session(
      session || null
    );
    if (!category) {
      throw new AppError('Category not found in this store', 404);
    }

    const beforeState = { isActive: category.isActive };

    category.isActive = isActive;
    category.updatedBy = actor;
    await category.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: 'CATEGORY_STATUS_CHANGE',
      entity: 'Category',
      entityId: category._id,
      before: beforeState,
      after: { isActive: category.isActive },
      reason: `Category ${isActive ? 'activated' : 'deactivated'}`,
    });

    const itemCount = await Item.countDocuments(
      scopeToStore({ categoryId: category._id }, storeId)
    ).session(session || null);

    return formatCategory(category, itemCount);
  },

  /**
   * Lists all categories for admin with itemCount per category, search, and status filter.
   */
  async listCategories({ storeId, filters = {}, session = null }) {
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

    const [categories, itemCounts] = await Promise.all([
      Category.find(scopedQuery).sort({ name: 1 }).session(session || null),
      Item.aggregate([
        {
          $match: {
            storeId: storeObjectId,
            categoryId: { $ne: null },
          },
        },
        {
          $group: {
            _id: '$categoryId',
            count: { $sum: 1 },
          },
        },
      ]).session(session || null),
    ]);

    const countMap = new Map();
    for (const row of itemCounts) {
      countMap.set(String(row._id), row.count);
    }

    return categories.map((cat) => formatCategory(cat, countMap.get(String(cat._id)) || 0));
  },

  /**
   * Lightweight list of active categories ({ id, name }) for dropdowns.
   * Allowed for admin and salesman.
   */
  async listActiveCategoryOptions({ storeId, session = null }) {
    const categories = await Category.find(scopeToStore({ isActive: true }, storeId))
      .select('_id name')
      .sort({ name: 1 })
      .lean()
      .session(session || null);

    return categories.map((cat) => ({
      id: String(cat._id),
      name: cat.name,
    }));
  },
};

export default categoryService;

