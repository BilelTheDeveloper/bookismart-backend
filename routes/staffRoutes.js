import express from 'express';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import { staffProtect } from '../middleware/staffAuth.js';
import {
  /* Owner */
  inviteStaff, getStaff, getStaffById, updateStaff,
  toggleStaffStatus, deleteStaff, resendInvite,
  getStaffAccess, updateStaffAccess,
  /* Public registration */
  getStaffRegistrationInfo, submitStaffProfile,
  verifyStaffOTP, resendStaffOTP,
  setStaffPassword, submitStaffKYC,
  staffLogin,
  /* Portal */
  staffLogout, refreshStaffToken, getStaffMe,
  /* Admin */
  getAdminStaff, reviewStaffKYC,
} from '../controllers/staffController.js';

/* ─── Public registration flow (no auth) ─── */
export const publicStaffRouter = express.Router();

publicStaffRouter.get('/register/:token',                  getStaffRegistrationInfo);
publicStaffRouter.post('/register/:token/profile',         submitStaffProfile);
publicStaffRouter.post('/register/:token/verify-otp',      verifyStaffOTP);
publicStaffRouter.post('/register/:token/resend-otp',      resendStaffOTP);
publicStaffRouter.post('/register/:token/set-password',    setStaffPassword);
publicStaffRouter.post('/register/:token/kyc',             submitStaffKYC);
publicStaffRouter.post('/login',                           staffLogin);
publicStaffRouter.post('/portal/refresh',                  refreshStaffToken);

/* ─── Staff portal routes (staff JWT required) ─── */
export const portalStaffRouter = express.Router();

portalStaffRouter.post('/logout',   staffProtect, staffLogout);
portalStaffRouter.get('/me',        staffProtect, getStaffMe);

/* ─── Owner management routes (owner JWT required) ─── */
export const ownerStaffRouter = express.Router();

ownerStaffRouter.get('/',                protect, getStaff);
ownerStaffRouter.post('/',               protect, inviteStaff);
ownerStaffRouter.get('/:id',             protect, getStaffById);
ownerStaffRouter.put('/:id',             protect, updateStaff);
ownerStaffRouter.put('/:id/toggle',      protect, toggleStaffStatus);
ownerStaffRouter.delete('/:id',          protect, deleteStaff);
ownerStaffRouter.post('/:id/resend',     protect, resendInvite);
ownerStaffRouter.get('/:id/access',      protect, getStaffAccess);
ownerStaffRouter.put('/:id/access',      protect, updateStaffAccess);

/* ─── Admin review routes (admin JWT required) ─── */
export const adminStaffRouter = express.Router();

adminStaffRouter.get('/',             protect, isAdmin, getAdminStaff);
adminStaffRouter.put('/:id/review',   protect, isAdmin, reviewStaffKYC);
