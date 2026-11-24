import mongoose from 'mongoose';
import Invoice, { formatInvoiceForResponse } from '../models/Invoice.js';
import Receipt, { formatReceiptForResponse } from '../models/Receipt.js';
import BillDraft from '../models/BillDraft.js';
import StockMovement from '../models/StockMovement.js';
import Counter, { INVOICE_NO_COUNTER_KEY, RECEIPT_NO_COUNTER_KEY } from '../models/Counter.js';
import Item from '../models/Item.js';
import Customer from '../models/Customer.js';
import Store from '../models/Store.js';
import billingService from './billingService.js';
import stockService from './stockService.js';
import auditService from './auditService.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toPaise, toRupees } from '../utils/money.js';
import { computeTotals } from '../utils/billTotals.js';

/**
 * Generates an auto-incremented, collision-free invoiceNumber (e.g. INV-000001) for the store.
 */
export async function generateUniqueInvoiceNumber(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: INVOICE_NO_COUNTER_KEY }, storeObjectId);

  for (let attempt = 0; attempt < 50; attempt++) {
    let counter = await Counter.findOneAndUpdate(
      filter,
      { $inc: { seq: 1 } },
      { new: true, session: session || undefined }
    );

    if (!counter) {
      try {
        await Counter.updateOne(
          filter,
          { $setOnInsert: { storeId: storeObjectId, key: INVOICE_NO_COUNTER_KEY, seq: 0 } },
          { upsert: true, session: session || undefined }
        );
      } catch (err) {
        if (!err || err.code !== 11000) throw err;
      }
      counter = await Counter.findOneAndUpdate(
        filter,
        { $inc: { seq: 1 } },
        { new: true, session: session || undefined }
      );
    }

    const candidate = `INV-${String(counter.seq).padStart(6, '0')}`;
    const exists = await Invoice.exists(
      scopeToStore({ invoiceNumber: candidate }, storeObjectId)
    ).session(session || null);

    if (!exists) {
      return candidate;
    }
  }

  throw new AppError('Failed to allocate a unique invoice number after multiple attempts.', 500);
}

/**
 * Generates an auto-incremented, collision-free receiptNumber (e.g. REC-000001) for the store.
 */
export async function generateUniqueReceiptNumber(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: RECEIPT_NO_COUNTER_KEY }, storeObjectId);

  for (let attempt = 0; attempt < 50; attempt++) {
    let counter = await Counter.findOneAndUpdate(
      filter,
      { $inc: { seq: 1 } },
      { new: true, session: session || undefined }
    );

    if (!counter) {
      try {
        await Counter.updateOne(
          filter,
          { $setOnInsert: { storeId: storeObjectId, key: RECEIPT_NO_COUNTER_KEY, seq: 0 } },
          { upsert: true, session: session || undefined }
        );
      } catch (err) {
        if (!err || err.code !== 11000) throw err;
      }
      counter = await Counter.findOneAndUpdate(
        filter,
        { $inc: { seq: 1 } },
        { new: true, session: session || undefined }
      );
    }

    const candidate = `REC-${String(counter.seq).padStart(6, '0')}`;
    const exists = await Receipt.exists(
      scopeToStore({ receiptNumber: candidate }, storeObjectId)
    ).session(session || null);

    if (!exists) {
      return candidate;
    }
  }

  throw new AppError('Failed to allocate a unique receipt number after multiple attempts.', 500);
}

/**
 * Atomic Posting Operation:
 * Converts a ready-to-submit BillDraft into an Invoice, records Stock Movements,
 * creates counter Receipts, and links the records.
 * Implements repeat-safe idempotency (UAT-08, UAT-10).
 */
