import mongoose from 'mongoose';
import BillDraft from '../models/BillDraft.js';
import Item from '../models/Item.js';
import Customer from '../models/Customer.js';
import Counter from '../models/Counter.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toRupees } from '../utils/money.js';
import { normalizeIndianMobile } from '../utils/phone.js';
import { computeLineAmount, computeTotals } from '../utils/billTotals.js';
import { parseEntryText } from './billEntryParser.js';
import { getCreditProfile, getCustomerCredit } from './customerCreditAdapter.js';
import { evaluateDraft } from './billValidationService.js';
import { stockService } from './stockService.js';
import auditService from './auditService.js';
import { serializeDraftForRole } from '../utils/serializer.js';
import billingConfig from '../config/billingConfig.js';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates an auto-incremented, collision-free draftNumber (e.g. D-000001) for the store.
 */
export async function generateUniqueDraftNumber(storeId, session = null) {
  const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
  const filter = scopeToStore({ key: 'draftNo' }, storeObjectId);

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
          { $setOnInsert: { storeId: storeObjectId, key: 'draftNo', seq: 0 } },
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

    const candidate = `D-${String(counter.seq).padStart(6, '0')}`;
    const exists = await BillDraft.exists(
      scopeToStore({ draftNumber: candidate }, storeObjectId)
    ).session(session || null);

    if (!exists) {
      return candidate;
    }
  }

  return `D-${Date.now().toString().slice(-6)}`;
}

/**
 * Invalidate approvals hook.
 * Resets approval placeholders and increments draft version.
 * TODO: Approvals module will expand this to invalidate pending/approved discounts.
 */
export function invalidateApprovals(draft) {
  draft.version = (draft.version || 1) + 1;
  draft.discountStatus = 'none';
  draft.discountPaise = 0;
}

/**
 * Prepares validation context and evaluates the draft against live store data.
 */
export async function buildValidationContext(storeId, draft, session = null) {
  const lines = draft.lines || [];
  const itemIds = lines
    .map((l) => l.itemId)
    .filter(Boolean)
    .map((id) => id.toString());

  const uniqueItemIds = [...new Set(itemIds)];

  let itemsMap = new Map();
  let stockBalances = {};

  if (uniqueItemIds.length > 0) {
    const objectIds = uniqueItemIds.map((id) => new mongoose.Types.ObjectId(id));
    const items = await Item.find(
      scopeToStore({ _id: { $in: objectIds } }, storeId)
    )
      .session(session || null)
      .lean();

    for (const item of items) {
      itemsMap.set(item._id.toString(), item);
    }

    stockBalances = await stockService.getStockBalances(storeId, uniqueItemIds, session);
  }

  let creditProfile = null;
  if (draft.customerId) {
    creditProfile = await getCreditProfile(storeId, draft.customerId, session);
  }

  const validation = evaluateDraft(draft, {
    itemsMap,
    stockBalances,
    creditProfile,
    config: billingConfig,
  });

  return {
    itemsMap,
    stockBalances,
    creditProfile,
    validation,
    config: billingConfig,
  };
}

/**
 * Formats specText from Item fields: classSeries, size, length, variant.
 */
function buildSpecText(item) {
  if (!item) return '';
  return [item.classSeries, item.size, item.length, item.variant].filter(Boolean).join(' ').trim();
}

/**
 * Billing Service - All business logic and database queries for Bill Drafts.
 */
