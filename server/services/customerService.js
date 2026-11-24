import mongoose from 'mongoose';
import Customer, {
  normalizeIndianMobile,
  isValidGSTIN,
  formatCustomerForResponse,
} from '../models/Customer.js';
import CustomerCreditHistory, {
  formatCreditHistoryForResponse,
} from '../models/CustomerCreditHistory.js';
import Counter, {
  CUSTOMER_CODE_COUNTER_KEY,
  CUSTOMER_CODE_START_SEQ,
} from '../models/Counter.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toPaise } from '../utils/money.js';
import auditService from './auditService.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Formats a sequence number into Customer Code format: CUS-00001
 * @param {number} seq
 * @returns {string}
 */
export function formatCustomerCodeSeq(seq) {
  return `CUS-${String(seq).padStart(5, '0')}`;
}

/**
 * Atomically increments the store-scoped customerCode sequence counter.
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {mongoose.ClientSession|null} session
 * @returns {Promise<number>}
 */
export async function incrementCustomerCodeCounter(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: CUSTOMER_CODE_COUNTER_KEY }, storeObjectId);

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
          key: CUSTOMER_CODE_COUNTER_KEY,
          seq: CUSTOMER_CODE_START_SEQ,
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
 * Generates an auto-incremented, collision-free customerCode (e.g. CUS-00001) for the store.
 * @param {string|mongoose.Types.ObjectId} storeId
 * @param {mongoose.ClientSession|null} session
 * @returns {Promise<string>}
 */
export async function generateUniqueCustomerCode(storeId, session = null) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const seq = await incrementCustomerCodeCounter(storeId, session);
    const candidate = formatCustomerCodeSeq(seq);
    const exists = await Customer.exists(
      scopeToStore({ customerCode: candidate }, storeId)
    ).session(session || null);

    if (!exists) {
      return candidate;
    }
  }
  return `CUS-${Date.now().toString().slice(-5)}`;
}

/**
 * Customer Service - All business rules and DB queries for Customer Master.
 * Every query is scoped to storeId via scopeToStore.
 */
