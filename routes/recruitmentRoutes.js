import express from 'express';
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import {
  getPublicJobs,
  getPublicJobById,
  applyToJob,
  createJob,
  getOwnerJobs,
  updateJob,
  deleteJob,
  submitJob,
  closeJob,
  getJobApplications,
  updateApplicationStatus,
  getAdminJobs,
  reviewJob,
} from '../controllers/recruitmentController.js';

/* ── Public (no auth) ── */
export const publicRecruitmentRouter = express.Router();
publicRecruitmentRouter.get('/',       getPublicJobs);
publicRecruitmentRouter.get('/:id',    getPublicJobById);
publicRecruitmentRouter.post('/:id/apply', applyToJob);

/* ── Owner (auth required) ── */
export const ownerRecruitmentRouter = express.Router();
ownerRecruitmentRouter.use(protect);
ownerRecruitmentRouter.get('/',                                  getOwnerJobs);
ownerRecruitmentRouter.post('/',                                 createJob);
ownerRecruitmentRouter.put('/:id',                               updateJob);
ownerRecruitmentRouter.delete('/:id',                            deleteJob);
ownerRecruitmentRouter.put('/:id/submit',                        submitJob);
ownerRecruitmentRouter.put('/:id/close',                         closeJob);
ownerRecruitmentRouter.get('/:id/applications',                  getJobApplications);
ownerRecruitmentRouter.put('/:id/applications/:appId/status',    updateApplicationStatus);

/* ── Admin (auth + admin role) ── */
export const adminRecruitmentRouter = express.Router();
adminRecruitmentRouter.use(protect, isAdmin);
adminRecruitmentRouter.get('/',         getAdminJobs);
adminRecruitmentRouter.put('/:id/review', reviewJob);
