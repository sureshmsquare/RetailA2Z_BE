import AuditLog from '../models/AuditLog.js';

export const auditService = {
  /**
   * Reusable audit logger across all RetailA2Z modules.
   * Never throws so core business transactions are not interrupted by audit write errors.
   */
  async log({ actor, storeId = null, action, entity, entityId = null, before = null, after = null, reason = null }) {
    try {
      // Normalize actor: can be a User document, an ObjectId, or a string descriptor (e.g. "SYSTEM" or IP)
      let actorData = actor;
      if (actor && typeof actor === 'object') {
        if (actor._id) {
          actorData = {
            id: actor._id.toString(),
            name: actor.name || 'Unknown',
            email: actor.email || null,
            role: actor.role || null,
          };
        }
      }

      // Ensure sensitive password hashes are never persisted in audit before/after snapshots
      const sanitizeData = (data) => {
        if (!data || typeof data !== 'object') return data;
        const copy = { ...(data.toObject ? data.toObject() : data) };
        delete copy.passwordHash;
        delete copy.password;
        return copy;
      };

      const logDoc = await AuditLog.create({
        actor: actorData || 'ANONYMOUS',
        storeId: storeId || null,
        action,
        entity,
        entityId: entityId ? entityId.toString() : null,
        before: sanitizeData(before),
        after: sanitizeData(after),
        reason: reason || null,
        createdAt: new Date(),
      });

      return logDoc;
    } catch (err) {
      console.error('[AuditService Error] Failed to write audit log:', err.message);
      return null;
    }
  },
};

export default auditService;

