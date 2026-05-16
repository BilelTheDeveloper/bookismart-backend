import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getNotifications, markRead, markAllRead, deleteNotification, clearAllNotifications, getUnreadCount } from '../controllers/notificationController.js';

const router = express.Router();
router.use(protect);

router.get('/',            getNotifications);
router.get('/unread',      getUnreadCount);
router.put('/read-all',    markAllRead);
router.delete('/clear',    clearAllNotifications);
router.put('/:id/read',    markRead);
router.delete('/:id',      deleteNotification);

export default router;
