import mongoose from 'mongoose';

export const FIXED_ROLES = {
  OWNER_ADMIN: 'OWNER_ADMIN',
  CASHIER: 'CASHIER',
  STAFF: 'STAFF',
};

export const ROLE_PERMISSIONS = {
  OWNER_ADMIN: [
    'USER_CREATE',
    'USER_VIEW',
    'USER_UPDATE',
    'USER_DELETE',
    'BILL_CREATE',
    'BILL_VIEW',
    'PRODUCT_CREATE',
    'PRODUCT_VIEW',
    'PRODUCT_UPDATE',
    'REPORT_VIEW',
    'STORE_VIEW',
    'STORE_UPDATE',
  ],
  CASHIER: [
    'BILL_CREATE',
    'BILL_VIEW',
    'PRODUCT_VIEW',
    'STORE_VIEW',
  ],
  STAFF: [
    'PRODUCT_VIEW',
    'STORE_VIEW',
  ],
};

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      enum: Object.values(FIXED_ROLES),
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    permissions: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: 'roles',
  }
);

const Role = mongoose.model('Role', roleSchema);
export default Role;

