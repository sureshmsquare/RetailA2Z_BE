import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Receipt, { formatReceiptForResponse } from '../models/Receipt.js';
import Store from '../models/Store.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toRupees } from '../utils/money.js';
import { daysBetweenInStoreTz } from '../utils/storeDate.js';
import { generateUniqueReceiptNumber } from './salesService.js';
import auditService from './auditService.js';

const OPEN_SETTLEMENT_STATUSES = ['unpaid', 'part_paid'];
const VALID_PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'OTHER'];

function computeOverdueDays(dueDate, now, storeTimezone) {
  if (!dueDate) return 0;
  const diff = daysBetweenInStoreTz(dueDate, now, storeTimezone);
  return diff > 0 ? diff : 0;
}

/**
 * Lists customers with open receivables (unpaid or part_paid posted invoices)
 * scoped to the authenticated store.
 */
export async function listCollectionCustomers({ storeId, query = {} }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const now = new Date();

  const [openInvoices, store] = await Promise.all([
    Invoice.find(
      scopeToStore(
        {
          status: 'posted',
          settlementStatus: { $in: OPEN_SETTLEMENT_STATUSES },
          'customer.customerId': { $ne: null },
        },
        storeObjectId
      )
    )
      .select('customer payment dueDate postingDate settlementStatus')
      .lean(),
    Store.findById(storeObjectId).select('timezone').lean(),
  ]);

  const storeTimezone = store?.timezone || 'Asia/Kolkata';

  // Aggregate open balances per customer in integer paise
  const customerAggMap = new Map();
  for (const inv of openInvoices) {
    const custId = inv.customer?.customerId ? String(inv.customer.customerId) : null;
    if (!custId) continue;

    const balancePaise = Math.max(0, Math.round(Number(inv.payment?.balancePaise) || 0));
    if (balancePaise <= 0) continue;

    const overdueDays = computeOverdueDays(inv.dueDate, now, storeTimezone);
    const isOverdue = overdueDays > 0;

    let entry = customerAggMap.get(custId);
    if (!entry) {
      entry = {
        customerId: custId,
        name: inv.customer?.name || 'Customer',
        mobile: inv.customer?.mobile || '',
        customerCode: inv.customer?.customerCode || '',
        totalOutstandingPaise: 0,
        totalOverduePaise: 0,
        oldestOverdueDays: 0,
        invoiceCount: 0,
      };
      customerAggMap.set(custId, entry);
    }

    entry.totalOutstandingPaise += balancePaise;
    if (isOverdue) {
      entry.totalOverduePaise += balancePaise;
      if (overdueDays > entry.oldestOverdueDays) {
        entry.oldestOverdueDays = overdueDays;
      }
    }
    entry.invoiceCount += 1;
  }

  // Enrich with fresh Customer details scoped to the store
  const customerIds = Array.from(customerAggMap.keys()).map(
    (id) => new mongoose.Types.ObjectId(id)
  );
  if (customerIds.length > 0) {
    const customerDocs = await Customer.find(
      scopeToStore({ _id: { $in: customerIds } }, storeObjectId)
    )
      .select('name mobile normalizedMobile customerCode businessName')
      .lean();

    for (const cust of customerDocs) {
      const entry = customerAggMap.get(String(cust._id));
      if (entry) {
        entry.name = cust.name || entry.name;
        entry.mobile = cust.mobile || entry.mobile;
        entry.normalizedMobile = cust.normalizedMobile || '';
        entry.customerCode = cust.customerCode || entry.customerCode;
        entry.businessName = cust.businessName || '';
      }
    }
  }

  const allRows = Array.from(customerAggMap.values());

  // Store-wide summary KPI totals across all customers with open balances
  let summaryOutstandingPaise = 0;
  let summaryOverduePaise = 0;
  let customersWithOverdueCount = 0;
  for (const row of allRows) {
    summaryOutstandingPaise += row.totalOutstandingPaise;
    summaryOverduePaise += row.totalOverduePaise;
    if (row.totalOverduePaise > 0) {
      customersWithOverdueCount += 1;
    }
  }

  // Apply overdueOnly and search filters
  const overdueOnly = String(query.overdueOnly).toLowerCase() === 'true';
  const search = query.search ? String(query.search).trim().toLowerCase() : '';
  const searchDigits = search.replace(/\D/g, '');

  const filtered = allRows.filter((row) => {
    if (overdueOnly && row.totalOverduePaise <= 0) {
      return false;
    }
    if (search) {
      const nameMatch = (row.name || '').toLowerCase().includes(search);
      const mobileMatch = (row.mobile || '').toLowerCase().includes(search);
      const normMobileMatch =
        searchDigits.length > 0 && (row.normalizedMobile || '').includes(searchDigits);
      const codeMatch = (row.customerCode || '').toLowerCase().includes(search);
      if (!nameMatch && !mobileMatch && !normMobileMatch && !codeMatch) {
        return false;
      }
    }
    return true;
  });

  // Sort by highest overdue first, then oldest overdue days, then highest outstanding
  filtered.sort((a, b) => {
    if (b.totalOverduePaise !== a.totalOverduePaise) {
      return b.totalOverduePaise - a.totalOverduePaise;
    }
    if (b.oldestOverdueDays !== a.oldestOverdueDays) {
      return b.oldestOverdueDays - a.oldestOverdueDays;
    }
    if (b.totalOutstandingPaise !== a.totalOutstandingPaise) {
      return b.totalOutstandingPaise - a.totalOutstandingPaise;
    }
    return (a.name || '').localeCompare(b.name || '');
  });

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const total = filtered.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const skip = (page - 1) * limit;
  const paginatedRows = filtered.slice(skip, skip + limit).map((row) => ({
    customerId: row.customerId,
    name: row.name,
    mobile: row.mobile,
    customerCode: row.customerCode || '',
    totalOutstandingPaise: row.totalOutstandingPaise,
    totalOverduePaise: row.totalOverduePaise,
    oldestOverdueDays: row.oldestOverdueDays,
    invoiceCount: row.invoiceCount,
    totalOutstanding: toRupees(row.totalOutstandingPaise),
    totalOverdue: toRupees(row.totalOverduePaise),
  }));

  return {
    data: paginatedRows,
    summary: {
      totalOutstandingPaise: summaryOutstandingPaise,
      totalOverduePaise: summaryOverduePaise,
      customersWithOverdueCount,
      totalCustomersCount: allRows.length,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

/**
 * Lists all open (unpaid / part_paid) posted invoices for a given customer in the store,
 * ordered oldest due date / posting date first.
 */
export async function listCustomerOpenInvoices({ storeId, customerId }) {
  if (!mongoose.Types.ObjectId.isValid(String(customerId))) {
    throw new AppError('Invalid customer ID format', 400);
  }

  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const customerObjectId = new mongoose.Types.ObjectId(String(customerId));
  const now = new Date();

  const [customer, store] = await Promise.all([
    Customer.findOne(scopeToStore({ _id: customerObjectId }, storeObjectId)).lean(),
    Store.findById(storeObjectId).select('timezone').lean(),
  ]);

  if (!customer) {
    const existsElsewhere = await Customer.findById(customerObjectId).select('_id').lean();
    if (existsElsewhere) {
      throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
    }
    throw new AppError('Customer not found in this store', 404);
  }

  const storeTimezone = store?.timezone || 'Asia/Kolkata';

  const openInvoices = await Invoice.find(
    scopeToStore(
      {
        'customer.customerId': customerObjectId,
        status: 'posted',
        settlementStatus: { $in: OPEN_SETTLEMENT_STATUSES },
      },
      storeObjectId
    )
  )
    .sort({ dueDate: 1, postingDate: 1, createdAt: 1 })
    .lean();

  let totalOutstandingPaise = 0;
  let totalOverduePaise = 0;
  let oldestOverdueDays = 0;

  const formattedInvoices = [];
  for (const inv of openInvoices) {
    const balanceDuePaise = Math.max(0, Math.round(Number(inv.payment?.balancePaise) || 0));
    if (balanceDuePaise <= 0) continue;

    const billAmountPaise = Math.max(0, Math.round(Number(inv.totals?.totalPaise) || 0));
    const paidAmountPaise = Math.max(0, Math.round(Number(inv.payment?.paidPaise) || 0));
    const overdueDays = computeOverdueDays(inv.dueDate, now, storeTimezone);

    totalOutstandingPaise += balanceDuePaise;
    if (overdueDays > 0) {
      totalOverduePaise += balanceDuePaise;
      if (overdueDays > oldestOverdueDays) {
        oldestOverdueDays = overdueDays;
      }
    }

    formattedInvoices.push({
      invoiceId: String(inv._id),
      invoiceNumber: inv.invoiceNumber,
      postingDate: inv.postingDate,
      dueDate: inv.dueDate || null,
      billAmountPaise,
      paidAmountPaise,
      balanceDuePaise,
      overdueDays,
      settlementStatus: inv.settlementStatus,
    });
  }

  return {
    customer: {
      customerId: String(customer._id),
      customerCode: customer.customerCode || '',
      name: customer.name,
      mobile: customer.mobile,
      totalOutstandingPaise,
      totalOverduePaise,
      oldestOverdueDays,
      invoiceCount: formattedInvoices.length,
    },
    invoices: formattedInvoices,
  };
}

/**
 * Records an external collection receipt and allocates integer paise amounts
 * across selected open invoices atomically using a MongoDB transaction.
 */
export async function recordReceipt({ storeId, actor, payload = {} }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

  const {
    customerId,
    amountPaise: rawAmountPaise,
    mode: rawMode,
    reference = '',
    notes = '',
    allocations = [],
  } = payload;

  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) {
    throw new AppError('Valid customerId is required.', 400);
  }
  const customerObjectId = new mongoose.Types.ObjectId(String(customerId));

  const amountPaise =
    typeof rawAmountPaise === 'boolean' ? NaN : Number(rawAmountPaise);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('amountPaise must be a positive integer.', 400);
  }

  const mode = String(rawMode || '').trim().toUpperCase();
  if (!VALID_PAYMENT_MODES.includes(mode)) {
    throw new AppError(
      `Invalid payment mode. Must be one of: ${VALID_PAYMENT_MODES.join(', ')}.`,
      400
    );
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new AppError('At least one invoice allocation is required.', 400);
  }

  const normalizedAllocations = [];
  const seenInvoiceIds = new Set();
  let totalAllocatedPaise = 0;

  for (const item of allocations) {
    const invIdStr = String(item?.invoiceId || '').trim();
    if (!invIdStr || !mongoose.Types.ObjectId.isValid(invIdStr)) {
      throw new AppError('Each allocation must include a valid invoiceId.', 400);
    }
    if (seenInvoiceIds.has(invIdStr)) {
      throw new AppError(`Duplicate invoiceId in allocations: ${invIdStr}.`, 400);
    }
    seenInvoiceIds.add(invIdStr);

    const allocatedAmountPaise =
      typeof item?.allocatedAmountPaise === 'boolean'
        ? NaN
        : Number(item?.allocatedAmountPaise);
    if (!Number.isInteger(allocatedAmountPaise) || allocatedAmountPaise <= 0) {
      throw new AppError(
        `allocatedAmountPaise must be a positive integer for invoice ${invIdStr}.`,
        400
      );
    }

    totalAllocatedPaise += allocatedAmountPaise;
    normalizedAllocations.push({
      invoiceId: new mongoose.Types.ObjectId(invIdStr),
      invoiceIdStr: invIdStr,
      allocatedAmountPaise,
    });
  }

  if (totalAllocatedPaise !== amountPaise) {
    throw new AppError(
      `Sum of allocated amounts (${totalAllocatedPaise} paise) must equal amountPaise (${amountPaise} paise).`,
      400
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Verify customer belongs to this store
    const customer = await Customer.findOne(
      scopeToStore({ _id: customerObjectId }, storeObjectId)
    ).session(session);

    if (!customer) {
      const existsElsewhere = await Customer.findById(customerObjectId)
        .select('_id')
        .session(session);
      if (existsElsewhere) {
        throw new AppError('Access denied: Customer does not belong to the selected store.', 403);
      }
      throw new AppError('Customer not found in this store.', 404);
    }

    // 2. Fetch all target invoices within store & customer scope inside transaction
    const invoiceObjectIds = normalizedAllocations.map((a) => a.invoiceId);
    const invoices = await Invoice.find(
      scopeToStore(
        {
          _id: { $in: invoiceObjectIds },
          'customer.customerId': customerObjectId,
          status: 'posted',
        },
        storeObjectId
      )
    ).session(session);

    const invoiceMap = new Map(invoices.map((inv) => [String(inv._id), inv]));

    // Validate each invoice's state & open balance before applying updates
    const enrichedAllocations = [];
    for (const alloc of normalizedAllocations) {
      const invoice = invoiceMap.get(alloc.invoiceIdStr);
      if (!invoice) {
        throw new AppError(
          `Invoice ${alloc.invoiceIdStr} not found for this customer in the selected store.`,
          404
        );
      }

      if (!OPEN_SETTLEMENT_STATUSES.includes(invoice.settlementStatus)) {
        throw new AppError(
          `Invoice ${invoice.invoiceNumber} is already settled and cannot accept allocations.`,
          400
        );
      }

      const balanceDuePaise = Math.max(0, Math.round(Number(invoice.payment?.balancePaise) || 0));
      if (alloc.allocatedAmountPaise > balanceDuePaise) {
        throw new AppError(
          `Allocated amount (${alloc.allocatedAmountPaise} paise) exceeds balance due (${balanceDuePaise} paise) for invoice ${invoice.invoiceNumber}.`,
          400
        );
      }

      enrichedAllocations.push({
        invoice,
        allocatedAmountPaise: alloc.allocatedAmountPaise,
        balanceBeforePaise: balanceDuePaise,
      });
    }

    // 3. Allocate receipt number and persist Receipt
    const receiptNumber = await generateUniqueReceiptNumber(storeObjectId, session);
    const receiptAllocations = enrichedAllocations.map((item) => ({
      invoiceId: item.invoice._id,
      invoiceNumber: item.invoice.invoiceNumber,
      allocatedAmountPaise: item.allocatedAmountPaise,
    }));

    const isSingleInvoice = receiptAllocations.length === 1;
    const receiptDoc = new Receipt({
      storeId: storeObjectId,
      receiptNumber,
      invoiceId: isSingleInvoice ? receiptAllocations[0].invoiceId : null,
      invoiceNumber: isSingleInvoice ? receiptAllocations[0].invoiceNumber : '',
      allocations: receiptAllocations,
      customerId: customerObjectId,
      receiptDate: new Date(),
      amountPaise,
      mode,
      reference: String(reference || '').trim(),
      notes: String(notes || '').trim(),
      collectedBy: {
        id: actor?._id ? String(actor._id) : actor?.id ? String(actor.id) : null,
        name: actor?.name || 'Staff',
        role: actor?.role || 'collections',
      },
      status: 'confirmed',
    });

    await receiptDoc.save({ session });

    // 4. Update each Invoice's paidPaise, balancePaise, and settlementStatus
    const updatedInvoices = [];
    for (const item of enrichedAllocations) {
      const { invoice, allocatedAmountPaise, balanceBeforePaise } = item;
      const currentPaidPaise = Math.max(0, Math.round(Number(invoice.payment?.paidPaise) || 0));
      const newPaidPaise = currentPaidPaise + allocatedAmountPaise;
      const newBalancePaise = balanceBeforePaise - allocatedAmountPaise;
      const newStatus = newBalancePaise === 0 ? 'settled' : 'part_paid';

      invoice.payment.paidPaise = newPaidPaise;
      invoice.payment.balancePaise = newBalancePaise;
      invoice.settlementStatus = newStatus;

      await invoice.save({ session });

      updatedInvoices.push({
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber,
        allocatedAmountPaise,
        paidAmountPaise: newPaidPaise,
        balanceDuePaise: newBalancePaise,
        settlementStatus: newStatus,
      });
    }

    // 5. Commit atomic transaction
    await session.commitTransaction();

    // 6. Write AuditLog entry (non-blocking helper, matches salesService pattern)
    await auditService.log({
      storeId: storeObjectId,
      actor,
      action: 'RECEIPT_RECORDED',
      entity: 'Receipt',
      entityId: receiptDoc._id,
      after: {
        receiptNumber: receiptDoc.receiptNumber,
        customerId: String(customerObjectId),
        customerName: customer.name,
        amountPaise,
        amount: toRupees(amountPaise),
        mode,
        reference: receiptDoc.reference,
        allocations: receiptAllocations.map((a) => ({
          invoiceId: String(a.invoiceId),
          invoiceNumber: a.invoiceNumber,
          allocatedAmountPaise: a.allocatedAmountPaise,
        })),
      },
      reason: receiptDoc.notes || 'Collection receipt recorded',
    });

    return {
      receipt: formatReceiptForResponse(receiptDoc),
      updatedInvoices,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export default {
  listCollectionCustomers,
  listCustomerOpenInvoices,
  recordReceipt,
};
