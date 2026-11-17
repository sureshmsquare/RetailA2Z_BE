import mongoose from 'mongoose';

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: function () {
        return this.storeName || 'Retail Store';
      },
    },
    storeName: {
      type: String,
      trim: true,
    },
    storeCode: {
      type: String,
      trim: true,
      default: null,
    },
    address: {
      type: mongoose.Schema.Types.Mixed,
      default: '',
    },
    gstin: {
      type: String,
      trim: true,
      default: null,
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    collection: 'stores',
  }
);

// Synchronize name and storeName
storeSchema.pre('save', function (next) {
  if (this.name && !this.storeName) {
    this.storeName = this.name;
  } else if (this.storeName && !this.name) {
    this.name = this.storeName;
  }
  next();
});

storeSchema.methods.toJSON = function () {
  const obj = this.toObject();
  if (!obj.name && obj.storeName) obj.name = obj.storeName;
  return obj;
};

const Store = mongoose.model('Store', storeSchema);
export default Store;
