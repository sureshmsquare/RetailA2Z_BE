import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../server/config/db.js';
import Item from '../server/models/Item.js';
import Brand, { normalizeBrandName } from '../server/models/Brand.js';

/**
 * Migrates legacy free-text `brand` values on Items to Brand Master documents
 * and links each item via `brandId`, then removes the legacy `brand` text field.
 *
 * Safe to run multiple times (idempotent).
 *
 * @param {Object} [options]
 * @param {Array<string|ObjectId>} [options.storeIds] - Optional list of storeIds to restrict migration (useful in tests)
 * @param {boolean} [options.quiet=false] - Suppress console summary output when true
 * @returns {Promise<{ brandsCreated: number, itemsUpdated: number, itemsWithoutBrand: number, mergedGroups: Array<{ name: string, spellings: string[] }> }>}
 */
export async function migrateItemBrands({ storeIds = null, quiet = false } = {}) {
  const itemCollection = Item.collection;

  const baseFilter = {};
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    baseFilter.storeId = {
      $in: storeIds.map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  const distinctStoreIds = await itemCollection.distinct('storeId', baseFilter);

  let brandsCreated = 0;
  let itemsUpdated = 0;
  const mergedGroups = [];

  for (const storeId of distinctStoreIds) {
    if (!storeId) continue;

    // Fetch all items in this store that still carry the old text `brand` field
    const legacyItems = await itemCollection
      .find({ storeId, brand: { $exists: true } })
      .project({ _id: 1, brand: 1, brandId: 1 })
      .toArray();

    if (legacyItems.length === 0) {
      continue;
    }

    // Group non-empty legacy brand values by normalized key
    const groups = new Map();
    const emptyLegacyNoBrandId = [];
    const emptyLegacyHasBrandId = [];

    for (const doc of legacyItems) {
      const raw = typeof doc.brand === 'string' ? doc.brand : '';
      const { name: cleanSpelling, nameKey } = normalizeBrandName(raw);

      if (!nameKey) {
        if (doc.brandId) {
          emptyLegacyHasBrandId.push(doc._id);
        } else {
          emptyLegacyNoBrandId.push(doc._id);
        }
        continue;
      }

      if (!groups.has(nameKey)) {
        groups.set(nameKey, {
          spellingCounts: new Map(),
          itemIdsNeedBrandId: [],
          itemIdsUnsetOnly: [],
        });
      }

      const group = groups.get(nameKey);
      group.spellingCounts.set(cleanSpelling, (group.spellingCounts.get(cleanSpelling) || 0) + 1);

      if (doc.brandId) {
        group.itemIdsUnsetOnly.push(doc._id);
      } else {
        group.itemIdsNeedBrandId.push(doc._id);
      }
    }

    // Create one Brand per group (using most common original spelling) and update matching items
    for (const [nameKey, group] of groups.entries()) {
      let bestName = '';
      let maxCount = -1;
      const spellings = Array.from(group.spellingCounts.keys());

      for (const [spelling, count] of group.spellingCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestName = spelling;
        }
      }

      if (spellings.length > 1) {
        mergedGroups.push({
          name: bestName,
          spellings,
        });
      }

      // Truncate safely to schema max length if legacy text exceeded 60 chars
      if (bestName.length > 60) {
        bestName = bestName.slice(0, 60).trim();
      }

      const finalKey = normalizeBrandName(bestName).nameKey;

      let brandDoc = await Brand.findOne({ storeId, nameKey: finalKey });
      if (!brandDoc) {
        brandDoc = await Brand.create({
          storeId,
          name: bestName,
          nameKey: finalKey,
          isActive: true,
          createdBy: 'MIGRATION',
          updatedBy: 'MIGRATION',
        });
        brandsCreated++;
      }

      if (group.itemIdsNeedBrandId.length > 0) {
        const res = await itemCollection.updateMany(
          { _id: { $in: group.itemIdsNeedBrandId } },
          {
            $set: { brandId: brandDoc._id },
            $unset: { brand: '' },
          }
        );
        itemsUpdated += res.modifiedCount || 0;
      }

      if (group.itemIdsUnsetOnly.length > 0) {
        const res = await itemCollection.updateMany(
          { _id: { $in: group.itemIdsUnsetOnly } },
          { $unset: { brand: '' } }
        );
        itemsUpdated += res.modifiedCount || 0;
      }
    }

    // Remove empty legacy `brand` fields
    if (emptyLegacyNoBrandId.length > 0) {
      const res = await itemCollection.updateMany(
        { _id: { $in: emptyLegacyNoBrandId } },
        {
          $set: { brandId: null },
          $unset: { brand: '' },
        }
      );
      itemsUpdated += res.modifiedCount || 0;
    }

    if (emptyLegacyHasBrandId.length > 0) {
      const res = await itemCollection.updateMany(
        { _id: { $in: emptyLegacyHasBrandId } },
        { $unset: { brand: '' } }
      );
      itemsUpdated += res.modifiedCount || 0;
    }
  }

  const itemsWithoutBrand = await itemCollection.countDocuments({
    ...baseFilter,
    $or: [{ brandId: null }, { brandId: { $exists: false } }],
  });

  const summary = {
    brandsCreated,
    itemsUpdated,
    itemsWithoutBrand,
    mergedGroups,
  };

  if (!quiet) {
    console.log('================================================');
    console.log('     RetailA2Z - Item Brand Migration Summary   ');
    console.log('================================================');
    console.log(`Database             : ${mongoose.connection.name}`);
    console.log(`Brands created       : ${summary.brandsCreated}`);
    console.log(`Items updated        : ${summary.itemsUpdated}`);
    console.log(`Items without brand  : ${summary.itemsWithoutBrand}`);
    if (summary.mergedGroups.length > 0) {
      console.log('Merged groups:');
      for (const group of summary.mergedGroups) {
        console.log(`  - "${group.name}" merged spellings: [${group.spellings.map((s) => `"${s}"`).join(', ')}]`);
      }
    } else {
      console.log('Merged groups        : None');
    }
    console.log('================================================');
  }

  return summary;
}

// Standalone execution: npm run migrate:brands
if (process.argv[1] && process.argv[1].endsWith('migrateItemBrands.js')) {
  (async () => {
    try {
      await connectDB();
      await migrateItemBrands();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('[Brand Migration Error]', err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    }
  })();
}

export default migrateItemBrands;

