import ChatRoom from '../models/ChatRoom.js';
import ChatMessage from '../models/ChatMessage.js';
import { notifyUser } from '../utils/notifyUser.js';

/* ─── Rooms ─── */

export const getRooms = async (req, res) => {
  try {
    const rooms = await ChatRoom.find({ ownerId: req.user._id }).sort({ lastMessageAt: -1 }).lean();
    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createRoom = async (req, res) => {
  try {
    const { name, description, type = 'group', members = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Room name is required.' });

    // Always include owner as a member
    const ownerMember = {
      memberId:   req.user._id.toString(),
      memberType: 'owner',
      name:       req.user.fullName || 'Owner',
      avatar:     req.user.profilePicUrl || '',
    };

    const allMembers = [ownerMember, ...members.filter(m => m.memberId !== req.user._id.toString())];

    const room = await ChatRoom.create({
      ownerId: req.user._id,
      name,
      description: description || '',
      type,
      members: allMembers,
      lastMessageAt: new Date(),
    });

    // System message
    await ChatMessage.create({
      roomId:      room._id,
      ownerId:     req.user._id,
      senderId:    req.user._id.toString(),
      senderType:  'owner',
      senderName:  req.user.fullName || 'Owner',
      text:        `${req.user.fullName || 'Owner'} created the group "${name}"`,
      type:        'system',
    });

    res.status(201).json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateRoom = async (req, res) => {
  try {
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });
    if (req.body.name)        room.name        = req.body.name;
    if (req.body.description !== undefined) room.description = req.body.description;
    await room.save();
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addMember = async (req, res) => {
  try {
    const { memberId, memberType, name, avatar } = req.body;
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    if (!room.members.find(m => m.memberId === memberId)) {
      room.members.push({ memberId, memberType, name, avatar: avatar || '' });
      await room.save();

      await ChatMessage.create({
        roomId: room._id, ownerId: req.user._id,
        senderId: req.user._id.toString(), senderType: 'owner',
        senderName: req.user.fullName || 'Owner',
        text: `${name} was added to the group`,
        type: 'system',
      });
    }
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const removeMember = async (req, res) => {
  try {
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });
    const member = room.members.find(m => m.memberId === req.params.memberId);
    room.members = room.members.filter(m => m.memberId !== req.params.memberId);
    await room.save();
    if (member) {
      await ChatMessage.create({
        roomId: room._id, ownerId: req.user._id,
        senderId: req.user._id.toString(), senderType: 'owner',
        senderName: req.user.fullName || 'Owner',
        text: `${member.name} was removed from the group`,
        type: 'system',
      });
    }
    res.json({ success: true, room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteRoom = async (req, res) => {
  try {
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });
    await Promise.all([room.deleteOne(), ChatMessage.deleteMany({ roomId: room._id })]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ─── Messages ─── */

export const getMessages = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id }).lean();
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [messages, total] = await Promise.all([
      ChatMessage.find({ roomId: req.params.id, deleted: false })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ChatMessage.countDocuments({ roomId: req.params.id, deleted: false }),
    ]);

    res.json({ success: true, messages: messages.reverse(), total, room });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text, type = 'text', fileUrl, fileName } = req.body;
    if (!text && !fileUrl) return res.status(400).json({ success: false, message: 'Message text or file required.' });

    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });

    const message = await ChatMessage.create({
      roomId:      room._id,
      ownerId:     req.user._id,
      senderId:    req.user._id.toString(),
      senderType:  'owner',
      senderName:  req.user.fullName || 'Owner',
      senderAvatar: req.user.profilePicUrl || '',
      text:        text || '',
      type,
      fileUrl:     fileUrl || '',
      fileName:    fileName || '',
      readBy:      [req.user._id.toString()],
    });

    // Update room last message
    room.lastMessage = text ? (text.length > 80 ? text.slice(0, 80) + '…' : text) : `📎 ${fileName || 'File'}`;
    room.lastMessageAt = new Date();
    room.lastMessageBy = req.user.fullName || 'Owner';

    // Increment unread counts for other members
    for (const member of room.members) {
      if (member.memberId !== req.user._id.toString()) {
        const current = room.unreadCounts.get(member.memberId) || 0;
        room.unreadCounts.set(member.memberId, current + 1);
      }
    }
    await room.save();

    // Emit via socket
    const io = req.app?.get('io');
    if (io) {
      io.to(`chat:${room._id}`).emit('chat:message', { roomId: room._id, message });
      // Notify non-owner members
      for (const member of room.members) {
        if (member.memberId !== req.user._id.toString() && member.memberType === 'owner') {
          notifyUser(req.app, member.memberId, {
            type: 'chat', title: `New message in ${room.name}`,
            body: message.text || 'Sent a file',
            link: `/owner/dashboard/chat`,
          });
        }
      }
    }

    res.status(201).json({ success: true, message });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const msg = await ChatMessage.findOne({ _id: req.params.msgId, ownerId: req.user._id });
    if (!msg) return res.status(404).json({ success: false, message: 'Message not found.' });
    msg.deleted = true;
    msg.text = 'This message was deleted';
    await msg.save();
    const io = req.app?.get('io');
    if (io) io.to(`chat:${msg.roomId}`).emit('chat:messageDeleted', { roomId: msg.roomId, messageId: msg._id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const markRoomRead = async (req, res) => {
  try {
    const room = await ChatRoom.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!room) return res.status(404).json({ success: false, message: 'Room not found.' });
    room.unreadCounts.set(req.user._id.toString(), 0);
    await room.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
