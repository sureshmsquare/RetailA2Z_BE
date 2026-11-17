/**
 * PRICE VISIBILITY RULE:
 * Salesman and collections users must NEVER receive item rate, MRP, cost or margin
 * in ANY API response (search, drafts, previews, exports).
 *
 * TODO: This serializer MUST be used in every future item, catalog, and billing API endpoint.
 * DO NOT rely on the frontend to hide prices. Enforce it at the backend serialization layer.
 *
 * @param {Object} item - Item / product record (plain object or Mongoose document)
 * @param {string} role - The user's role ("admin", "salesman", "collections")
 * @returns {Object} Serialized item with price fields stripped for non-admin roles
 */
export function serializeItemForRole(item, role) {
  if (!item) return item;

  // Convert Mongoose doc if applicable
  const raw = item.toObject ? item.toObject() : { ...item };

  // Admins are permitted to see full financial pricing, margins, cost, and rates
  if (role === 'admin') {
    return raw;
  }

  // Strip sensitive price, cost, margin, rate, and MRP fields for salesman and collections roles
  const restrictedFields = [
    'rate',
    'mrp',
    'cost',
    'costPrice',
    'purchasePrice',
    'sellingPrice',
    'price',
    'margin',
    'marginPercent',
    'discountRate',
    'wholesalePrice',
  ];

  for (const field of restrictedFields) {
    delete raw[field];
  }

  // Strip nested price fields if present
  if (raw.pricing && typeof raw.pricing === 'object') {
    delete raw.pricing;
  }

  return raw;
}

/**
 * Convenience helper to serialize an array of items for a user role
 *
 * TODO: MUST be used in search, list, inventory, and bill drafts endpoints across RetailA2Z.
 */
export function serializeItemListForRole(items, role) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => serializeItemForRole(item, role));
}

