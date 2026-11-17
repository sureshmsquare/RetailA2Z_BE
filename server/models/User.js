import mongoose from 'mongoose';

export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  SALESMAN: 'salesman',
  COLLECTIONS: 'collections',
});

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    mobile: {
      type: String,
      trim: true,
      default: null,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: Object.values(USER_ROLES),
        message: '{VALUE} is not a valid user role',
      },
      default: USER_ROLES.SALESMAN,
      required: true,
    },
    storeIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Store',
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
);

// Indexes: email and mobile are sparse and unique so one can be omitted if the other is present
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
userSchema.index(
  { mobile: 1 },
  { unique: true, partialFilterExpression: { mobile: { $type: 'string' } } }
);

// Strip passwordHash in toJSON and toObject transforms
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);
export default User;

