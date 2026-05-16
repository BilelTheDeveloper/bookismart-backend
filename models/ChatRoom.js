import mongoose from 'mongoose';

const MemberSchema = new mongoose.Schema({
  memberId:   { type: String, required: true },
  memberType: { type: String, enum: ['owner', 'customer', 'staff'], required: true },
  name:       { type: String, required: true },
  avatar:     { type: String, default: '' },
}, { _id: false });

const ChatRoomSchema = new mongoose.Schema({
  ownerId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:            { type: String, required: true, trim: true },
  type:            { type: String, enum: ['group', 'direct'], default: 'group' },
  description:     { type: String, default: '' },
  members:         [MemberSchema],
  lastMessage:     { type: String, default: '' },
  lastMessageAt:   { type: Date, default: null },
  lastMessageBy:   { type: String, default: '' },
  // Map: memberId → unread count
  unreadCounts:    { type: Map, of: Number, default: {} },
  pinnedBy:        [{ type: String }],
}, { timestamps: true });

ChatRoomSchema.index({ ownerId: 1, updatedAt: -1 });

export default mongoose.model('ChatRoom', ChatRoomSchema);