export async function postDraftBill({ storeId, draftId, actor, userRole = 'admin', paymentDetails = {} }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const draftObjectId = new mongoose.Types.ObjectId(String(draftId));

  // 1. Fetch draft scoped to store
  const draft = await BillDraft.findOne(
    scopeToStore({ _id: draftObjectId }, storeObjectId)
  );

  if (!draft) {
    throw new AppError('Bill draft not found', 404);
  }

  // 2. Check for duplicate submission / idempotency retry (UAT-08)
  if (draft.status === 'posted' || draft.invoiceId) {
    const existingInvoice = await Invoice.findOne(
      scopeToStore({ _id: draft.invoiceId }, storeObjectId)
    );
    if (existingInvoice) {
      return {
        invoice: formatInvoiceForResponse(existingInvoice, userRole),
        isDuplicate: true,
        message: 'Draft has already been posted.',
      };
    }
  }

  if (draft.status === 'discarded') {
    throw new AppError('Discarded draft cannot be posted.', 400);
  }

  // 3. Enrich & validate draft state
  const valContext = await billingService.buildValidationContext(storeObjectId, draft);
  const validation = valContext.validation || {};

  if (!validation.readyToSubmit) {
    const firstBlocker = validation.blockers && validation.blockers[0];
    const msg = firstBlocker ? firstBlocker.message : 'Draft is not ready to submit.';
    throw new AppError(`Cannot post bill: ${msg}`, 400);
  }

  const matchedLines = (draft.lines || []).filter((l) => l.status === 'matched');
  if (matchedLines.length === 0) {
    throw new AppError('Cannot post bill: Draft has no matched items.', 400);
  }

  // 4. Live stock balance check immediately before posting (BRD INV-01, UAT-10)
  const itemIds = matchedLines.map((l) => l.itemId.toString());
  const liveStockBalances = await stockService.getStockBalances(storeObjectId, itemIds);

  const totalRequestedByItem = new Map();
  for (const line of matchedLines) {
    const idStr = line.itemId.toString();
    const current = totalRequestedByItem.get(idStr) || 0;
    totalRequestedByItem.set(idStr, current + (Number(line.quantityBase) || 0));
  }

  for (const [idStr, reqQty] of totalRequestedByItem.entries()) {
    const available = Number(liveStockBalances[idStr]) || 0;
    if (reqQty > available) {
      const lineItem = matchedLines.find((l) => l.itemId.toString() === idStr);
      const name = lineItem?.itemName || lineItem?.productCode || idStr;
      throw new AppError(
        `Cannot post bill: Insufficient stock for "${name}". Requested: ${reqQty}, Available: ${available}.`,
        400
      );
    }
  }

  // 5. Customer & Credit checks
  let customerDoc = null;
  let dueDate = null;
  const isCreditBill = draft.billType === 'credit';

  if (draft.customerId) {
    customerDoc = await Customer.findOne(
      scopeToStore({ _id: draft.customerId }, storeObjectId)
    );
    if (!customerDoc || !customerDoc.isActive) {
      throw new AppError('Selected customer is inactive or not found.', 400);
    }

    if (isCreditBill && !customerDoc.creditEnabled) {
      throw new AppError(`Customer "${customerDoc.name}" is not eligible for credit billing.`, 400);
    }

    const creditDays = customerDoc.creditDays || 15;
    dueDate = new Date(Date.now() + creditDays * 24 * 60 * 60 * 1000);
  } else if (isCreditBill) {
    throw new AppError('Credit bill requires an identified customer.', 400);
  }

  // 6. Payment & Settlement breakdown calculation
  const totalPaise = Number(draft.totalPaise) || 0;
  const requestedMode = String(paymentDetails.mode || (isCreditBill ? 'CREDIT' : 'CASH')).toUpperCase();

  let amountReceivedPaise = 0;
  if (paymentDetails.amountReceivedPaise !== undefined) {
    amountReceivedPaise = Number(paymentDetails.amountReceivedPaise);
  } else if (paymentDetails.amountReceived !== undefined) {
    amountReceivedPaise = toPaise(paymentDetails.amountReceived);
  } else {
    amountReceivedPaise = isCreditBill ? 0 : totalPaise;
  }

  let paidPaise = 0;
  let balancePaise = 0;
  let changeReturnedPaise = 0;
  let settlementStatus = 'settled';

  if (!isCreditBill) {
    // Cash bill / Immediate settlement
    if (amountReceivedPaise < totalPaise) {
      throw new AppError(
        `Cash bill requires full counter settlement. Amount received (Rs ${toRupees(amountReceivedPaise)}) is less than total (Rs ${toRupees(totalPaise)}).`,
        400
      );
    }
    paidPaise = totalPaise;
    balancePaise = 0;
    changeReturnedPaise = Math.max(0, amountReceivedPaise - totalPaise);
    settlementStatus = 'settled';
    dueDate = null;
  } else {
    // Credit bill / Partial or Full Credit
    paidPaise = Math.min(totalPaise, Math.max(0, amountReceivedPaise));
    balancePaise = Math.max(0, totalPaise - paidPaise);
    changeReturnedPaise = Math.max(0, amountReceivedPaise - totalPaise);

    if (balancePaise === 0) {
      settlementStatus = 'settled';
    } else if (paidPaise > 0) {
      settlementStatus = 'part_paid';
    } else {
      settlementStatus = 'unpaid';
    }
  }

  // 7. Atomic Execution
  let session = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch {
    session = null; // Fallback if standalone MongoDB without replica set
  }

  try {
    const invoiceNumber = await generateUniqueInvoiceNumber(storeObjectId, session);

    // Build line item snapshots
    const invoiceLines = matchedLines.map((line) => {
      const amountPaise = Number(line.amountPaise) || 0;
      const taxRate = Number(line.taxRatePercent) || 0;
      let taxablePaise = amountPaise;
      let taxPaise = 0;

      if (taxRate > 0) {
        taxablePaise = Math.round((amountPaise * 100) / (100 + taxRate));
        taxPaise = amountPaise - taxablePaise;
      }

      return {
        lineId: line.lineId || new mongoose.Types.ObjectId(),
        itemId: line.itemId,
        productCode: line.productCode,
        itemName: line.itemName,
        specText: line.specText || '',
        unitType: line.unitType,
        unitLabel: line.unitLabel || 'PCS',
        unitsPerPack: Number(line.unitsPerPack) || 1,
        quantity: Number(line.quantity),
        quantityBase: Number(line.quantityBase),
        rateSnapshotPaise: Number(line.rateSnapshotPaise) || 0,
        amountPaise,
        taxRatePercent: taxRate,
        taxablePaise,
        taxPaise,
      };
    });

    const computedTotals = computeTotals(draft.lines, valContext.config);

    // Build totals snapshot
    const totalsSnapshot = {
      subtotalPaise: computedTotals?.subtotalPaise || totalPaise,
      discountPaise: computedTotals?.discountPaise || 0,
      roundOffPaise: computedTotals?.roundOffPaise || 0,
      totalPaise,
      itemCount: invoiceLines.length,
      unitCount: computedTotals?.unitCount || invoiceLines.reduce((acc, l) => acc + l.quantityBase, 0),
      taxBreakup: (computedTotals?.taxBreakup || []).map((tb) => ({
        ratePercent: tb.ratePercent,
        taxablePaise: tb.taxablePaise,
        taxPaise: tb.taxPaise,
        cgstPaise: Math.round(tb.taxPaise / 2),
        sgstPaise: tb.taxPaise - Math.round(tb.taxPaise / 2),
      })),
    };

    // Build customer/walkIn snapshot
    let customerSnapshot = null;
    let walkInSnapshot = null;

    if (customerDoc) {
      customerSnapshot = {
        customerId: customerDoc._id,
        customerCode: customerDoc.customerCode || '',
        name: customerDoc.name,
        mobile: customerDoc.mobile,
        locality: customerDoc.locality || '',
        businessName: customerDoc.businessName || '',
        gstNumber: customerDoc.gstNumber || '',
      };
    } else {
      walkInSnapshot = {
        name: draft.walkIn?.name || 'Walk-in Customer',
        mobile: draft.walkIn?.mobile || '',
      };
    }

    // Build payment snapshot
    const paymentSnapshot = {
      mode: isCreditBill && paidPaise === 0 ? 'CREDIT' : requestedMode,
      amountReceivedPaise,
      paidPaise,
      balancePaise,
      changeReturnedPaise,
      reference: paymentDetails.reference || '',
      notes: paymentDetails.notes || '',
    };

    // 8. Create & save Invoice
    const invoice = new Invoice({
      storeId: storeObjectId,
      invoiceNumber,
      draftId: draft._id,
      draftNumber: draft.draftNumber,
      postingDate: new Date(),
      billType: draft.billType,
      settlementStatus,
      customer: customerSnapshot,
      walkIn: walkInSnapshot,
      lines: invoiceLines,
      totals: totalsSnapshot,
      payment: paymentSnapshot,
      dueDate,
      status: 'posted',
      createdBy: {
        id: actor._id || actor.id,
        name: actor.name || 'Staff',
        role: actor.role || userRole,
      },
    });

    await invoice.save({ session: session || undefined });

    // 9. Create Stock Movement records (SALE) for each line item (BRD INV-01)
    const stockMovements = invoiceLines.map((line) => ({
      storeId: storeObjectId,
      itemId: line.itemId,
      type: 'SALE',
      quantityBase: -Math.abs(line.quantityBase),
      effectiveDate: invoice.postingDate,
      reference: invoice.invoiceNumber,
      reason: `Sale ${invoice.invoiceNumber}`,
      sourceType: 'Sale',
      sourceId: invoice._id,
      sourceLineId: line.lineId,
      createdBy: {
        id: actor._id || actor.id,
        name: actor.name || 'Staff',
        role: actor.role || userRole,
      },
      createdAt: new Date(),
    }));

    await StockMovement.insertMany(stockMovements, { session: session || undefined });

    // 10. Create initial Receipt if any amount was received at the counter
    let receiptDoc = null;
    if (paidPaise > 0) {
      const receiptNumber = await generateUniqueReceiptNumber(storeObjectId, session);
      receiptDoc = new Receipt({
        storeId: storeObjectId,
        receiptNumber,
        invoiceId: invoice._id,
        invoiceNumber: invoice.invoiceNumber,
        customerId: customerDoc ? customerDoc._id : null,
        receiptDate: invoice.postingDate,
        amountPaise: paidPaise,
        mode: ['CASH', 'UPI', 'CARD'].includes(requestedMode) ? requestedMode : 'CASH',
        reference: paymentDetails.reference || '',
        notes: paymentDetails.notes || '',
        collectedBy: {
          id: actor._id || actor.id,
          name: actor.name || 'Staff',
          role: actor.role || userRole,
        },
        status: 'confirmed',
      });

      await receiptDoc.save({ session: session || undefined });
    }

    // 11. Mark Draft as posted
    draft.status = 'posted';
    draft.invoiceId = invoice._id;
    await draft.save({ session: session || undefined });

    // 12. Audit log
    await auditService.log({
      storeId: storeObjectId,
      actor,
      action: 'POST_BILL',
      entity: 'Invoice',
      entityId: invoice._id,
      after: {
        invoiceNumber: invoice.invoiceNumber,
        draftNumber: draft.draftNumber,
        total: toRupees(totalPaise),
        settlementStatus,
        paid: toRupees(paidPaise),
      },
    });

    if (session) {
      await session.commitTransaction();
    }

    return {
      invoice: formatInvoiceForResponse(invoice, userRole),
      receipt: receiptDoc ? formatReceiptForResponse(receiptDoc) : null,
      isDuplicate: false,
    };
  } catch (err) {
    if (session) {
      await session.abortTransaction();
    }
    throw err;
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

/**
 * Retrieves a single posted invoice by ID.
 */
export async function getInvoiceById({ storeId, invoiceId, actor, userRole = 'admin' }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const invoiceObjectId = new mongoose.Types.ObjectId(String(invoiceId));

  const invoice = await Invoice.findOne(
    scopeToStore({ _id: invoiceObjectId }, storeObjectId)
  );

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  return formatInvoiceForResponse(invoice, userRole);
}

/**
 * Lists posted invoices for the store with filtering, searching, and pagination.
 */
export async function listInvoices({ storeId, actor, userRole = 'admin', query = {} }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = scopeToStore({}, storeObjectId);

  if (query.billType) {
    filter.billType = query.billType;
  }
  if (query.settlementStatus) {
    filter.settlementStatus = query.settlementStatus;
  }
  if (query.customerId) {
    filter['customer.customerId'] = new mongoose.Types.ObjectId(String(query.customerId));
  }

  if (query.search && String(query.search).trim()) {
    const s = String(query.search).trim();
    const regex = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { invoiceNumber: regex },
      { draftNumber: regex },
      { 'customer.name': regex },
      { 'customer.mobile': regex },
      { 'walkIn.name': regex },
      { 'walkIn.mobile': regex },
    ];
  }

  const [invoices, total] = await Promise.all([
    Invoice.find(filter)
      .sort({ postingDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  return {
    data: invoices.map((inv) => formatInvoiceForResponse(inv, userRole)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Returns formatted print receipt data for thermal / counter printing (BRD Section 06).
 */
export async function getInvoicePrintData({ storeId, invoiceId, actor, userRole = 'admin' }) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const invoiceObjectId = new mongoose.Types.ObjectId(String(invoiceId));

  const [invoice, store] = await Promise.all([
    Invoice.findOne(scopeToStore({ _id: invoiceObjectId }, storeObjectId)),
    Store.findById(storeObjectId),
  ]);

  if (!invoice) {
    throw new AppError('Invoice not found', 404);
  }

  const invoiceData = formatInvoiceForResponse(invoice, 'admin'); // Print includes item amounts

  const addr = store?.address;
  const formattedAddress = addr
    ? [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')
    : '';

  return {
    store: {
      name: store?.name || 'Retail Store',
      address: formattedAddress,
      gstin: store?.gstin || '',
      phone: store?.phone || '',
    },
    invoice: invoiceData,
  };
}

export default {
  generateUniqueInvoiceNumber,
  generateUniqueReceiptNumber,
  postDraftBill,
  getInvoiceById,
  listInvoices,
  getInvoicePrintData,
};
