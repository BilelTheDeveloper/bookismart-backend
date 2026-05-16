import express from 'express';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import { customerProtect } from '../middleware/customerAuth.js';
import {
  initiateCustomer,
  getRegistrationInfo,
  verifyOTP,
  resendOTP,
  setPassword,
  submitKYC,
  customerLogin,
  customerLogout,
  getCustomerMe,
  getOwnerCustomers,
  getCustomerAccess,
  updateCustomerAccess,
  getAdminCustomers,
  reviewCustomer,
  getCustomerAppointments,
  getCustomerInvoices,
  getCustomerLoyalty,
} from '../controllers/customerController.js';

/* ─── Public registration flow (no auth needed) ─── */
export const publicCustomerRouter = express.Router();

publicCustomerRouter.get('/register/:token',                    getRegistrationInfo);
publicCustomerRouter.post('/register/:token/verify-otp',        verifyOTP);
publicCustomerRouter.post('/register/:token/resend-otp',        resendOTP);
publicCustomerRouter.post('/register/:token/set-password',      setPassword);
publicCustomerRouter.post('/register/:token/kyc',               submitKYC);
publicCustomerRouter.post('/login',                             customerLogin);

/* ─── Customer portal routes (customer JWT required) ─── */
export const portalCustomerRouter = express.Router();

portalCustomerRouter.post('/logout',          customerProtect, customerLogout);
portalCustomerRouter.get('/me',               customerProtect, getCustomerMe);
portalCustomerRouter.get('/appointments',     customerProtect, getCustomerAppointments);
portalCustomerRouter.get('/invoices',         customerProtect, getCustomerInvoices);
portalCustomerRouter.get('/loyalty',          customerProtect, getCustomerLoyalty);

/* ─── Owner routes (owner JWT required) ─── */
export const ownerCustomerRouter = express.Router();

ownerCustomerRouter.post('/initiate',           protect, initiateCustomer);
ownerCustomerRouter.get('/',                    protect, getOwnerCustomers);
ownerCustomerRouter.get('/:id/access',          protect, getCustomerAccess);
ownerCustomerRouter.put('/:id/access',          protect, updateCustomerAccess);

/* ─── Admin routes (admin JWT required) ─── */
export const adminCustomerRouter = express.Router();

adminCustomerRouter.get('/',                   protect, isAdmin, getAdminCustomers);
adminCustomerRouter.put('/:id/review',         protect, isAdmin, reviewCustomer);
