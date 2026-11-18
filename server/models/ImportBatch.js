import mongoose from 'mongoose';

const importRowSchema = new mongoose.Schema(
  {
    rowNumber: {
      type: Number,
      required: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    result: {
      type: String,
      enum: ['new', 'update', 'unchanged', 'error'],
      required: true,
    },
    errors: {
      type: [String],
      default: [],
    },
    approved: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false, suppressReservedKeysWarning: true }
);

const importBatchSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    sourceName: {
      type: String,
      trim: true,
      default: '',
    },
    sourceVersion: {
      type: String,
      trim: true,
      default: '',
    },
    sourceDate: {
      type: Date,
      default: null,
    },
    fileName: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['staged', 'approved', 'cancelled'],
      default: 'staged',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    rows: {
      type: [importRowSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'import_batches',
  }
);

importBatchSchema.index({ storeId: 1, createdAt: -1 });

const ImportBatch = mongoose.model('ImportBatch', importBatchSchema);
export default ImportBatch;
