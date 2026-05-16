import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getNotes, addProfileNote, deleteProfileNote } from '../controllers/customerNoteController.js';

const router = express.Router();
router.use(protect);

router.get('/',           getNotes);
router.post('/',          addProfileNote);
router.delete('/:noteId', deleteProfileNote);

export default router;
