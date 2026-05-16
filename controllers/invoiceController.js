import Invoice from '../models/Invoice.js';
import nodemailer from 'nodemailer';

const getTransporter = () => nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const calcTotals = (items, taxRate = 19, discount = 0) => {
  const subtotal = items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxAmount = (subtotal - discount) * (taxRate / 100);
  const total = subtotal - discount + taxAmount;
  return { subtotal, taxAmount, total };
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
export const createInvoice = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { customer, items, taxRate = 19, discount = 0, notes, dueDate, bookingId } = req.body;

    if (!customer?.name || !customer?.email)
      return res.status(400).json({ success: false, message: 'Customer name and email are required.' });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ success: false, message: 'At least one item is required.' });
    if (!dueDate)
      return res.status(400).json({ success: false, message: 'Due date is required.' });

    const cleanItems = items.map(i => ({
      description: String(i.description || '').slice(0, 200),
      quantity:    parseFloat(i.quantity) || 1,
      unitPrice:   parseFloat(i.unitPrice) || 0,
      total:       (parseFloat(i.quantity) || 1) * (parseFloat(i.unitPrice) || 0),
    }));

    const { subtotal, taxAmount, total } = calcTotals(cleanItems, taxRate, discount);

    const invoice = await Invoice.create({
      ownerId,
      customer: {
        name:    String(customer.name).slice(0, 100),
        email:   String(customer.email).toLowerCase().trim(),
        phone:   String(customer.phone || '').slice(0, 30),
        address: String(customer.address || '').slice(0, 300),
      },
      items: cleanItems,
      subtotal,
      taxRate: parseFloat(taxRate),
      taxAmount,
      discount: parseFloat(discount) || 0,
      total,
      notes:  String(notes || '').slice(0, 1000),
      dueDate: new Date(dueDate),
      bookingId: bookingId || null,
    });

    return res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('[INVOICE_CREATE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create invoice.' });
  }
};

// ─── LIST ─────────────────────────────────────────────────────────────────────
export const listInvoices = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { status, page = 1, limit = 30 } = req.query;
    const filter = { ownerId };
    if (status) filter.status = status;

    // Auto-mark overdue
    await Invoice.updateMany({
      ownerId,
      status: 'sent',
      dueDate: { $lt: new Date() },
    }, { status: 'overdue' });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [invoices, total] = await Promise.all([
      Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Invoice.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: invoices, total });
  } catch (err) {
    console.error('[INVOICE_LIST_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list invoices.' });
  }
};

// ─── GET ONE ──────────────────────────────────────────────────────────────────
export const getInvoice = async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, ownerId: req.user._id }).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    return res.status(200).json({ success: true, data: invoice });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to get invoice.' });
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
export const updateInvoice = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const invoice = await Invoice.findOne({ _id: id, ownerId });
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    if (['paid', 'cancelled'].includes(invoice.status))
      return res.status(400).json({ success: false, message: 'Cannot edit a paid or cancelled invoice.' });

    const { customer, items, taxRate, discount, notes, dueDate, status } = req.body;
    if (customer) Object.assign(invoice.customer, customer);
    if (notes !== undefined) invoice.notes = String(notes).slice(0, 1000);
    if (dueDate) invoice.dueDate = new Date(dueDate);
    if (status && ['draft', 'sent', 'paid', 'overdue', 'cancelled'].includes(status)) {
      invoice.status = status;
      if (status === 'paid' && !invoice.paidAt) invoice.paidAt = new Date();
    }
    if (Array.isArray(items) && items.length > 0) {
      invoice.items = items.map(i => ({
        description: String(i.description || '').slice(0, 200),
        quantity:    parseFloat(i.quantity) || 1,
        unitPrice:   parseFloat(i.unitPrice) || 0,
        total:       (parseFloat(i.quantity) || 1) * (parseFloat(i.unitPrice) || 0),
      }));
      const t = calcTotals(invoice.items, taxRate ?? invoice.taxRate, discount ?? invoice.discount);
      Object.assign(invoice, t);
    }

    await invoice.save();
    return res.status(200).json({ success: true, data: invoice });
  } catch (err) {
    console.error('[INVOICE_UPDATE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update invoice.' });
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
export const deleteInvoice = async (req, res) => {
  try {
    const inv = await Invoice.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id });
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    return res.status(200).json({ success: true, message: 'Invoice deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete invoice.' });
  }
};

