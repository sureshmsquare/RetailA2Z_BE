import mongoose from 'mongoose';

export const AUTH_ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TOKEN_REFRESH: 'TOKEN_REFRESH',
  PASSWORD_RESET: 'PASSWORD_RESET',
};

const authLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: Object.values(AUTH_ACTIONS),
      index: true,
    },
    ipAddress: {
      type: String,
      default: '',
    },
    userAgent: {
      type: String,
      default: '',
    },
    details: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'auth_logs',
  }
);

authLogSchema.index({ userId: 1, createdAt: -1 });
authLogSchema.index({ createdAt: -1 });

const AuthLog = mongoose.model('AuthLog', authLogSchema);
export default AuthLog;

