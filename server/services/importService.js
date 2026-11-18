import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import path from 'path';
import ImportBatch from '../models/ImportBatch.js';
import Item from '../models/Item.js';
import Category, { normalizeCategoryName } from '../models/Category.js';
import PriceHistory from '../models/PriceHistory.js';
import { scopeToStore } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { toPaise } from '../utils/money.js';
import auditService from './auditService.js';

/**
 * Normalizes an object's keys to camelCase for consistent field access.
 */
function normalizeRowKeys(rawRow) {
  const normalized = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const cleanKey = String(key)
      .trim()
      .toLowerCase()
      .replace(/[\s\-_]+([a-z0-9])/g, (_, letter) => letter.toUpperCase())
      .replace(/[^a-zA-Z0-9]/g, '');

    // Canonical mappings
    if (['productcode', 'itemcode', 'code', 'sku', 'barcode', 'partnumber'].includes(cleanKey.toLowerCase())) {
      normalized.productCode = value;
    } else if (['name', 'itemname', 'description', 'productname', 'item'].includes(cleanKey.toLowerCase())) {
      normalized.name = value;
    } else if (['mrp', 'mrpprice', 'retailprice', 'listprice'].includes(cleanKey.toLowerCase())) {
      normalized.mrp = value;
    } else if (['brand', 'make', 'manufacturer'].includes(cleanKey.toLowerCase())) {
      normalized.brand = value;
    } else if (['category', 'group', 'subgroup', 'cat'].includes(cleanKey.toLowerCase())) {
      normalized.category = value;
    } else if (['classseries', 'class', 'series'].includes(cleanKey.toLowerCase())) {
      normalized.classSeries = value;
    } else if (['size', 'dimensions', 'dia'].includes(cleanKey.toLowerCase())) {
      normalized.size = value;
    } else if (['length', 'len'].includes(cleanKey.toLowerCase())) {
      normalized.length = value;
    } else if (['variant', 'color', 'type'].includes(cleanKey.toLowerCase())) {
      normalized.variant = value;
    } else if (['sellingunit', 'unit', 'uom'].includes(cleanKey.toLowerCase())) {
      normalized.sellingUnit = value;
    } else if (['unitsperpack', 'packqty', 'packquantity', 'packsize'].includes(cleanKey.toLowerCase())) {
      normalized.unitsPerPack = value;
    } else if (['hsncode', 'hsn'].includes(cleanKey.toLowerCase())) {
      normalized.hsnCode = value;
    } else if (['taxratepercent', 'taxrate', 'tax', 'gst'].includes(cleanKey.toLowerCase())) {
      normalized.taxRatePercent = value;
    } else {
      normalized[cleanKey] = value;
    }
  }

  // Set default strings for safety
  normalized.productCode = normalized.productCode !== undefined ? String(normalized.productCode).trim() : '';
  normalized.name = normalized.name !== undefined ? String(normalized.name).trim() : '';
  normalized.brand = normalized.brand !== undefined ? String(normalized.brand).trim() : '';
  normalized.category = normalized.category !== undefined ? String(normalized.category).trim() : '';
  normalized.classSeries = normalized.classSeries !== undefined ? String(normalized.classSeries).trim() : '';
  normalized.size = normalized.size !== undefined ? String(normalized.size).trim() : '';
  normalized.length = normalized.length !== undefined ? String(normalized.length).trim() : '';
  normalized.variant = normalized.variant !== undefined ? String(normalized.variant).trim() : '';
  normalized.sellingUnit = normalized.sellingUnit !== undefined ? String(normalized.sellingUnit).trim() : 'PCS';
  normalized.unitsPerPack =
    normalized.unitsPerPack !== undefined && normalized.unitsPerPack !== ''
      ? Number(normalized.unitsPerPack)
      : 1;

  return normalized;
}

/**
 * Extracts raw row objects from CSV or XLSX buffer.
 */