// ─── SEND VIA EMAIL ───────────────────────────────────────────────────────────
export const sendInvoiceEmail = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const invoice = await Invoice.findOne({ _id: req.params.id, ownerId }).lean();
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found.' });

    const owner = req.user;
    const itemRows = invoice.items.map(i => `
      <tr>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;">${i.description}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:center;">${i.quantity}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;">${i.unitPrice.toFixed(3)} TND</td>
        <td style="padding:10px 16px;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:700;">${i.total.toFixed(3)} TND</td>
      </tr>
    `).join('');

    const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>Invoice ${invoice.invoiceNumber}</title></head>
    <body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f8fafc;margin:0;padding:40px 0;">
      <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:40px;color:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:-1px;">INVOICE</h1>
              <p style="margin:8px 0 0;opacity:0.8;font-size:14px;">${invoice.invoiceNumber}</p>
            </div>
            <div style="text-align:right;">
              <p style="margin:0;font-size:20px;font-weight:800;">${owner.businessName || 'Business'}</p>
              <p style="margin:4px 0 0;opacity:0.8;font-size:13px;">${owner.email}</p>
            </div>
          </div>
        </div>
        <div style="padding:40px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:32px;">
            <div>
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Bill To</p>
              <p style="margin:6px 0 0;font-weight:800;font-size:18px;color:#0f172a;">${invoice.customer.name}</p>
              <p style="margin:4px 0 0;color:#64748b;font-size:14px;">${invoice.customer.email}</p>
              ${invoice.customer.phone ? `<p style="margin:2px 0 0;color:#64748b;font-size:14px;">${invoice.customer.phone}</p>` : ''}
            </div>
            <div style="text-align:right;">
              <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Invoice Details</p>
              <p style="margin:6px 0 0;color:#64748b;font-size:14px;">Issued: <strong style="color:#0f172a;">${new Date(invoice.issuedDate).toLocaleDateString('en-GB')}</strong></p>
              <p style="margin:4px 0 0;color:#64748b;font-size:14px;">Due: <strong style="color:#ef4444;">${new Date(invoice.dueDate).toLocaleDateString('en-GB')}</strong></p>
            </div>
          </div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Description</th>
                <th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Qty</th>
                <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Unit Price</th>
                <th style="padding:12px 16px;text-align:right;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          <div style="border-top:2px solid #e2e8f0;padding-top:20px;margin-left:auto;max-width:280px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="color:#64748b;font-size:14px;">Subtotal</span>
              <span style="font-weight:700;font-size:14px;color:#0f172a;">${invoice.subtotal.toFixed(3)} TND</span>
            </div>
            ${invoice.discount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#10b981;font-size:14px;">Discount</span><span style="font-weight:700;font-size:14px;color:#10b981;">-${invoice.discount.toFixed(3)} TND</span></div>` : ''}
            <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
              <span style="color:#64748b;font-size:14px;">TVA (${invoice.taxRate}%)</span>
              <span style="font-weight:700;font-size:14px;color:#0f172a;">${invoice.taxAmount.toFixed(3)} TND</span>
            </div>
            <div style="display:flex;justify-content:space-between;background:#f8fafc;padding:16px;border-radius:12px;">
              <span style="font-weight:900;font-size:18px;color:#0f172a;">TOTAL DUE</span>
              <span style="font-weight:900;font-size:20px;color:#4f46e5;">${invoice.total.toFixed(3)} TND</span>
            </div>
          </div>
          ${invoice.notes ? `<div style="margin-top:32px;padding:20px;background:#f8fafc;border-radius:12px;"><p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Notes</p><p style="margin:0;color:#475569;font-size:14px;">${invoice.notes}</p></div>` : ''}
        </div>
        <div style="background:#f8fafc;padding:24px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#94a3b8;font-size:12px;">Powered by <strong>Bookiify</strong> — Professional Business Management</p>
        </div>
      </div>
    </body>
    </html>
    `;

    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${owner.businessName || 'Bookiify'}" <${process.env.EMAIL_USER}>`,
      to: invoice.customer.email,
      subject: `Invoice ${invoice.invoiceNumber} from ${owner.businessName || 'Bookiify'}`,
      html,
    });

    await Invoice.findByIdAndUpdate(invoice._id, { status: 'sent', sentAt: new Date() });

    return res.status(200).json({ success: true, message: `Invoice sent to ${invoice.customer.email}.` });
  } catch (err) {
    console.error('[INVOICE_SEND_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to send invoice email.' });
  }
};

// ─── MARK AS PAID ─────────────────────────────────────────────────────────────
export const markInvoicePaid = async (req, res) => {
  try {
    const inv = await Invoice.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user._id },
      { status: 'paid', paidAt: new Date() },
      { new: true }
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    return res.status(200).json({ success: true, data: inv });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to mark invoice as paid.' });
  }
};
