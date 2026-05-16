import Transaction from '../models/Transaction.js';

const parseNum = (v) => {
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
};

// ─── CREATE TRANSACTION ──────────────────────────────────────────────────────
export const createTransaction = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { type, amount, category, description, notes, date, tags, isRecurring, recurringFrequency } = req.body;

    if (!['income', 'expense'].includes(type))
      return res.status(400).json({ success: false, message: 'Invalid transaction type.' });
    if (!amount || parseNum(amount) <= 0)
      return res.status(400).json({ success: false, message: 'Amount must be greater than 0.' });
    if (!category || !description)
      return res.status(400).json({ success: false, message: 'Category and description are required.' });

    const txn = await Transaction.create({
      ownerId,
      type,
      amount: parseNum(amount),
      category,
      description: String(description).slice(0, 300),
      notes: notes ? String(notes).slice(0, 1000) : '',
      date: date ? new Date(date) : new Date(),
      tags: Array.isArray(tags) ? tags.slice(0, 10).map(t => String(t).slice(0, 50)) : [],
      isRecurring: !!isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : null,
    });

    return res.status(201).json({ success: true, data: txn });
  } catch (err) {
    console.error('[FINANCE_CREATE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to create transaction.' });
  }
};

// ─── LIST TRANSACTIONS ────────────────────────────────────────────────────────
export const listTransactions = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { type, category, startDate, endDate, page = 1, limit = 50 } = req.query;

    const filter = { ownerId };
    if (type && ['income', 'expense'].includes(type)) filter.type = type;
    if (category) filter.category = category;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [transactions, total] = await Promise.all([
      Transaction.find(filter).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Transaction.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: transactions, total, page: parseInt(page) });
  } catch (err) {
    console.error('[FINANCE_LIST_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to list transactions.' });
  }
};

// ─── UPDATE TRANSACTION ───────────────────────────────────────────────────────
export const updateTransaction = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const allowed = ['amount', 'category', 'description', 'notes', 'date', 'tags', 'isRecurring', 'recurringFrequency'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    if (updates.amount) updates.amount = parseNum(updates.amount);
    if (updates.date) updates.date = new Date(updates.date);

    const txn = await Transaction.findOneAndUpdate({ _id: id, ownerId }, updates, { new: true });
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found.' });

    return res.status(200).json({ success: true, data: txn });
  } catch (err) {
    console.error('[FINANCE_UPDATE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update transaction.' });
  }
};

// ─── DELETE TRANSACTION ───────────────────────────────────────────────────────
export const deleteTransaction = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const txn = await Transaction.findOneAndDelete({ _id: id, ownerId });
    if (!txn) return res.status(404).json({ success: false, message: 'Transaction not found.' });
    return res.status(200).json({ success: true, message: 'Transaction deleted.' });
  } catch (err) {
    console.error('[FINANCE_DELETE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to delete transaction.' });
  }
};

// ─── P&L SUMMARY ─────────────────────────────────────────────────────────────
export const getPLSummary = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { period = 'monthly', year } = req.query;
    const targetYear = parseInt(year) || new Date().getFullYear();

    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const transactions = await Transaction.find({
      ownerId,
      date: { $gte: startOfYear, $lte: endOfYear },
    }).lean();

    const monthlyData = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      label: new Date(targetYear, i, 1).toLocaleString('en', { month: 'short' }),
      income: 0,
      expense: 0,
      profit: 0,
    }));

    let totalIncome = 0;
    let totalExpense = 0;
    const categoryBreakdown = {};

    for (const txn of transactions) {
      const m = new Date(txn.date).getMonth();
      if (txn.type === 'income') {
        monthlyData[m].income += txn.amount;
        totalIncome += txn.amount;
      } else {
        monthlyData[m].expense += txn.amount;
        totalExpense += txn.amount;
      }
      categoryBreakdown[txn.category] = (categoryBreakdown[txn.category] || 0) + txn.amount;
    }

    monthlyData.forEach(m => { m.profit = m.income - m.expense; });

    const taxRate = 0.19;
    const taxEstimate = Math.max(0, (totalIncome - totalExpense) * taxRate);

    return res.status(200).json({
      success: true,
      data: {
        year: targetYear,
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        taxEstimate,
        monthlyData,
        categoryBreakdown,
        transactionCount: transactions.length,
      },
    });
  } catch (err) {
    console.error('[FINANCE_PL_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to compute P&L.' });
  }
};

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
export const exportTransactionsCSV = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { startDate, endDate } = req.query;

    const filter = { ownerId };
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const transactions = await Transaction.find(filter).sort({ date: -1 }).lean();

    const header = 'Date,Type,Category,Description,Amount (TND),Notes\n';
    const rows = transactions.map(t => {
      const d = new Date(t.date).toISOString().slice(0, 10);
      const desc = `"${(t.description || '').replace(/"/g, '""')}"`;
      const notes = `"${(t.notes || '').replace(/"/g, '""')}"`;
      return `${d},${t.type},${t.category},${desc},${t.amount.toFixed(3)},${notes}`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bookiify-transactions-${Date.now()}.csv"`);
    return res.status(200).send(header + rows);
  } catch (err) {
    console.error('[FINANCE_EXPORT_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to export transactions.' });
  }
};
