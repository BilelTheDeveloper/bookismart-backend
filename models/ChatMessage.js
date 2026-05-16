import mongoose from 'mongoose';

const ChatMessageSchema = new mongoose.Schema({
  roomId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', required: true, index: true },
  ownerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderId:    { type: String, required: true },
  senderType:  { type: String, enum: ['owner', 'customer', 'staff'], required: true },
  senderName:  { type: String, required: true },
  senderAvatar: { type: String, default: '' },
  text:        { type: String, default: '', maxlength: 3000 },
  type:        { type: String, enum: ['text', 'image', 'file', 'system'], default: 'text' },
  fileUrl:     { type: String, default: '' },
  fileName:    { type: String, default: '' },
  readBy:      [{ type: String }],
  deleted:     { type: Boolean, default: false },
}, { timestamps: true });

ChatMessageSchema.index({ roomId: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', ChatMessageSchema);
