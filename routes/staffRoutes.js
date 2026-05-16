import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { inviteStaff, getStaff, getStaffById, updateStaff, toggleStaffStatus, deleteStaff, resendInvite } from '../controllers/staffController.js';

const router = express.Router();
router.use(protect);

router.get('/',               getStaff);
router.post('/',              inviteStaff);
router.get('/:id',            getStaffById);
router.put('/:id',            updateStaff);
router.put('/:id/toggle',     toggleStaffStatus);
router.delete('/:id',         deleteStaff);
router.post('/:id/resend',    resendInvite);

export default router;