export const billingService = {
  buildValidationContext,
  /**
   * Creates a new bill draft.
   */
  async createDraft({ storeId, actor, userRole, data = {}, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const billType = data.billType === 'credit' ? 'credit' : 'cash';

    let customerId = null;
    if (data.customerId) {
      const customer = await Customer.findOne(
        scopeToStore({ _id: data.customerId }, storeObjectId)
      ).session(session || null);

      if (!customer) {
        throw new AppError('Customer not found in this store', 400);
      }
      if (!customer.isActive) {
        throw new AppError('Customer account is inactive', 400);
      }
      customerId = customer._id;
    }

    // WalkIn normalization
    let walkIn = { name: '', mobile: '' };
    if (data.walkIn && typeof data.walkIn === 'object') {
      const rawName = String(data.walkIn.name || '').trim().slice(0, 100);
      const rawMobile = data.walkIn.mobile ? String(data.walkIn.mobile).trim() : '';
      const normalized = normalizeIndianMobile(rawMobile);
      walkIn = {
        name: rawName,
        mobile: normalized || rawMobile,
      };
    }

    const draftNumber = await generateUniqueDraftNumber(storeObjectId, session);

    const draft = new BillDraft({
      storeId: storeObjectId,
      draftNumber,
      ownerId: actor._id,
      billType,
      customerId,
      walkIn,
      lines: [],
      status: 'open',
      version: 1,
      totalPaise: 0,
      discountStatus: 'none',
      discountPaise: 0,
      pricedAt: new Date(),
      createdBy: {
        id: actor._id.toString(),
        name: actor.name || 'Unknown',
        role: userRole,
      },
      updatedBy: {
        id: actor._id.toString(),
        name: actor.name || 'Unknown',
        role: userRole,
      },
    });

    await draft.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId: storeObjectId,
      action: 'DRAFT_CREATE',
      entity: 'BillDraft',
      entityId: draft._id,
      after: { draftNumber, billType, customerId },
    });

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Updates top-level bill draft attributes (billType, customerId, walkIn).
   */
  async updateDraft({ storeId, actor, userRole, draftId, data = {}, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded or finalized draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    // Optimistic concurrency check
    if (data.expectedVersion !== undefined && data.expectedVersion !== null) {
      if (parseInt(data.expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    if (data.billType !== undefined) {
      draft.billType = data.billType === 'credit' ? 'credit' : 'cash';
    }

    if (data.customerId !== undefined) {
      if (data.customerId === null || data.customerId === '') {
        draft.customerId = null;
      } else {
        const customer = await Customer.findOne(
          scopeToStore({ _id: data.customerId }, storeObjectId)
        ).session(session || null);

        if (!customer) {
          throw new AppError('Customer not found in this store', 400);
        }
        if (!customer.isActive) {
          throw new AppError('Customer account is inactive', 400);
        }
        draft.customerId = customer._id;
      }
    }

    if (data.walkIn !== undefined) {
      const rawName = String(data.walkIn?.name || '').trim().slice(0, 100);
      const rawMobile = data.walkIn?.mobile ? String(data.walkIn.mobile).trim() : '';
      const normalized = normalizeIndianMobile(rawMobile);
      draft.walkIn = {
        name: rawName,
        mobile: normalized || rawMobile,
      };
    }

    invalidateApprovals(draft);
    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Parses entry text and resolves item codes against the database in ONE query.
   */
  async parseAndAddLines({ storeId, actor, userRole, draftId, text, expectedVersion, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    // Optimistic concurrency check
    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (parseInt(expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    const entries = parseEntryText(text);

    // Collect unique non-problem product codes
    const codeCandidates = entries
      .filter((e) => e.codeText && !e.problem)
      .map((e) => e.codeText);

    const uniqueCodes = [...new Set(codeCandidates)];

    // Fetch matching items in ONE query
    let itemsByCode = new Map();
    if (uniqueCodes.length > 0) {
      const codeRegexes = uniqueCodes.map((c) => new RegExp(`^${escapeRegex(c)}$`, 'i'));
      const items = await Item.find(
        scopeToStore({ productCode: { $in: codeRegexes } }, storeObjectId)
      )
        .session(session || null)
        .lean();

      for (const item of items) {
        itemsByCode.set(item.productCode.toLowerCase(), item);
      }
    }

    let matchedCount = 0;
    let unclearCount = 0;
    let mergedCount = 0;

    for (const entry of entries) {
      if (draft.lines.length >= billingConfig.MAX_LINES_PER_DRAFT) {
        throw new AppError(`Maximum limit of ${billingConfig.MAX_LINES_PER_DRAFT} lines per draft reached`, 400);
      }

      // 1. Parser problem
      if (entry.problem) {
        unclearCount += 1;
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: null,
          productCode: entry.codeText || '',
          itemName: '',
          specText: '',
          unitType: 'UNIT',
          unitsPerPack: 1,
          unitLabel: 'PCS',
          quantity: entry.quantity && entry.quantity > 0 ? entry.quantity : 1,
          quantityBase: entry.quantity && entry.quantity > 0 ? entry.quantity : 1,
          rateSnapshotPaise: 0,
          amountPaise: 0,
          unclearReason: entry.problem,
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
        continue;
      }

      // 2. Unit token problem
      if (entry.unitToken !== 'UNIT' && entry.unitToken !== 'PACK') {
        unclearCount += 1;
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: null,
          productCode: entry.codeText || '',
          itemName: '',
          specText: '',
          unitType: 'UNIT',
          unitsPerPack: 1,
          unitLabel: 'PCS',
          quantity: entry.quantity,
          quantityBase: entry.quantity,
          rateSnapshotPaise: 0,
          amountPaise: 0,
          unclearReason: 'invalid_unit',
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
        continue;
      }

      const item = itemsByCode.get((entry.codeText || '').toLowerCase());

      // 3. Item not found
      if (!item) {
        unclearCount += 1;
        // Suggestions: up to 5 active and priced items whose productCode starts with or contains the codeText
        const suggestions = await Item.find(
          scopeToStore(
            {
              status: 'active',
              sellingPricePaise: { $ne: null },
              productCode: new RegExp(escapeRegex(entry.codeText || ''), 'i'),
            },
            storeObjectId
          )
        )
          .session(session || null)
          .limit(5)
          .select('_id productCode name')
          .lean();

        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: null,
          productCode: entry.codeText || '',
          itemName: '',
          specText: '',
          unitType: entry.unitToken,
          unitsPerPack: 1,
          unitLabel: 'PCS',
          quantity: entry.quantity,
          quantityBase: entry.quantity,
          rateSnapshotPaise: 0,
          amountPaise: 0,
          unclearReason: 'not_found',
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: suggestions.map((s) => ({
            itemId: s._id,
            productCode: s.productCode,
            name: s.name,
          })),
          addedAt: new Date(),
        });
        continue;
      }

      // 4. Unpriced / draft item
      if (item.status === 'draft' || item.sellingPricePaise === null || item.sellingPricePaise === undefined) {
        unclearCount += 1;
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: item._id,
          productCode: item.productCode,
          itemName: item.name,
          specText: buildSpecText(item),
          unitType: entry.unitToken,
          unitsPerPack: item.unitsPerPack || 1,
          unitLabel: item.sellingUnit || 'PCS',
          quantity: entry.quantity,
          quantityBase: entry.quantity,
          rateSnapshotPaise: 0,
          amountPaise: 0,
          unclearReason: 'not_priced',
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
        continue;
      }

      // 5. Inactive item
      if (item.status === 'inactive' || item.status !== 'active') {
        unclearCount += 1;
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: item._id,
          productCode: item.productCode,
          itemName: item.name,
          specText: buildSpecText(item),
          unitType: entry.unitToken,
          unitsPerPack: item.unitsPerPack || 1,
          unitLabel: item.sellingUnit || 'PCS',
          quantity: entry.quantity,
          quantityBase: entry.quantity,
          rateSnapshotPaise: 0,
          amountPaise: 0,
          unclearReason: 'inactive',
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
        continue;
      }

      // 6. PACK validation
      if (entry.unitToken === 'PACK' && (!item.unitsPerPack || item.unitsPerPack <= 1)) {
        unclearCount += 1;
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'unclear',
          itemId: item._id,
          productCode: item.productCode,
          itemName: item.name,
          specText: buildSpecText(item),
          unitType: 'PACK',
          unitsPerPack: 1,
          unitLabel: item.sellingUnit || 'PCS',
          quantity: entry.quantity,
          quantityBase: entry.quantity,
          rateSnapshotPaise: item.sellingPricePaise,
          amountPaise: 0,
          unclearReason: 'no_pack_conversion',
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
        continue;
      }

      // 7. Matched Line
      matchedCount += 1;
      const unitsPerPack = entry.unitToken === 'PACK' ? Number(item.unitsPerPack || 1) : 1;
      const quantityBase = entry.unitToken === 'PACK'
        ? Math.round(Number(entry.quantity) * unitsPerPack * 1000) / 1000
        : Number(entry.quantity);
      const amountPaise = computeLineAmount(quantityBase, item.sellingPricePaise);

      // Check merge rule: identical itemId and unitType
      const existingLine = draft.lines.find(
        (l) =>
          l.status === 'matched' &&
          l.itemId &&
          l.itemId.toString() === item._id.toString() &&
          l.unitType === entry.unitToken
      );

      if (existingLine) {
        mergedCount += 1;
        existingLine.quantity = Math.round((existingLine.quantity + entry.quantity) * 1000) / 1000;
        existingLine.quantityBase =
          existingLine.unitType === 'PACK'
            ? Math.round(existingLine.quantity * unitsPerPack * 1000) / 1000
            : existingLine.quantity;
        existingLine.amountPaise = computeLineAmount(
          existingLine.quantityBase,
          existingLine.rateSnapshotPaise
        );
      } else {
        draft.lines.push({
          lineId: new mongoose.Types.ObjectId(),
          status: 'matched',
          itemId: item._id,
          productCode: item.productCode,
          itemName: item.name,
          specText: buildSpecText(item),
          unitType: entry.unitToken,
          unitsPerPack,
          unitLabel: item.sellingUnit || 'PCS',
          quantity: entry.quantity,
          quantityBase,
          rateSnapshotPaise: item.sellingPricePaise,
          amountPaise,
          unclearReason: null,
          inputText: entry.inputText,
          sourceKind: 'typed',
          suggestions: [],
          addedAt: new Date(),
        });
      }
    }

    invalidateApprovals(draft);
    draft.pricedAt = new Date();

    const totals = computeTotals(draft.lines, billingConfig);
    draft.totalPaise = totals.totalPaise;

    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);

    return {
      draft: serializeDraftForRole(draft, userRole, context),
      parseSummary: {
        entries: entries.length,
        matched: matchedCount,
        unclear: unclearCount,
        merged: mergedCount,
      },
    };
  },

  /**
   * Adds a single line from the Find Item search UI.
   */
  async addLineByItem({ storeId, actor, userRole, draftId, data = {}, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    if (data.expectedVersion !== undefined && data.expectedVersion !== null) {
      if (parseInt(data.expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    if (draft.lines.length >= billingConfig.MAX_LINES_PER_DRAFT) {
      throw new AppError(`Maximum limit of ${billingConfig.MAX_LINES_PER_DRAFT} lines per draft reached`, 400);
    }

    const item = await Item.findOne(
      scopeToStore({ _id: data.itemId }, storeObjectId)
    ).session(session || null);

    if (!item) {
      throw new AppError('Item not found', 400);
    }
    if (item.status !== 'active') {
      throw new AppError('Cannot add an inactive item', 400);
    }
    if (item.sellingPricePaise === null || item.sellingPricePaise === undefined) {
      throw new AppError('Cannot add an item without a selling price', 400);
    }

    const unitType = data.unitType === 'PACK' ? 'PACK' : 'UNIT';
    if (unitType === 'PACK' && (!item.unitsPerPack || item.unitsPerPack <= 1)) {
      throw new AppError('Item has no pack conversion', 400);
    }

    const quantity = Number(data.quantity);
    const unitsPerPack = unitType === 'PACK' ? Number(item.unitsPerPack || 1) : 1;
    const quantityBase = unitType === 'PACK'
      ? Math.round(quantity * unitsPerPack * 1000) / 1000
      : quantity;
    const amountPaise = computeLineAmount(quantityBase, item.sellingPricePaise);

    // Merge check
    const existingLine = draft.lines.find(
      (l) =>
        l.status === 'matched' &&
        l.itemId &&
        l.itemId.toString() === item._id.toString() &&
        l.unitType === unitType
    );

    let mergedInto = null;
    if (existingLine) {
      mergedInto = existingLine.lineId.toString();
      existingLine.quantity = Math.round((existingLine.quantity + quantity) * 1000) / 1000;
      existingLine.quantityBase =
        existingLine.unitType === 'PACK'
          ? Math.round(existingLine.quantity * unitsPerPack * 1000) / 1000
          : existingLine.quantity;
      existingLine.amountPaise = computeLineAmount(
        existingLine.quantityBase,
        existingLine.rateSnapshotPaise
      );
    } else {
      draft.lines.push({
        lineId: new mongoose.Types.ObjectId(),
        status: 'matched',
        itemId: item._id,
        productCode: item.productCode,
        itemName: item.name,
        specText: buildSpecText(item),
        unitType,
        unitsPerPack,
        unitLabel: item.sellingUnit || 'PCS',
        quantity,
        quantityBase,
        rateSnapshotPaise: item.sellingPricePaise,
        amountPaise,
        unclearReason: null,
        inputText: '',
        sourceKind: 'search',
        suggestions: [],
        addedAt: new Date(),
      });
    }

    invalidateApprovals(draft);
    draft.pricedAt = new Date();

    const totals = computeTotals(draft.lines, billingConfig);
    draft.totalPaise = totals.totalPaise;

    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);

    return {
      draft: serializeDraftForRole(draft, userRole, context),
      mergedInto,
    };
  },

  /**
   * Updates an existing line (quantity, unitType, or resolves an unclear line with itemId).
   */
  async updateLine({ storeId, actor, userRole, draftId, lineId, data = {}, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    if (data.expectedVersion !== undefined && data.expectedVersion !== null) {
      if (parseInt(data.expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    const lineIndex = draft.lines.findIndex((l) => l.lineId.toString() === String(lineId));
    if (lineIndex === -1) {
      throw new AppError('Draft line not found', 404);
    }

    const line = draft.lines[lineIndex];

    // Resolving unclear line with itemId
    if (data.itemId) {
      const item = await Item.findOne(
        scopeToStore({ _id: data.itemId }, storeObjectId)
      ).session(session || null);

      if (!item) {
        throw new AppError('Item not found', 400);
      }
      if (item.status !== 'active') {
        throw new AppError('Cannot select an inactive item', 400);
      }
      if (item.sellingPricePaise === null || item.sellingPricePaise === undefined) {
        throw new AppError('Cannot select an item without a selling price', 400);
      }

      line.itemId = item._id;
      line.productCode = item.productCode;
      line.itemName = item.name;
      line.specText = buildSpecText(item);
      line.unitLabel = item.sellingUnit || 'PCS';
      line.unitsPerPack = item.unitsPerPack || 1;
      line.rateSnapshotPaise = item.sellingPricePaise;
      line.status = 'matched';
      line.unclearReason = null;
      line.suggestions = [];

      if (data.quantity !== undefined) {
        line.quantity = Number(data.quantity);
      } else if (!line.quantity || line.quantity <= 0) {
        throw new AppError('Valid quantity is required to resolve this line', 400);
      }

      if (data.unitType !== undefined) {
        line.unitType = data.unitType === 'PACK' ? 'PACK' : 'UNIT';
      }

      if (line.unitType === 'PACK' && (!item.unitsPerPack || item.unitsPerPack <= 1)) {
        throw new AppError('Item has no pack conversion', 400);
      }

      const unitsPerPack = line.unitType === 'PACK' ? Number(item.unitsPerPack || 1) : 1;
      line.quantityBase = line.unitType === 'PACK'
        ? Math.round(line.quantity * unitsPerPack * 1000) / 1000
        : line.quantity;
      line.amountPaise = computeLineAmount(line.quantityBase, line.rateSnapshotPaise);

      // Check if identical item + unitType already exists in another line -> merge into it
      const duplicateIndex = draft.lines.findIndex(
        (l, idx) =>
          idx !== lineIndex &&
          l.status === 'matched' &&
          l.itemId &&
          l.itemId.toString() === item._id.toString() &&
          l.unitType === line.unitType
      );

      if (duplicateIndex !== -1) {
        const target = draft.lines[duplicateIndex];
        target.quantity = Math.round((target.quantity + line.quantity) * 1000) / 1000;
        target.quantityBase =
          target.unitType === 'PACK'
            ? Math.round(target.quantity * unitsPerPack * 1000) / 1000
            : target.quantity;
        target.amountPaise = computeLineAmount(target.quantityBase, target.rateSnapshotPaise);
        draft.lines.splice(lineIndex, 1);
      }
    } else {
      // Modifying quantity or unit of an existing line
      if (data.quantity !== undefined) {
        line.quantity = Number(data.quantity);
      }

      if (data.unitType !== undefined) {
        if (data.unitType === 'PACK') {
          if (!line.unitsPerPack || line.unitsPerPack <= 1) {
            throw new AppError('Item has no pack conversion', 400);
          }
          line.unitType = 'PACK';
        } else {
          line.unitType = 'UNIT';
        }
      }

      const unitsPerPack = line.unitType === 'PACK' ? Number(line.unitsPerPack || 1) : 1;
      line.quantityBase = line.unitType === 'PACK'
        ? Math.round(line.quantity * unitsPerPack * 1000) / 1000
        : line.quantity;
      line.amountPaise = computeLineAmount(line.quantityBase, line.rateSnapshotPaise);

      // Merge check if changed unitType matches another line
      if (line.status === 'matched' && line.itemId) {
        const duplicateIndex = draft.lines.findIndex(
          (l, idx) =>
            idx !== lineIndex &&
            l.status === 'matched' &&
            l.itemId &&
            l.itemId.toString() === line.itemId.toString() &&
            l.unitType === line.unitType
        );

        if (duplicateIndex !== -1) {
          const target = draft.lines[duplicateIndex];
          target.quantity = Math.round((target.quantity + line.quantity) * 1000) / 1000;
          target.quantityBase =
            target.unitType === 'PACK'
              ? Math.round(target.quantity * unitsPerPack * 1000) / 1000
              : target.quantity;
          target.amountPaise = computeLineAmount(target.quantityBase, target.rateSnapshotPaise);
          draft.lines.splice(lineIndex, 1);
        }
      }
    }

    invalidateApprovals(draft);
    draft.pricedAt = new Date();

    const totals = computeTotals(draft.lines, billingConfig);
    draft.totalPaise = totals.totalPaise;

    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Deletes a single line from the draft.
   */
  async deleteLine({ storeId, actor, userRole, draftId, lineId, expectedVersion, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (parseInt(expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    const lineIndex = draft.lines.findIndex((l) => l.lineId.toString() === String(lineId));
    if (lineIndex === -1) {
      throw new AppError('Draft line not found', 404);
    }

    draft.lines.splice(lineIndex, 1);

    invalidateApprovals(draft);
    const totals = computeTotals(draft.lines, billingConfig);
    draft.totalPaise = totals.totalPaise;

    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Discards an open draft.
   */
  async discardDraft({ storeId, actor, userRole, draftId, expectedVersion, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Only open drafts can be discarded', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (parseInt(expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    draft.status = 'discarded';
    draft.version = (draft.version || 1) + 1;
    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    await auditService.log({
      actor,
      storeId: storeObjectId,
      action: 'DRAFT_DISCARD',
      entity: 'BillDraft',
      entityId: draft._id,
      after: { status: 'discarded', draftNumber: draft.draftNumber },
    });

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Re-reads current item selling prices and refreshes rate snapshots and amounts.
   */
  async refreshPrices({ storeId, actor, userRole, draftId, expectedVersion, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (draft.status !== 'open') {
      throw new AppError('Cannot edit a discarded draft', 400);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    if (expectedVersion !== undefined && expectedVersion !== null) {
      if (parseInt(expectedVersion, 10) !== draft.version) {
        const context = await buildValidationContext(storeObjectId, draft, session);
        throw new AppError('Draft has been modified by another request', 409, {
          code: 'STALE_DRAFT',
          draft: serializeDraftForRole(draft, userRole, context),
        });
      }
    }

    const matchedItemIds = draft.lines
      .filter((l) => l.status === 'matched' && l.itemId)
      .map((l) => l.itemId);

    let changedLines = 0;
    const oldTotal = toRupees(draft.totalPaise);

    if (matchedItemIds.length > 0) {
      const currentItems = await Item.find(
        scopeToStore({ _id: { $in: matchedItemIds } }, storeObjectId)
      )
        .session(session || null)
        .lean();

      const itemMap = new Map(currentItems.map((i) => [i._id.toString(), i]));

      for (const line of draft.lines) {
        if (line.status !== 'matched' || !line.itemId) continue;
        const currentItem = itemMap.get(line.itemId.toString());
        if (currentItem && currentItem.sellingPricePaise !== null && currentItem.sellingPricePaise !== undefined) {
          if (currentItem.sellingPricePaise !== line.rateSnapshotPaise) {
            changedLines += 1;
            line.rateSnapshotPaise = currentItem.sellingPricePaise;
            line.amountPaise = computeLineAmount(line.quantityBase, currentItem.sellingPricePaise);
          }
        }
      }
    }

    draft.pricedAt = new Date();
    invalidateApprovals(draft);

    const totals = computeTotals(draft.lines, billingConfig);
    draft.totalPaise = totals.totalPaise;
    const newTotal = toRupees(totals.totalPaise);

    draft.updatedBy = {
      id: actor._id.toString(),
      name: actor.name || 'Unknown',
      role: userRole,
    };

    await draft.save({ session: session || undefined });

    const context = await buildValidationContext(storeObjectId, draft, session);

    return {
      changedLines,
      oldTotal,
      newTotal,
      draft: serializeDraftForRole(draft, userRole, context),
    };
  },

  /**
   * Retrieves a single bill draft by ID with complete real-time validation.
   */
  async getDraftById({ storeId, actor, userRole, draftId, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const draft = await BillDraft.findOne(
      scopeToStore({ _id: draftId }, storeObjectId)
    ).session(session || null);

    if (!draft) {
      throw new AppError('Bill draft not found', 404);
    }

    if (userRole === 'salesman' && draft.ownerId.toString() !== actor._id.toString()) {
      throw new AppError('Bill draft not found', 404);
    }

    const context = await buildValidationContext(storeObjectId, draft, session);
    return serializeDraftForRole(draft, userRole, context);
  },

  /**
   * Lists bill drafts with search, filtering, and role-based visibility.
   */
  async listDrafts({ storeId, actor, userRole, query = {}, session = null }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const filter = { storeId: storeObjectId };

    // Status filter: defaults to 'open'
    if (query.status && query.status !== 'all') {
      filter.status = query.status;
    } else if (!query.status) {
      filter.status = 'open';
    }

    // Bill type filter
    if (query.billType && query.billType !== 'all') {
      filter.billType = query.billType;
    }

    // Ownership: salesman sees ONLY own drafts; admin can filter by ownerId
    if (userRole === 'salesman') {
      filter.ownerId = actor._id;
    } else if (query.ownerId) {
      filter.ownerId = new mongoose.Types.ObjectId(String(query.ownerId));
    }

    // Search filter: draftNumber, walkIn name, customer name or mobile
    if (query.search && String(query.search).trim()) {
      const searchStr = String(query.search).trim();
      const searchRegex = new RegExp(escapeRegex(searchStr), 'i');

      // Find matching customers for search
      const matchingCustomers = await Customer.find(
        scopeToStore(
          {
            $or: [{ name: searchRegex }, { mobile: searchRegex }],
          },
          storeObjectId
        )
      )
        .select('_id')
        .session(session || null)
        .lean();

      const customerIds = matchingCustomers.map((c) => c._id);

      filter.$or = [
        { draftNumber: searchRegex },
        { 'walkIn.name': searchRegex },
        { 'walkIn.mobile': searchRegex },
        ...(customerIds.length > 0 ? [{ customerId: { $in: customerIds } }] : []),
      ];
    }

    // Pagination (local fallback)
    // TODO: Switch to shared pagination helper when available
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));

    const total = await BillDraft.countDocuments(filter).session(session || null);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const drafts = await BillDraft.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('customerId', 'name customerCode mobile')
      .populate('ownerId', 'name')
      .session(session || null)
      .lean();

    const rows = drafts.map((d) => {
      let customerObj = null;
      if (d.customerId) {
        customerObj = {
          id: d.customerId._id ? d.customerId._id.toString() : d.customerId.toString(),
          name: d.customerId.name || 'Unknown',
        };
      } else if (d.walkIn && d.walkIn.name) {
        customerObj = {
          id: null,
          name: `${d.walkIn.name} (Walk-in)`,
        };
      }

      return {
        id: d._id.toString(),
        draftNumber: d.draftNumber,
        billType: d.billType,
        customer: customerObj,
        lineCount: (d.lines || []).length,
        total: toRupees(d.totalPaise || 0),
        status: d.status,
        ...(userRole === 'admin'
          ? { ownerName: d.ownerId?.name || (d.createdBy?.name || 'Unknown') }
          : {}),
        updatedAt: d.updatedAt,
      };
    });

    return {
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  /**
   * Searches active and priced items for the "Find item" box.
   * Scoped to store. Exact productCode match listed first.
   */
  async searchItems({ storeId, actor, userRole, q, limit = 20 }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const trimmed = String(q || '').trim();
    if (!trimmed) {
      return { success: true, data: [] };
    }

    const maxLimit = Math.min(20, Math.max(1, parseInt(limit, 10) || 20));

    // Word tokens for name match
    const words = trimmed.split(/\s+/).filter(Boolean);
    const wordRegexes = words.map((w) => new RegExp(escapeRegex(w), 'i'));

    const searchFilter = scopeToStore(
      {
        status: 'active',
        sellingPricePaise: { $ne: null },
        $or: [
          { productCode: new RegExp(escapeRegex(trimmed), 'i') },
          { name: { $all: wordRegexes } },
        ],
      },
      storeObjectId
    );

    const items = await Item.find(searchFilter)
      .populate('brandId', 'name')
      .populate('categoryId', 'name')
      .lean();

    // Sort exact productCode match first
    const cleanLower = trimmed.toLowerCase();
    items.sort((a, b) => {
      const aExact = a.productCode.toLowerCase() === cleanLower ? 1 : 0;
      const bExact = b.productCode.toLowerCase() === cleanLower ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const aStarts = a.productCode.toLowerCase().startsWith(cleanLower) ? 1 : 0;
      const bStarts = b.productCode.toLowerCase().startsWith(cleanLower) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      return a.name.localeCompare(b.name);
    });

    const sliced = items.slice(0, maxLimit);
    const itemIds = sliced.map((i) => i._id.toString());

    // Single grouped query for stock balances
    let stockMap = {};
    try {
      stockMap = await stockService.getStockBalances(storeObjectId, itemIds);
    } catch {
      stockMap = {};
    }

    const results = sliced.map((item) => {
      const idStr = item._id.toString();
      const rawAvailable = stockMap[idStr];
      const availableQty =
        rawAvailable !== undefined && rawAvailable !== null && !isNaN(Number(rawAvailable))
          ? Math.round(Number(rawAvailable) * 1000) / 1000
          : null;

      const baseResult = {
        id: idStr,
        _id: idStr,
        itemId: idStr,
        productCode: item.productCode,
        name: item.name,
        brand: item.brandId?.name || '',
        category: item.categoryId?.name || '',
        specText: buildSpecText(item),
        unitLabel: item.sellingUnit || 'PCS',
        unitsPerPack: item.unitsPerPack || 1,
        availableQty,
        stock: {
          availableBase: availableQty,
          enough: availableQty !== null ? availableQty > 0 : false,
        },
      };

      // Admin additionally gets selling rate per unit; Salesman gets NO price field
      if (userRole === 'admin') {
        baseResult.rate = toRupees(item.sellingPricePaise);
      }

      return baseResult;
    });

    return {
      success: true,
      data: results,
    };
  },

  /**
   * Retrieves customer credit status and balance overview.
   */
  async getCustomerCredit({ storeId, actor, userRole, customerId }) {
    const storeObjectId = new mongoose.Types.ObjectId(String(storeId));
    const credit = await getCustomerCredit(storeObjectId, customerId);

    if (!credit) {
      throw new AppError('Customer not found in this store', 404);
    }

    return {
      success: true,
      data: credit,
    };
  },
};

export default billingService;