async function parseFileBuffer(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const rows = [];

  if (ext === '.csv') {
    const records = parseCsv(file.buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
    for (const record of records) {
      rows.push(record);
    }
  } else if (ext === '.xlsx' || ext === '.xls') {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new AppError('Excel file contains no worksheets.', 400);
    }

    let headers = [];
    worksheet.eachRow((row, rowNumber) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []; // ExcelJS values are 1-indexed
      if (rowNumber === 1) {
        headers = values.map((v) => (v !== null && v !== undefined ? String(v).trim() : ''));
      } else {
        const rowObj = {};
        headers.forEach((header, index) => {
          if (header) {
            let val = values[index];
            if (val && typeof val === 'object' && val.text) val = val.text;
            if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
            rowObj[header] = val !== null && val !== undefined ? val : '';
          }
        });
        // Check if row has any non-empty value
        const hasValues = Object.values(rowObj).some((v) => String(v).trim() !== '');
        if (hasValues) {
          rows.push(rowObj);
        }
      }
    });
  } else {
    throw new AppError('Unsupported file format. Please upload CSV or Excel (.xlsx) file.', 400);
  }

  return rows;
}

export const importService = {
  /**
   * Stages an import file (CSV/XLSX).
   * Validates each row and classifies as "new", "update", "unchanged", or "error".
   */
  async stageImport({ storeId, actor, file, sourceInfo = {}, session = null }) {
    if (!file || !file.buffer) {
      throw new AppError('Upload file is required', 400);
    }

    const rawRows = await parseFileBuffer(file);
    if (rawRows.length === 0) {
      throw new AppError('The uploaded file contains no data rows.', 400);
    }

    // Load existing items and ACTIVE categories in this store for comparison & matching
    const [existingItems, activeCategories] = await Promise.all([
      Item.find(scopeToStore({}, storeId)).lean().session(session || null),
      Category.find(scopeToStore({ isActive: true }, storeId)).lean().session(session || null),
    ]);

    const existingItemMap = new Map();
    for (const item of existingItems) {
      existingItemMap.set(String(item.productCode).toLowerCase().trim(), item);
    }

    const activeCategoryMap = new Map();
    for (const cat of activeCategories) {
      activeCategoryMap.set(cat.nameKey, cat);
    }

    const processedRows = [];
    let newCount = 0;
    let updateCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 1;
      const normalized = normalizeRowKeys(rawRows[i]);
      const errors = [];

      // Row Validation
      if (!normalized.productCode) {
        errors.push('Product code is required');
      }

      if (!normalized.name) {
        errors.push('Item name is required');
      }

      // MRP numeric validation
      if (normalized.mrp !== undefined && normalized.mrp !== null && String(normalized.mrp).trim() !== '') {
        const mrpNum = Number(normalized.mrp);
        if (isNaN(mrpNum) || mrpNum < 0) {
          errors.push('MRP must be a valid non-negative number');
        } else {
          normalized.mrp = mrpNum;
        }
      } else {
        errors.push('MRP is required');
      }

      // Units per pack validation
      if (isNaN(normalized.unitsPerPack) || normalized.unitsPerPack <= 0) {
        errors.push('Units per pack must be greater than 0');
      }

      // Selling unit validation
      if (!normalized.sellingUnit) {
        errors.push('Selling unit is required');
      }

      // Category matching against ACTIVE categories of the same store via nameKey
      const rawCategory = (normalized.category || '').trim();
      if (rawCategory) {
        const { nameKey } = normalizeCategoryName(rawCategory);
        const matchedCat = activeCategoryMap.get(nameKey);
        if (!matchedCat) {
          errors.push(`Category not found: ${rawCategory}. Add it in Category Master first.`);
          normalized.categoryId = null;
        } else {
          normalized.categoryId = String(matchedCat._id);
          normalized.category = matchedCat.name;
        }
      } else {
        normalized.categoryId = null;
        normalized.category = '';
      }

      let result = 'error';

      if (errors.length > 0) {
        result = 'error';
        errorCount++;
      } else {
        const lookupCode = normalized.productCode.toLowerCase();
        const existing = existingItemMap.get(lookupCode);

        if (!existing) {
          result = 'new';
          newCount++;
        } else if ((existing.codeSource || 'manual') === 'auto') {
          errors.push(
            `Code ${normalized.productCode} is already used by an in-house item (${existing.name}). Resolve it before importing.`
          );
          result = 'error';
          errorCount++;
        } else {
          // Compare MRP and specs (manual or import items only)
          const newMrpPaise = toPaise(normalized.mrp);
          const mrpChanged = newMrpPaise !== existing.mrpPaise;

          const incomingCatId = normalized.categoryId ? String(normalized.categoryId) : '';
          const existingCatId = existing.categoryId ? String(existing.categoryId) : '';
          const categoryChanged = incomingCatId !== '' && incomingCatId !== existingCatId;

          const specsChanged =
            normalized.name !== existing.name ||
            normalized.brand !== (existing.brand || '') ||
            categoryChanged ||
            normalized.classSeries !== (existing.classSeries || '') ||
            normalized.size !== (existing.size || '') ||
            normalized.length !== (existing.length || '') ||
            normalized.variant !== (existing.variant || '') ||
            normalized.sellingUnit !== (existing.sellingUnit || 'PCS') ||
            normalized.unitsPerPack !== (existing.unitsPerPack || 1);

          if (mrpChanged || specsChanged) {
            result = 'update';
            updateCount++;
          } else {
            result = 'unchanged';
            unchangedCount++;
          }
        }
      }

      processedRows.push({
        rowNumber,
        data: normalized,
        result,
        errors,
        approved: false,
      });
    }

    // Create ImportBatch
    const batch = new ImportBatch({
      storeId,
      sourceName: sourceInfo.sourceName || file.originalname,
      sourceVersion: sourceInfo.sourceVersion || '',
      sourceDate: sourceInfo.sourceDate ? new Date(sourceInfo.sourceDate) : new Date(),
      fileName: file.originalname,
      status: 'staged',
      createdBy: actor,
      rows: processedRows,
    });

    await batch.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'IMPORT_STAGE',
      entity: 'ImportBatch',
      entityId: batch._id,
      after: {
        fileName: file.originalname,
        totalRows: processedRows.length,
        newCount,
        updateCount,
        unchangedCount,
        errorCount,
      },
      reason: `Staged import batch from file ${file.originalname}`,
    });

    return {
      batchId: batch._id,
      fileName: batch.fileName,
      sourceName: batch.sourceName,
      sourceVersion: batch.sourceVersion,
      status: batch.status,
      totalRows: processedRows.length,
      newCount,
      updateCount,
      unchangedCount,
      errorCount,
      rows: processedRows,
    };
  },

  /**
   * Retrieves single import batch.
   */
  async getImportBatch({ storeId, batchId, session = null }) {
    const batch = await ImportBatch.findOne(scopeToStore({ _id: batchId }, storeId)).session(session || null);
    if (!batch) {
      throw new AppError('Import batch not found', 404);
    }
    return batch;
  },

  /**
   * Approves staged import batch.
   * Creates new items as DRAFT.
   * For "update" rows updates ONLY mrp, specs, and source (PriceHistory written for MRP).
   * RULE: MUST NEVER OVERWRITE AN EXISTING sellingPrice.
   * Error rows stay in the batch with their reasons.
   */
  async approveImport({ storeId, actor, batchId, options = {}, session = null }) {
    const batch = await ImportBatch.findOne(scopeToStore({ _id: batchId }, storeId)).session(session || null);
    if (!batch) {
      throw new AppError('Import batch not found', 404);
    }

    if (batch.status !== 'staged') {
      throw new AppError(`Cannot approve batch with status '${batch.status}'`, 400);
    }

    const { allValid, rowNumbers } = options;
    const targetRowNumbers = Array.isArray(rowNumbers) ? new Set(rowNumbers) : null;

    let approvedCount = 0;
    let newlyCreatedCount = 0;
    let updatedCount = 0;

    for (const row of batch.rows) {
      if (row.result === 'error') {
        continue; // Never approve error rows
      }

      const shouldApprove = allValid ? true : targetRowNumbers && targetRowNumbers.has(row.rowNumber);

      if (!shouldApprove) {
        continue;
      }

      const data = row.data;
      const mrpPaise = toPaise(data.mrp);

      if (row.result === 'new') {
        // Create new item in DRAFT status with codeSource = "import"
        const item = new Item({
          storeId,
          productCode: data.productCode,
          codeSource: 'import',
          name: data.name,
          brand: data.brand || '',
          categoryId: data.categoryId || null,
          classSeries: data.classSeries || '',
          size: data.size || '',
          length: data.length || '',
          variant: data.variant || '',
          sellingUnit: data.sellingUnit || 'PCS',
          unitsPerPack: Number(data.unitsPerPack) || 1,
          mrpPaise,
          mrpSource: {
            sourceName: batch.sourceName,
            sourceVersion: batch.sourceVersion,
            sourceDate: batch.sourceDate,
          },
          sellingPricePaise: null, // NEVER set sellingPrice automatically!
          status: 'draft',
          createdBy: actor,
          updatedBy: actor,
        });

        await item.save({ session: session || undefined });

        // Record initial MRP in PriceHistory
        if (mrpPaise !== null) {
          const mrpHistory = new PriceHistory({
            storeId,
            itemId: item._id,
            field: 'mrp',
            oldValuePaise: null,
            newValuePaise: mrpPaise,
            effectiveFrom: batch.sourceDate || new Date(),
            reason: `Imported from ${batch.sourceName} ${batch.sourceVersion}`.trim(),
            changedBy: actor,
          });
          await mrpHistory.save({ session: session || undefined });
        }

        row.approved = true;
        approvedCount++;
        newlyCreatedCount++;
      } else if (row.result === 'update') {
        // Find existing item
        const item = await Item.findOne(scopeToStore({ productCode: data.productCode }, storeId)).session(
          session || null
        );

        if (item && (item.codeSource || 'manual') !== 'auto') {
          // If MRP changed, record PriceHistory
          if (mrpPaise !== null && mrpPaise !== item.mrpPaise) {
            const mrpHistory = new PriceHistory({
              storeId,
              itemId: item._id,
              field: 'mrp',
              oldValuePaise: item.mrpPaise,
              newValuePaise: mrpPaise,
              effectiveFrom: batch.sourceDate || new Date(),
              reason: `Updated from import ${batch.sourceName} ${batch.sourceVersion}`.trim(),
              changedBy: actor,
            });
            await mrpHistory.save({ session: session || undefined });
            item.mrpPaise = mrpPaise;
          }

          // Update specs
          item.name = data.name;
          item.brand = data.brand || item.brand;
          if (data.categoryId) {
            item.categoryId = data.categoryId;
          }
          item.classSeries = data.classSeries || item.classSeries;
          item.size = data.size || item.size;
          item.length = data.length || item.length;
          item.variant = data.variant || item.variant;
          item.sellingUnit = data.sellingUnit || item.sellingUnit;
          item.unitsPerPack = Number(data.unitsPerPack) || item.unitsPerPack;
          item.mrpSource = {
            sourceName: batch.sourceName,
            sourceVersion: batch.sourceVersion,
            sourceDate: batch.sourceDate,
          };
          item.updatedBy = actor;

          // CRITICAL: sellingPricePaise is strictly preserved and NEVER modified by import
          await item.save({ session: session || undefined });

          row.approved = true;
          approvedCount++;
          updatedCount++;
        }
      } else if (row.result === 'unchanged') {
        row.approved = true;
      }
    }

    batch.status = 'approved';
    batch.approvedBy = actor;
    await batch.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'IMPORT_APPROVE',
      entity: 'ImportBatch',
      entityId: batch._id,
      after: {
        batchId: batch._id,
        approvedCount,
        newlyCreatedCount,
        updatedCount,
      },
      reason: `Approved import batch ${batch._id}`,
    });

    return {
      batchId: batch._id,
      status: 'approved',
      approvedCount,
      newlyCreatedCount,
      updatedCount,
      totalRows: batch.rows.length,
    };
  },

  /**
   * Cancels a staged import batch.
   */
  async cancelImport({ storeId, actor, batchId, session = null }) {
    const batch = await ImportBatch.findOne(scopeToStore({ _id: batchId }, storeId)).session(session || null);
    if (!batch) {
      throw new AppError('Import batch not found', 404);
    }

    if (batch.status !== 'staged') {
      throw new AppError(`Cannot cancel batch with status '${batch.status}'`, 400);
    }

    batch.status = 'cancelled';
    await batch.save({ session: session || undefined });

    // Audit log
    await auditService.log({
      actor,
      storeId,
      action: 'IMPORT_CANCEL',
      entity: 'ImportBatch',
      entityId: batch._id,
      reason: `Cancelled import batch ${batch._id}`,
    });

    return {
      batchId: batch._id,
      status: 'cancelled',
    };
  },
};

export default importService;

