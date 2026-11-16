import mongoose from 'mongoose';

const storeMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'store_memberships',
  }
);

// Compound unique index ensuring one membership record per user per store
storeMembershipSchema.index({ userId: 1, storeId: 1 }, { unique: true });
storeMembershipSchema.index({ storeId: 1, isActive: 1 });

const StoreMembership = mongoose.model('StoreMembership', storeMembershipSchema);
export default StoreMembership;

