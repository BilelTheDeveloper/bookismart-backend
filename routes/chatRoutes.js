import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getRooms, createRoom, updateRoom, addMember, removeMember, deleteRoom,
  getMessages, sendMessage, deleteMessage, markRoomRead,
} from '../controllers/chatController.js';

const router = express.Router();
router.use(protect);

// Rooms
router.get('/',                           getRooms);
router.post('/',                          createRoom);
router.put('/:id',                        updateRoom);
router.post('/:id/members',              addMember);
router.delete('/:id/members/:memberId',  removeMember);
router.delete('/:id',                    deleteRoom);

// Messages
router.get('/:id/messages',              getMessages);
router.post('/:id/messages',             sendMessage);
router.delete('/:id/messages/:msgId',    deleteMessage);
router.put('/:id/read',                  markRoomRead);

export default router;
