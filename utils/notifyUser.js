import Notification from '../models/Notification.js';

/**
 * Creates a notification in the DB and emits it via Socket.io to the target user.
 * Non-blocking — never throws to the caller.
 *
 * @param {object} app   - Express app (to get the `io` instance)
 * @param {string} userId - MongoDB ObjectId string of the recipient owner
 * @param {object} payload - { type, title, body, link, meta }
 */
export const notifyUser = async (app, userId, payload) => {
  try {
    const notif = await Notification.create({
      userId,
      type:  payload.type  || 'system',
      title: payload.title || 'Notification',
      body:  payload.body  || '',
      link:  payload.link  || '',
      meta:  payload.meta  || {},
    });

    // Emit via Socket.io to the user's personal room
    const io = app?.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('notification:new', {
        _id:       notif._id,
        type:      notif.type,
        title:     notif.title,
        body:      notif.body,
        link:      notif.link,
        read:      false,
        createdAt: notif.createdAt,
      });
    }
  } catch {
    // Non-blocking — swallow silently
  }
};