export const customerService = {
  /**
   * Creates a new customer record.
   * - Scoped to storeId (body storeId is ignored).
   * - Normalizes mobile and checks for duplicates within this store.
   * - If duplicate normalized_mobile exists and confirmDuplicate is not true, returns 409 DUPLICATE_MOBILE warning.
   * - Sales staff cannot enable credit: credit fields are forced to "No credit".
   * - Only Store Admin can configure initial credit terms.
   */
  async createCustomer({ storeId, actor, userRole, data, session = null }) {
    const rawMobile = data.mobile;
    const { mobile: cleanMobile, normalizedMobile, isValid } = normalizeIndianMobile(rawMobile);

    if (!isValid) {
      throw new AppError('Enter a valid 10-digit mobile number', 400);
    }

    const name = String(data.name || '').trim();
    if (!name || name.length < 2 || name.length > 100) {
      throw new AppError('Customer name must be between 2 and 100 characters', 400);
    }

    const gstInput = data.gst_number !== undefined ? data.gst_number : data.gstNumber;
    const gstNumber = gstInput ? String(gstInput).trim().toUpperCase() : '';
    if (gstNumber && !isValidGSTIN(gstNumber)) {
      throw new AppError('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)', 400);
    }

    // Check for existing customer with the same normalizedMobile in this store
    const duplicates = await Customer.find(
      scopeToStore({ normalizedMobile }, storeId)
    )
      .lean()
      .session(session || null);

    const isConfirmed = Boolean(data.confirm_duplicate || data.confirmDuplicate);

    if (duplicates.length > 0 && !isConfirmed) {
      throw new AppError(
        'A customer with this mobile number already exists in this store.',
        409,
        {
          warning: 'DUPLICATE_MOBILE',
          duplicates: duplicates.map((d) => formatCustomerForResponse(d)),
        }
      );
    }

    // Determine credit settings based on role
    // Sales staff (and non-admins) can NEVER enable credit; credit fields are forced to "No credit"
    let creditEnabled = false;
    let creditLimitPaise = null;
    let creditDays = null;

    if (userRole === 'admin') {
      const isCreditEnabledInput =
        data.credit_enabled !== undefined ? data.credit_enabled : data.creditEnabled;
      creditEnabled = Boolean(isCreditEnabledInput);

      if (creditEnabled) {
        const limitInput =
          data.credit_limit !== undefined ? data.credit_limit : data.creditLimit;
        const daysInput =
          data.credit_days !== undefined ? data.credit_days : data.creditDays;

        if (
          limitInput === undefined ||
          limitInput === null ||
          isNaN(Number(limitInput)) ||
          Number(limitInput) < 0
        ) {
          throw new AppError(
            'Credit limit is required and must be a non-negative number when credit is enabled',
            400
          );
        }

        if (
          daysInput === undefined ||
          daysInput === null ||
          !Number.isInteger(Number(daysInput)) ||
          Number(daysInput) < 1
        ) {
          throw new AppError(
            'Credit days is required and must be an integer of at least 1 when credit is enabled',
            400
          );
        }

        creditLimitPaise = toPaise(limitInput);
        creditDays = Number(daysInput);
      }
    }

    const locality = String(data.locality || '').trim();
    const businessName = String(
      data.business_name !== undefined ? data.business_name : data.businessName || ''
    ).trim();

    // Auto-generate customerCode in CUS-00001 format
    const customerCode =
      data.customerCode ||
      data.customer_code ||
      (await generateUniqueCustomerCode(storeId, session));

    const customer = new Customer({
      storeId,
      customerCode,
      name,
      mobile: cleanMobile,
      normalizedMobile,
      locality,
      businessName,
      gstNumber,
      creditEnabled,
      creditLimitPaise,
      creditDays,
      isActive: true,
      createdBy: actor,
      updatedBy: actor,
    });

    await customer.save({ session: session || undefined });

    // If initial credit terms were enabled, record in customer_credit_history
    if (creditEnabled) {
      await CustomerCreditHistory.create(
        [
          {
            customerId: customer._id,
            storeId,
            oldCreditEnabled: false,
            newCreditEnabled: true,
            oldCreditLimitPaise: null,
            newCreditLimitPaise: creditLimitPaise,
            oldCreditDays: null,
            newCreditDays: creditDays,
            changedBy: actor,
            changedAt: new Date(),
            reason: data.reason || 'Initial credit terms configured on creation',
          },
        ],
        { session: session || undefined }
      );
    }

    // Write audit log entry
    await auditService.log({
      actor,
      storeId,
      action: 'CUSTOMER_CREATE',
      entity: 'Customer',
      entityId: customer._id,
      after: customer.toObject(),
      reason: isConfirmed ? 'Customer created (duplicate mobile confirmed)' : 'Customer created',
    });

    return formatCustomerForResponse(customer);
  },

  /**
   * Lists customers with search (name or mobile), filtering (credit_enabled, is_active, overdue_only),
   * sorting, and pagination.
   */
  async listCustomers({ storeId, filters = {}, pagination = {}, session = null }) {
    const query = {};

    // 1. Text search across customer code, name, business, gst, locality or mobile
    const search = String(filters.search || filters.q || '').trim();
    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      const searchDigits = search.replace(/\D/g, '');
      const orClauses = [
        { customerCode: searchRegex },
        { name: searchRegex },
        { businessName: searchRegex },
        { gstNumber: searchRegex },
        { locality: searchRegex },
        { mobile: searchRegex },
      ];
      if (searchDigits) {
        orClauses.push({ normalizedMobile: new RegExp(escapeRegex(searchDigits)) });
      }
      query.$or = orClauses;
    }

    if (filters.name) {
      query.name = new RegExp(escapeRegex(String(filters.name).trim()), 'i');
    }

    if (filters.mobile) {
      const mobileDigits = String(filters.mobile).replace(/\D/g, '');
      if (mobileDigits) {
        query.normalizedMobile = new RegExp(escapeRegex(mobileDigits));
      } else {
        query.mobile = new RegExp(escapeRegex(String(filters.mobile).trim()));
      }
    }

    // 2. Filter by creditEnabled
    const creditEnabledFilter =
      filters.credit_enabled !== undefined ? filters.credit_enabled : filters.creditEnabled;
    if (creditEnabledFilter !== undefined && creditEnabledFilter !== '') {
      query.creditEnabled = String(creditEnabledFilter) === 'true';
    }

    // 3. Filter by isActive
    const isActiveFilter =
      filters.is_active !== undefined ? filters.is_active : filters.isActive;
    if (isActiveFilter !== undefined && isActiveFilter !== '') {
      query.isActive = String(isActiveFilter) === 'true';
    }

    // 4. Overdue filter placeholder
    // In Phase 1, invoices do not exist yet, so overdueAmount is 0 for all customers.
    // If overdue_only is true, returns empty results as wired placeholder.
    const overdueOnlyFilter =
      filters.overdue_only !== undefined ? filters.overdue_only : filters.overdueOnly;
    if (overdueOnlyFilter !== undefined && String(overdueOnlyFilter) === 'true') {
      const page = Math.max(1, parseInt(pagination.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
      return {
        customers: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const scopedQuery = scopeToStore(query, storeId);

    // Sorting
    const sortField = filters.sortBy || filters.sort || 'createdAt';
    const sortOrder = String(filters.sortOrder || filters.order || 'desc').toLowerCase() === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };

    // Pagination
    const page = Math.max(1, parseInt(pagination.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(pagination.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [customers, total] = await Promise.all([
      Customer.find(scopedQuery)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean()
        .session(session || null),
      Customer.countDocuments(scopedQuery).session(session || null),
    ]);

    const formattedCustomers = customers.map((c) => formatCustomerForResponse(c));

    return {
      customers: formattedCustomers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 0,
    };
  },

  /**
   * Looks up customers by mobile (partial and exact match) for autocompletion / suggestions.
   */
  async lookupCustomersByMobile({ storeId, mobile, session = null }) {
    if (!mobile || !String(mobile).trim()) {
      return [];
    }

    const rawInput = String(mobile).trim();
    const digits = rawInput.replace(/\D/g, '');

    const orClauses = [{ mobile: new RegExp(escapeRegex(rawInput), 'i') }];
    if (digits) {
      orClauses.push({ normalizedMobile: new RegExp(escapeRegex(digits)) });
    }

    const scopedQuery = scopeToStore({ $or: orClauses }, storeId);

    const customers = await Customer.find(scopedQuery)
      .sort({ name: 1 })
      .limit(20)
      .lean()
      .session(session || null);

    return customers.map((c) => formatCustomerForResponse(c));
  },

  /**
   * Retrieves a customer by ID within the current store.
   * If customer exists in another store, returns 403 Access Denied with NO data leak.
   */
  async getCustomerById({ storeId, customerId, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await Customer.findOne(
      scopeToStore({ _id: customerId }, storeId)
    ).session(session || null);

    if (!customer) {
      // Check if it belongs to another store to deny access without leaking details
      const existsElsewhere = await Customer.findById(customerId).session(session || null);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store', 404);
    }

    return formatCustomerForResponse(customer);
  },

  /**
   * Updates basic customer fields (name, mobile, locality, businessName, gstNumber).
   * Credit fields cannot be edited through this endpoint.
   * If mobile number is changed to an existing number in the same store,
   * returns a 409 DUPLICATE_MOBILE warning unless confirmDuplicate is true.
   */
  async updateCustomerBasic({
    storeId,
    actor,
    customerId,
    updateData,
    confirmDuplicate = false,
    session = null,
  }) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await Customer.findOne(
      scopeToStore({ _id: customerId }, storeId)
    ).session(session || null);

    if (!customer) {
      const existsElsewhere = await Customer.findById(customerId).session(session || null);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store', 404);
    }

    const beforeSnapshot = customer.toObject();

    if (updateData.name !== undefined) {
      const cleanName = String(updateData.name).trim();
      if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
        throw new AppError('Customer name must be between 2 and 100 characters', 400);
      }
      customer.name = cleanName;
    }

    if (updateData.mobile !== undefined) {
      const { mobile: cleanMobile, normalizedMobile, isValid } = normalizeIndianMobile(updateData.mobile);
      if (!isValid) {
        throw new AppError('Enter a valid 10-digit mobile number', 400);
      }

      // If mobile number changed, check for duplicates in the same store
      if (normalizedMobile !== customer.normalizedMobile) {
        const existingDuplicates = await Customer.find(
          scopeToStore({ _id: { $ne: customer._id }, normalizedMobile }, storeId)
        )
          .select('name mobile normalizedMobile locality businessName creditEnabled')
          .lean()
          .session(session || null);

        if (existingDuplicates.length > 0 && !confirmDuplicate) {
          const err = new AppError(
            'A customer with this mobile number already exists in this store.',
            409
          );
          err.warning = 'DUPLICATE_MOBILE';
          err.duplicates = existingDuplicates.map((d) => ({
            id: String(d._id),
            name: d.name,
            mobile: d.mobile,
            locality: d.locality || '',
            businessName: d.businessName || '',
            creditTermsLabel: d.creditEnabled ? 'Credit customer' : 'No credit',
          }));
          throw err;
        }
      }

      customer.mobile = cleanMobile;
      customer.normalizedMobile = normalizedMobile;
    }

    if (updateData.locality !== undefined) {
      customer.locality = String(updateData.locality).trim();
    }

    const businessNameInput =
      updateData.business_name !== undefined ? updateData.business_name : updateData.businessName;
    if (businessNameInput !== undefined) {
      customer.businessName = String(businessNameInput).trim();
    }

    const gstInput =
      updateData.gst_number !== undefined ? updateData.gst_number : updateData.gstNumber;
    if (gstInput !== undefined) {
      const cleanGst = String(gstInput).trim().toUpperCase();
      if (cleanGst && !isValidGSTIN(cleanGst)) {
        throw new AppError('Enter a valid 15-character GSTIN (e.g. 27AAAAA0000A1Z5)', 400);
      }
      customer.gstNumber = cleanGst;
    }

    customer.updatedBy = actor;
    await customer.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: 'CUSTOMER_UPDATE',
      entity: 'Customer',
      entityId: customer._id,
      before: beforeSnapshot,
      after: customer.toObject(),
      reason: 'Basic details updated',
    });

    return formatCustomerForResponse(customer);
  },

  /**
   * Updates customer credit terms. Admin only.
   * Clears creditLimit and creditDays when credit_enabled is false.
   * Writes record to customer_credit_history and audit log.
   */
  async updateCreditTerms({
    storeId,
    actor,
    customerId,
    creditEnabled,
    creditLimit,
    creditDays,
    reason = '',
    session = null,
  }) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await Customer.findOne(
      scopeToStore({ _id: customerId }, storeId)
    ).session(session || null);

    if (!customer) {
      const existsElsewhere = await Customer.findById(customerId).session(session || null);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store', 404);
    }

    const oldCreditEnabled = Boolean(customer.creditEnabled);
    const oldCreditLimitPaise = customer.creditLimitPaise;
    const oldCreditDays = customer.creditDays;

    let newLimitPaise = null;
    let newDays = null;

    if (creditEnabled) {
      if (
        creditLimit === undefined ||
        creditLimit === null ||
        isNaN(Number(creditLimit)) ||
        Number(creditLimit) < 0
      ) {
        throw new AppError(
          'Credit limit is required and must be a non-negative number when credit is enabled',
          400
        );
      }

      if (
        creditDays === undefined ||
        creditDays === null ||
        !Number.isInteger(Number(creditDays)) ||
        Number(creditDays) < 1
      ) {
        throw new AppError(
          'Credit days is required and must be an integer of at least 1 when credit is enabled',
          400
        );
      }

      newLimitPaise = toPaise(creditLimit);
      newDays = Number(creditDays);
      customer.creditEnabled = true;
      customer.creditLimitPaise = newLimitPaise;
      customer.creditDays = newDays;
    } else {
      // credit_enabled = false clears credit_limit and credit_days
      customer.creditEnabled = false;
      customer.creditLimitPaise = null;
      customer.creditDays = null;
    }

    customer.updatedBy = actor;
    await customer.save({ session: session || undefined });

    const historyEntry = await CustomerCreditHistory.create(
      [
        {
          customerId: customer._id,
          storeId,
          oldCreditEnabled,
          newCreditEnabled: customer.creditEnabled,
          oldCreditLimitPaise,
          newCreditLimitPaise: customer.creditLimitPaise,
          oldCreditDays,
          newCreditDays: customer.creditDays,
          changedBy: actor,
          changedAt: new Date(),
          reason: reason || 'Credit terms updated',
        },
      ],
      { session: session || undefined }
    );

    await auditService.log({
      actor,
      storeId,
      action: 'CUSTOMER_CREDIT_TERMS_UPDATE',
      entity: 'Customer',
      entityId: customer._id,
      before: {
        creditEnabled: oldCreditEnabled,
        creditLimitPaise: oldCreditLimitPaise,
        creditDays: oldCreditDays,
      },
      after: {
        creditEnabled: customer.creditEnabled,
        creditLimitPaise: customer.creditLimitPaise,
        creditDays: customer.creditDays,
      },
      reason: reason || 'Credit terms updated',
    });

    return {
      customer: formatCustomerForResponse(customer),
      history: formatCreditHistoryForResponse(
        Array.isArray(historyEntry) ? historyEntry[0] : historyEntry
      ),
    };
  },

  /**
   * Soft activates or deactivates a customer.
   * Customers are NEVER hard deleted.
   */
  async setCustomerStatus({ storeId, actor, customerId, isActive, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await Customer.findOne(
      scopeToStore({ _id: customerId }, storeId)
    ).session(session || null);

    if (!customer) {
      const existsElsewhere = await Customer.findById(customerId).session(session || null);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store', 404);
    }

    const beforeStatus = customer.isActive;
    customer.isActive = Boolean(isActive);
    customer.updatedBy = actor;

    await customer.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId,
      action: customer.isActive ? 'CUSTOMER_ACTIVATE' : 'CUSTOMER_DEACTIVATE',
      entity: 'Customer',
      entityId: customer._id,
      before: { isActive: beforeStatus },
      after: { isActive: customer.isActive },
      reason: customer.isActive ? 'Customer activated' : 'Customer deactivated',
    });

    return formatCustomerForResponse(customer);
  },

  /**
   * Retrieves credit change history for a customer.
   */
  async getCreditHistory({ storeId, customerId, session = null }) {
    if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
      throw new AppError('Invalid customer ID format', 400);
    }

    const customer = await Customer.findOne(
      scopeToStore({ _id: customerId }, storeId)
    ).session(session || null);

    if (!customer) {
      const existsElsewhere = await Customer.findById(customerId).session(session || null);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store', 404);
    }

    const history = await CustomerCreditHistory.find(
      scopeToStore({ customerId }, storeId)
    )
      .sort({ changedAt: -1 })
      .lean()
      .session(session || null);

    return history.map((h) => formatCreditHistoryForResponse(h));
  },

  /**
   * Backfills customerCode for any customer in storeId missing a code,
   * in order of creation.
   */
  async backfillCustomerCodes(storeId, session = null) {
    const missing = await Customer.find(
      scopeToStore(
        {
          $or: [
            { customerCode: { $exists: false } },
            { customerCode: null },
            { customerCode: '' },
          ],
        },
        storeId
      )
    )
      .sort({ createdAt: 1 })
      .session(session || null);

    for (const cust of missing) {
      cust.customerCode = await generateUniqueCustomerCode(storeId, session);
      await cust.save({ session: session || undefined });
    }
  },
};

export default customerService;
