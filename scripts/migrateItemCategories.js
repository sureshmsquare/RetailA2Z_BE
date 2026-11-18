import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../server/config/db.js';
import Item from '../server/models/Item.js';
import Category, { normalizeCategoryName } from '../server/models/Category.js';

/**
 * Migrates legacy free-text `category` values on Items to Category Master documents
 * and links each item via `categoryId`, then removes the legacy `category` text field.
 *
 * Safe to run multiple times (idempotent).
 *
 * @param {Object} [options]
 * @param {Array<string|ObjectId>} [options.storeIds] - Optional list of storeIds to restrict migration (useful in tests)
 * @param {boolean} [options.quiet=false] - Suppress console summary output when true
 * @returns {Promise<{ categoriesCreated: number, itemsUpdated: number, itemsWithoutCategory: number }>}
 */
export async function migrateItemCategories({ storeIds = null, quiet = false } = {}) {
  const itemCollection = Item.collection;

  const baseFilter = {};
  if (Array.isArray(storeIds) && storeIds.length > 0) {
    baseFilter.storeId = {
      $in: storeIds.map((id) => new mongoose.Types.ObjectId(String(id))),
    };
  }

  const distinctStoreIds = await itemCollection.distinct('storeId', baseFilter);

  let categoriesCreated = 0;
  let itemsUpdated = 0;

  for (const storeId of distinctStoreIds) {
    if (!storeId) continue;

    // Fetch all items in this store that still carry the old text `category` field
    const legacyItems = await itemCollection
      .find({ storeId, category: { $exists: true } })
      .project({ _id: 1, category: 1, categoryId: 1 })
      .toArray();

    if (legacyItems.length === 0) {
      continue;
    }

    // Group non-empty legacy category values by normalized key
    const groups = new Map(); // nameKey -> { spellingCounts: Map<string, number>, itemIdsNeedCatId: ObjectId[], itemIdsUnsetOnly: ObjectId[] }
    const emptyLegacyNoCatId = [];
    const emptyLegacyHasCatId = [];

    for (const doc of legacyItems) {
      const raw = typeof doc.category === 'string' ? doc.category : '';
      const { name: cleanSpelling, nameKey } = normalizeCategoryName(raw);

      if (!nameKey) {
        if (doc.categoryId) {
          emptyLegacyHasCatId.push(doc._id);
        } else {
          emptyLegacyNoCatId.push(doc._id);
        }
        continue;
      }

      if (!groups.has(nameKey)) {
        groups.set(nameKey, {
          spellingCounts: new Map(),
          itemIdsNeedCatId: [],
          itemIdsUnsetOnly: [],
        });
      }

      const group = groups.get(nameKey);
      group.spellingCounts.set(cleanSpelling, (group.spellingCounts.get(cleanSpelling) || 0) + 1);

      if (doc.categoryId) {
        group.itemIdsUnsetOnly.push(doc._id);
      } else {
        group.itemIdsNeedCatId.push(doc._id);
      }
    }

    // Create one Category per group (using most common original spelling) and update matching items
    for (const [nameKey, group] of groups.entries()) {
      let bestName = '';
      let maxCount = -1;
      for (const [spelling, count] of group.spellingCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          bestName = spelling;
        }
      }

      // Truncate safely to schema max length if legacy text exceeded 60 chars
      if (bestName.length > 60) {
        bestName = bestName.slice(0, 60).trim();
      }

      const finalKey = normalizeCategoryName(bestName).nameKey;

      let categoryDoc = await Category.findOne({ storeId, nameKey: finalKey });
      if (!categoryDoc) {
        categoryDoc = await Category.create({
          storeId,
          name: bestName,
          nameKey: finalKey,
          isActive: true,
          createdBy: 'MIGRATION',
          updatedBy: 'MIGRATION',
        });
        categoriesCreated++;
      }

      if (group.itemIdsNeedCatId.length > 0) {
        const res = await itemCollection.updateMany(
          { _id: { $in: group.itemIdsNeedCatId } },
          {
            $set: { categoryId: categoryDoc._id },
            $unset: { category: '' },
          }
        );
        itemsUpdated += res.modifiedCount || 0;
      }

      if (group.itemIdsUnsetOnly.length > 0) {
        const res = await itemCollection.updateMany(
          { _id: { $in: group.itemIdsUnsetOnly } },
          { $unset: { category: '' } }
        );
        itemsUpdated += res.modifiedCount || 0;
      }
    }

    // Remove empty legacy `category` fields
    if (emptyLegacyNoCatId.length > 0) {
      const res = await itemCollection.updateMany(
        { _id: { $in: emptyLegacyNoCatId } },
        {
          $set: { categoryId: null },
          $unset: { category: '' },
        }
      );
      itemsUpdated += res.modifiedCount || 0;
    }

    if (emptyLegacyHasCatId.length > 0) {
      const res = await itemCollection.updateMany(
        { _id: { $in: emptyLegacyHasCatId } },
        { $unset: { category: '' } }
      );
      itemsUpdated += res.modifiedCount || 0;
    }
  }

  const itemsWithoutCategory = await itemCollection.countDocuments({
    ...baseFilter,
    $or: [{ categoryId: null }, { categoryId: { $exists: false } }],
  });

  const summary = {
    categoriesCreated,
    itemsUpdated,
    itemsWithoutCategory,
  };

  if (!quiet) {
    console.log('================================================');
    console.log('   RetailA2Z - Item Category Migration Summary  ');
    console.log('================================================');
    console.log(`Database             : ${mongoose.connection.name}`);
    console.log(`Categories created   : ${summary.categoriesCreated}`);
    console.log(`Items updated        : ${summary.itemsUpdated}`);
    console.log(`Items without cat    : ${summary.itemsWithoutCategory}`);
    console.log('================================================');
  }

  return summary;
}

// Standalone execution: npm run migrate:categories
if (process.argv[1] && process.argv[1].endsWith('migrateItemCategories.js')) {
  (async () => {
    try {
      await connectDB();
      await migrateItemCategories();
      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('[Migration Error]', err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    }
  })();
}

export default migrateItemCategories;

