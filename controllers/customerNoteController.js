import CustomerNote from '../models/CustomerNote.js';

const findOrCreate = (ownerId, { email, phone, name }) =>
  CustomerNote.findOneAndUpdate(
    {
      ownerId,
      ...(email ? { customerEmail: email.toLowerCase().trim() } : { customerPhone: String(phone).trim() }),
    },
    {
      $setOnInsert: {
        ownerId,
        customerEmail: email ? email.toLowerCase().trim() : '',
        customerPhone: phone ? String(phone).trim() : '',
        customerName:  name || '',
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

/* ── GET /api/merchant/notes?email=&phone= ── */
export const getNotes = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { email, phone } = req.query;
    if (!email && !phone) return res.status(400).json({ success: false, message: 'email or phone required.' });

    const filter = { ownerId };
    if (email) filter.customerEmail = email.toLowerCase().trim();
    else filter.customerPhone = String(phone).trim();

    const doc = await CustomerNote.findOne(filter);
    return res.json({ success: true, data: doc || { profileNotes: [], checkpoints: [] } });
  } catch (err) {
    console.error('[NOTES_GET]', err.message);
    res.status(500).json({ success: false });
  }
};

/* ── POST /api/merchant/notes ── { email|phone, name, tag, text } ── */
export const addProfileNote = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { email, phone, name, tag = 'general', text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'text required.' });
    if (!email && !phone) return res.status(400).json({ success: false, message: 'email or phone required.' });

    const doc = await findOrCreate(ownerId, { email, phone, name });
    doc.profileNotes.unshift({ text: text.trim(), tag });
    if (doc.profileNotes.length > 30) doc.profileNotes.pop();
    await doc.save();

    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[NOTE_ADD]', err.message);
    res.status(500).json({ success: false });
  }
};

/* ── DELETE /api/merchant/notes/:noteId ── */
export const deleteProfileNote = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { noteId } = req.params;
    const { email, phone } = req.query;

    const filter = { ownerId };
    if (email) filter.customerEmail = email.toLowerCase().trim();
    else if (phone) filter.customerPhone = String(phone).trim();

    const doc = await CustomerNote.findOne(filter);
    if (!doc) return res.status(404).json({ success: false });

    doc.profileNotes = doc.profileNotes.filter(n => String(n._id) !== noteId);
    await doc.save();
    return res.json({ success: true, data: doc });
  } catch (err) {
    console.error('[NOTE_DELETE]', err.message);
    res.status(500).json({ success: false });
  }
};

/* ── POST /api/merchant/notes/checkpoint ── called by complete consultation ── */
export const saveCheckpoint = async (ownerId, { email, phone, name, consultationId, date, service, summary, nextAction }) => {
  try {
    if (!email && !phone) return;
    const doc = await findOrCreate(ownerId, { email, phone, name });
    doc.checkpoints.unshift({ consultationId, date, service, summary, nextAction });
    if (doc.checkpoints.length > 20) doc.checkpoints.pop();
    if (name && !doc.customerName) doc.customerName = name;
    await doc.save();
  } catch (err) {
    console.error('[CHECKPOINT_SAVE]', err.message);
  }
};
