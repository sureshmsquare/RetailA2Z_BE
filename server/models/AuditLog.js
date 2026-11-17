import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
    },
    action: {
      type: String,
      required: [true, 'Audit action is required'],
      trim: true,
    },
    entity: {
      type: String,
      required: [true, 'Entity name is required'],
      trim: true,
    },
    entityId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'audit_logs',
  }
);

// Helpful compound indexes for queries
auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ storeId: 1, action: 1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;

