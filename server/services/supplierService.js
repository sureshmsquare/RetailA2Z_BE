import mongoose from 'mongoose';
import Supplier, { normalizeSupplierName } from '../models/Supplier.js';
import { normalizeIndianMobile } from '../utils/phone.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import auditService from './auditService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatSupplier(doc, canDelete = true) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = String(obj._id);
  if (canDelete !== undefined) {
    obj.canDelete = Boolean(canDelete);
  }
  return obj;
}

function getChangedFields(before, after) {
  const diffBefore = {};
  const diffAfter = {};

  const fieldsToCheck = [
    'name',
    'contactPerson',
    'mobile',
    'alternateMobile',
    'email',
    'address',
    'gstin',
    'creditDays',
    'notes',
    'isActive',
  ];

  for (const field of fieldsToCheck) {
    const valBefore = before[field];
    const valAfter = after[field];

    if (field === 'address') {
      const bObj = valBefore && typeof valBefore === 'object' ? (valBefore.toObject ? valBefore.toObject() : valBefore) : {};
      const aObj = valAfter && typeof valAfter === 'object' ? (valAfter.toObject ? valAfter.toObject() : valAfter) : {};
      const addrBeforeStr = JSON.stringify(bObj);
      const addrAfterStr = JSON.stringify(aObj);
      if (addrBeforeStr !== addrAfterStr) {
        diffBefore.address = bObj;
        diffAfter.address = aObj;
      }
    } else if (valBefore !== valAfter) {
      diffBefore[field] = valBefore !== undefined ? valBefore : null;
      diffAfter[field] = valAfter !== undefined ? valAfter : null;
    }
  }

  return { diffBefore, diffAfter };
}

/**
 * Supplier Service - All business rules and DB access for Supplier Master.
 * Every function receives storeId explicitly, uses scopeToStore, and accepts optional Mongoose session.
 */
export const supplierService = {
  /**
   * Returns the usage count of a supplier across the system.
   * TODO: Purchases (and payments) must be counted here when those modules are built.
   */
  async getSupplierUsageCount(storeId, supplierId, session = null) {
    // TODO: Purchases (and payments) must be counted here when those modules are built.
    return 0;
  },

  /**
   * Creates a new supplier in the store.
   * - Duplicate nameKey in the store -> AppError 409 "Supplier already exists".
   * - If mobile is given and another supplier in the store has the same normalized mobile:
   *   return 409 with code "DUPLICATE_MOBILE" and other supplier's name,
   *   UNLESS confirmDuplicateMobile is true.
   * - storeId is ALWAYS taken from storeId argument, never from request body.
   */
  async createSupplier({ storeId, actor, supplierData = {}, confirmDuplicateMobile = false, session = null }) {
    const { name: cleanName, nameKey } = normalizeSupplierName(supplierData.name);

    if (!cleanName) {
      throw new AppError('Supplier name is required', 400);
    }
    if (cleanName.length > 100) {
      throw new AppError('Supplier name must be at most 100 characters', 400);
    }

    // Duplicate nameKey check in the same store
    const existingName = await Supplier.findOne(scopeToStore({ nameKey }, storeId)).session(session || null);
    if (existingName) {
      throw new AppError('Supplier already exists', 409);
    }

    // Mobile normalization & duplicate mobile check
    let cleanMobile = null;
    if (supplierData.mobile !== undefined && supplierData.mobile !== null && String(supplierData.mobile).trim() !== '') {
      cleanMobile = normalizeIndianMobile(supplierData.mobile);
      if (!cleanMobile) {
        throw new AppError('Invalid mobile. Must be a valid 10-digit Indian mobile number.', 400);
      }

      // Check if ANOTHER supplier of the same store has the same normalized mobile
      const existingWithMobile = await Supplier.findOne(
        scopeToStore({ mobile: cleanMobile }, storeId)
      ).session(session || null);

      if (existingWithMobile && !confirmDuplicateMobile) {
        throw new AppError(
          `Mobile number is already registered to another supplier (${existingWithMobile.name}). Confirm to proceed.`,
          409,
          {
            code: 'DUPLICATE_MOBILE',
            otherSupplierName: existingWithMobile.name,
          }
        );
      }
    }

    // Alternate mobile normalization
    let cleanAltMobile = null;
    if (supplierData.alternateMobile !== undefined && supplierData.alternateMobile !== null && String(supplierData.alternateMobile).trim() !== '') {
      cleanAltMobile = normalizeIndianMobile(supplierData.alternateMobile);
      if (!cleanAltMobile) {
        throw new AppError('Invalid alternate mobile. Must be a valid 10-digit Indian mobile number.', 400);
      }
    }

    // Email normalization
    let cleanEmail = null;
    if (supplierData.email !== undefined && supplierData.email !== null && String(supplierData.email).trim() !== '') {
      cleanEmail = String(supplierData.email).trim().toLowerCase();
    }

    // GSTIN normalization
    let cleanGstin = null;
    if (supplierData.gstin !== undefined && supplierData.gstin !== null && String(supplierData.gstin).trim() !== '') {
      cleanGstin = String(supplierData.gstin).trim().toUpperCase();
    }

    // Credit days
    let cleanCreditDays = 0;
    if (supplierData.creditDays !== undefined && supplierData.creditDays !== null && supplierData.creditDays !== '') {
      cleanCreditDays = Number(supplierData.creditDays);
    }

    const supplier = new Supplier({
      storeId,
      name: cleanName,
      nameKey,
      contactPerson: supplierData.contactPerson ? String(supplierData.contactPerson).trim() : '',
      mobile: cleanMobile,
      alternateMobile: cleanAltMobile,
      email: cleanEmail,
      address: supplierData.address || {},
      gstin: cleanGstin,
      creditDays: cleanCreditDays,
      notes: supplierData.notes ? String(supplierData.notes).trim() : '',
      isActive: true,
      createdBy: actor,
      updatedBy: actor,
    });

    try {
      await supplier.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Supplier already exists', 409);
      }
      throw err;
    }

    await auditService.log({
      actor,
      storeId,
      action: 'SUPPLIER_CREATE',
      entity: 'Supplier',
      entityId: supplier._id,
      after: supplier.toObject(),
      reason: 'Supplier created',
    });

    return formatSupplier(supplier, true);
  },

  /**
   * Updates an existing supplier.
   * - Duplicate nameKey check ignoring itself.
   * - Duplicate mobile check ignoring itself, respecting confirmDuplicateMobile.
   * - Writes audit log with only changed fields before and after.
   */
  async updateSupplier({ storeId, actor, supplierId, updateData = {}, confirmDuplicateMobile = false, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }

    const supplier = await Supplier.findOne(scopeToStore({ _id: supplierId }, storeId)).session(session || null);
    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }

    const beforeSnapshot = supplier.toObject();

    // 1. Name update
    if (updateData.name !== undefined) {
      const { name: cleanName, nameKey } = normalizeSupplierName(updateData.name);
      if (!cleanName) {
        throw new AppError('Supplier name cannot be empty', 400);
      }
      if (cleanName.length > 100) {
        throw new AppError('Supplier name must be at most 100 characters', 400);
      }

      // Check duplicate nameKey ignoring this supplier
      const duplicate = await Supplier.findOne(
        scopeToStore({ nameKey, _id: { $ne: supplier._id } }, storeId)
      ).session(session || null);
      if (duplicate) {
        throw new AppError('Supplier already exists', 409);
      }

      supplier.name = cleanName;
      supplier.nameKey = nameKey;
    }

    // 2. Mobile update
    if (updateData.mobile !== undefined) {
      if (updateData.mobile === null || String(updateData.mobile).trim() === '') {
        supplier.mobile = null;
      } else {
        const cleanMobile = normalizeIndianMobile(updateData.mobile);
        if (!cleanMobile) {
          throw new AppError('Invalid mobile. Must be a valid 10-digit Indian mobile number.', 400);
        }

        // Check duplicate mobile on ANOTHER supplier in the same store
        const duplicateMobile = await Supplier.findOne(
          scopeToStore({ mobile: cleanMobile, _id: { $ne: supplier._id } }, storeId)
        ).session(session || null);

        if (duplicateMobile && !confirmDuplicateMobile) {
          throw new AppError(
            `Mobile number is already registered to another supplier (${duplicateMobile.name}). Confirm to proceed.`,
            409,
            {
              code: 'DUPLICATE_MOBILE',
              otherSupplierName: duplicateMobile.name,
            }
          );
        }

        supplier.mobile = cleanMobile;
      }
    }

    // 3. Alternate Mobile update
    if (updateData.alternateMobile !== undefined) {
      if (updateData.alternateMobile === null || String(updateData.alternateMobile).trim() === '') {
        supplier.alternateMobile = null;
      } else {
        const cleanAltMobile = normalizeIndianMobile(updateData.alternateMobile);
        if (!cleanAltMobile) {
          throw new AppError('Invalid alternate mobile. Must be a valid 10-digit Indian mobile number.', 400);
        }
        supplier.alternateMobile = cleanAltMobile;
      }
    }

    // 4. Contact Person
    if (updateData.contactPerson !== undefined) {
      supplier.contactPerson = updateData.contactPerson ? String(updateData.contactPerson).trim() : '';
    }

    // 5. Email update
    if (updateData.email !== undefined) {
      supplier.email = updateData.email && String(updateData.email).trim() !== ''
        ? String(updateData.email).trim().toLowerCase()
        : null;
    }

    // 6. GSTIN update
    if (updateData.gstin !== undefined) {
      supplier.gstin = updateData.gstin && String(updateData.gstin).trim() !== ''
        ? String(updateData.gstin).trim().toUpperCase()
        : null;
    }

    // 7. Credit Days update
    if (updateData.creditDays !== undefined) {
      supplier.creditDays = updateData.creditDays !== null && updateData.creditDays !== ''
        ? Number(updateData.creditDays)
        : 0;
    }

    // 8. Notes update
    if (updateData.notes !== undefined) {
      supplier.notes = updateData.notes ? String(updateData.notes).trim() : '';
    }

    // 9. Address update
    if (updateData.address !== undefined) {
      supplier.address = {
        line1: updateData.address.line1 !== undefined ? String(updateData.address.line1).trim() : (supplier.address?.line1 || ''),
        area: updateData.address.area !== undefined ? String(updateData.address.area).trim() : (supplier.address?.area || ''),
        city: updateData.address.city !== undefined ? String(updateData.address.city).trim() : (supplier.address?.city || ''),
        state: updateData.address.state !== undefined ? String(updateData.address.state).trim() : (supplier.address?.state || ''),
        pincode: updateData.address.pincode !== undefined ? String(updateData.address.pincode).trim() : (supplier.address?.pincode || ''),
      };
    }

    supplier.updatedBy = actor;

    try {
      await supplier.save({ session: session || undefined });
    } catch (err) {
      if (err && err.code === 11000) {
        throw new AppError('Supplier already exists', 409);
      }
      throw err;
    }

    const afterSnapshot = supplier.toObject();
    const { diffBefore, diffAfter } = getChangedFields(beforeSnapshot, afterSnapshot);

    if (Object.keys(diffBefore).length > 0 || Object.keys(diffAfter).length > 0) {
      await auditService.log({
        actor,
        storeId,
        action: 'SUPPLIER_UPDATE',
        entity: 'Supplier',
        entityId: supplier._id,
        before: diffBefore,
        after: diffAfter,
        reason: 'Supplier updated',
      });
    }

    const usageCount = await this.getSupplierUsageCount(storeId, supplier._id, session);
    return formatSupplier(supplier, usageCount === 0);
  },

  /**
   * Activates or deactivates a supplier at any time.
   */
  async setSupplierStatus({ storeId, actor, supplierId, isActive, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }
    if (typeof isActive !== 'boolean') {
      throw new AppError('isActive must be a boolean', 400);
    }

    const supplier = await Supplier.findOne(scopeToStore({ _id: supplierId }, storeId)).session(session || null);
    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }

    const beforeState = { isActive: supplier.isActive };

    supplier.isActive = isActive;
    supplier.updatedBy = actor;
    await supplier.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: 'SUPPLIER_STATUS_CHANGE',
      entity: 'Supplier',
      entityId: supplier._id,
      before: beforeState,
      after: { isActive: supplier.isActive },
      reason: `Supplier ${isActive ? 'activated' : 'deactivated'}`,
    });

    const usageCount = await this.getSupplierUsageCount(storeId, supplier._id, session);
    return formatSupplier(supplier, usageCount === 0);
  },

  /**
   * Hard-deletes a supplier only if usage count is 0.
   * Otherwise throws AppError 409 "Supplier is used in <N> record(s). Deactivate it instead."
   */
  async deleteSupplier({ storeId, actor, supplierId, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }

    const supplier = await Supplier.findOne(scopeToStore({ _id: supplierId }, storeId)).session(session || null);
    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }

    const usageCount = await this.getSupplierUsageCount(storeId, supplier._id, session);
    if (usageCount > 0) {
      throw new AppError(`Supplier is used in ${usageCount} record(s). Deactivate it instead.`, 409);
    }

    const beforeState = supplier.toObject();

    await supplier.deleteOne({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: 'SUPPLIER_DELETE',
      entity: 'Supplier',
      entityId: supplier._id,
      before: beforeState,
      reason: `Supplier "${supplier.name}" deleted`,
    });

    return {
      id: String(supplier._id),
      name: supplier.name,
    };
  },

  /**
   * Retrieves a single supplier by id in the same store.
   */
  async getSupplier({ storeId, supplierId, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(supplierId))) {
      throw new AppError('Invalid supplier ID format', 400);
    }

    const supplier = await Supplier.findOne(scopeToStore({ _id: supplierId }, storeId)).session(session || null);
    if (!supplier) {
      throw new AppError('Supplier not found in this store', 404);
    }

    const usageCount = await this.getSupplierUsageCount(storeId, supplier._id, session);
    return formatSupplier(supplier, usageCount === 0);
  },

  /**
   * Lists suppliers for admin with search, status filter, pagination, and canDelete.
   */
  async listSuppliers({ storeId, filters = {}, pagination = {}, session = null }) {
    const query = {};

    // Status filter: 'active', 'inactive', or 'all'
    if (filters.status === 'active' || filters.isActive === 'true' || filters.isActive === true) {
      query.isActive = true;
    } else if (filters.status === 'inactive' || filters.isActive === 'false' || filters.isActive === false) {
      query.isActive = false;
    }

    // Search by name, contact person, mobile or city
    if (filters.search && String(filters.search).trim()) {
      const term = escapeRegex(String(filters.search).trim());
      const regex = new RegExp(term, 'i');
      query.$or = [
        { name: regex },
        { contactPerson: regex },
        { mobile: regex },
        { 'address.city': regex },
      ];
    }

    const scopedQuery = scopeToStore(query, storeId);

    const page = Math.max(1, parseInt(pagination.page || filters.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pagination.limit || filters.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [suppliers, total] = await Promise.all([
      Supplier.find(scopedQuery)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .session(session || null),
      Supplier.countDocuments(scopedQuery).session(session || null),
    ]);

    const formatted = await Promise.all(
      suppliers.map(async (s) => {
        const usageCount = await this.getSupplierUsageCount(storeId, s._id, session);
        return formatSupplier(s, usageCount === 0);
      })
    );

    return {
      suppliers: formatted,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  /**
   * Lightweight list of active suppliers ({ id, name }) for dropdowns.
   */
  async listActiveSupplierOptions({ storeId, session = null }) {
    const suppliers = await Supplier.find(scopeToStore({ isActive: true }, storeId))
      .select('_id name')
      .sort({ name: 1 })
      .lean()
      .session(session || null);

    return suppliers.map((s) => ({
      id: String(s._id),
      name: s.name,
    }));
  },
};

export default supplierService;

