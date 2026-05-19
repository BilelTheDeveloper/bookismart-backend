import Booking from '../models/Booking.js';

const parsePrice = (s) => {
  if (!s) return 0;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const fmtHour = (h) => {
  const period = h < 12 ? 'AM' : 'PM';
  const disp   = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${disp}:00 ${period}`;
};

const thisMonthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};
const lastMonthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
};
const lastMonthEnd = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59);
};

// ─── Individual insight functions ───────────────────────────────────────────

async function busiestDay(ownerId) {
  const results = await Booking.aggregate([
    { $match: { ownerId, status: { $nin: ['cancelled'] }, dayOfWeek: { $exists: true, $ne: null } } },
    { $group: { _id: '$dayOfWeek', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  if (!results.length) return { empty: true };

  const max = results[0].count;
  const breakdown = DAY_ORDER.map(day => ({
    label: day.slice(0, 3),
    count: results.find(r => r._id === day)?.count || 0,
  }));

  return {
    headline: results[0]._id,
    subline: `${results[0].count} total bookings on this day`,
    breakdown,
    max,
    tip: `Schedule your best staff on ${results[0]._id}s for maximum impact.`,
  };
}

async function busiestHour(ownerId) {
  const bookings = await Booking.find(
    { ownerId, timeSlot: { $exists: true, $ne: '' }, status: { $nin: ['cancelled'] } },
    { timeSlot: 1 }
  ).lean();
  if (!bookings.length) return { empty: true };

  const hourMap = {};
  for (const b of bookings) {
    const h = parseInt(b.timeSlot?.split(':')[0], 10);
    if (!isNaN(h)) hourMap[h] = (hourMap[h] || 0) + 1;
  }

  const sorted = Object.entries(hourMap)
    .map(([h, count]) => ({ h: parseInt(h), count }))
    .sort((a, b) => b.count - a.count);

  const top   = sorted[0];
  const max   = top.count;
  const breakdown = sorted.slice(0, 8).map(({ h, count }) => ({ label: fmtHour(h), count }));

  return {
    headline: fmtHour(top.h),
    subline: `${top.count} bookings in that hour`,
    breakdown,
    max,
    tip: `Make sure to have enough staff available around ${fmtHour(top.h)}.`,
  };
}

async function successRate(ownerId) {
  const start = thisMonthStart();
  const [total, completed, noShow, cancelled] = await Promise.all([
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start } }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'completed' }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'no-show' }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'cancelled' }),
  ]);

  const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return {
    headline: `${rate}%`,
    subline: `${completed} completed out of ${total} bookings this month`,
    breakdown: [
      { label: 'Completed', count: completed, color: 'emerald' },
      { label: 'No-shows',  count: noShow,    color: 'rose'    },
      { label: 'Cancelled', count: cancelled, color: 'amber'   },
      { label: 'Other',     count: total - completed - noShow - cancelled, color: 'slate' },
    ],
    rate,
    total,
    tip: rate >= 80
      ? 'Great success rate! Keep up the consistency.'
      : 'Consider sending reminder SMS/email 2h before appointments to reduce no-shows.',
  };
}

async function monthComparison(ownerId) {
  const [currDocs, lastDocs] = await Promise.all([
    Booking.find(
      { ownerId, appointmentDate: { $gte: thisMonthStart() }, status: { $nin: ['cancelled'] } },
      { 'service.price': 1 }
    ).lean(),
    Booking.find(
      { ownerId, appointmentDate: { $gte: lastMonthStart(), $lte: lastMonthEnd() }, status: { $nin: ['cancelled'] } },
      { 'service.price': 1 }
    ).lean(),
  ]);

  const currRev = currDocs.reduce((s, b) => s + parsePrice(b.service?.price), 0);
  const lastRev = lastDocs.reduce((s, b) => s + parsePrice(b.service?.price), 0);
  const delta   = lastRev > 0 ? Math.round(((currRev - lastRev) / lastRev) * 100) : 0;
  const isUp    = currRev >= lastRev;

  return {
    headline: `${isUp ? '+' : ''}${delta}%`,
    subline: isUp ? 'revenue growth vs last month' : 'revenue drop vs last month',
    breakdown: [
      { label: 'This month', value: `${currRev.toFixed(2)} TND`, count: currDocs.length },
      { label: 'Last month', value: `${lastRev.toFixed(2)} TND`, count: lastDocs.length },
    ],
    isUp,
    delta,
    currRev,
    lastRev,
    tip: isUp
      ? `You\'re up ${delta}% vs last month — great momentum!`
      : 'Consider a promotional campaign to boost bookings this month.',
  };
}

async function topServices(ownerId) {
  const results = await Booking.aggregate([
    { $match: { ownerId, status: { $nin: ['cancelled'] } } },
    { $group: { _id: '$service.title', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 7 },
  ]);
  if (!results.length) return { empty: true };

  const max = results[0].count;
  return {
    headline: results[0]._id || 'N/A',
    subline: `booked ${results[0].count} times total`,
    breakdown: results.map(r => ({ label: r._id || 'Unnamed', count: r.count })),
    max,
    tip: `Promote "${results[0]._id}" in your marketing — it\'s your crowd-pleaser.`,
  };
}

async function revenueByService(ownerId) {
  const bookings = await Booking.find(
    { ownerId, status: { $nin: ['cancelled'] } },
    { 'service.title': 1, 'service.price': 1 }
  ).lean();
  if (!bookings.length) return { empty: true };

  const map = {};
  for (const b of bookings) {
    const title = b.service?.title || 'Unnamed';
    const price = parsePrice(b.service?.price);
    if (!map[title]) map[title] = { revenue: 0, count: 0 };
    map[title].revenue += price;
    map[title].count++;
  }

  const sorted = Object.entries(map)
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 7);

  const max = sorted[0]?.revenue || 1;
  return {
    headline: sorted[0]?.label || 'N/A',
    subline: `${sorted[0]?.revenue.toFixed(2)} TND earned from this service`,
    breakdown: sorted.map(s => ({ label: s.label, value: `${s.revenue.toFixed(2)} TND`, count: s.count })),
    max,
    tip: `"${sorted[0]?.label}" is your top earner — consider a premium upsell package around it.`,
  };
}

async function topClients(ownerId) {
  const results = await Booking.aggregate([
    { $match: { ownerId, status: { $nin: ['cancelled'] } } },
    {
      $group: {
        _id: '$customerEmail',
        name: { $first: '$customerName' },
        count: { $sum: 1 },
        lastVisit: { $max: '$appointmentDate' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 7 },
  ]);
  if (!results.length) return { empty: true };

  return {
    headline: results[0].name || results[0]._id,
    subline: `${results[0].count} bookings — your most loyal client`,
    breakdown: results.map(r => ({
      label: r.name || r._id,
      count: r.count,
      lastVisit: r.lastVisit
        ? new Date(r.lastVisit).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'N/A',
    })),
    max: results[0].count,
    tip: `Reward your top clients with a loyalty discount to keep them coming back.`,
  };
}

async function inactiveClients(ownerId) {
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const [allEmails, recentEmails] = await Promise.all([
    Booking.distinct('customerEmail', { ownerId }),
    Booking.distinct('customerEmail', { ownerId, appointmentDate: { $gte: cutoff }, status: { $nin: ['cancelled'] } }),
  ]);

  const recentSet      = new Set(recentEmails);
  const inactiveCount  = allEmails.filter(e => !recentSet.has(e)).length;
  const totalClients   = allEmails.length;

  return {
    headline: `${inactiveCount}`,
    subline: `clients haven't booked in 45+ days`,
    inactiveCount,
    totalClients,
    breakdown: [
      { label: 'Inactive 45+ days', count: inactiveCount, color: 'amber' },
      { label: 'Active recently',   count: totalClients - inactiveCount, color: 'emerald' },
    ],
    tip: inactiveCount > 0
      ? `Send a win-back promo to your ${inactiveCount} inactive clients — a simple "We miss you" discount can recover 20–30%.`
      : 'Great retention! All your clients have been active recently.',
  };
}

async function newClientsMonth(ownerId) {
  const start = thisMonthStart();
  const [newResult, allEmails] = await Promise.all([
    Booking.aggregate([
      { $match: { ownerId } },
      { $sort: { appointmentDate: 1 } },
      { $group: { _id: '$customerEmail', firstBooking: { $first: '$appointmentDate' } } },
      { $match: { firstBooking: { $gte: start } } },
      { $count: 'count' },
    ]),
    Booking.distinct('customerEmail', { ownerId }),
  ]);

  const newCount = newResult[0]?.count || 0;
  const total    = allEmails.length;
  const returning = total - newCount;

  return {
    headline: `${newCount}`,
    subline: `new clients acquired this month`,
    breakdown: [
      { label: 'New this month',  count: newCount,   color: 'indigo'  },
      { label: 'Returning',       count: returning,  color: 'emerald' },
    ],
    max: Math.max(newCount, returning, 1),
    tip: newCount > 0
      ? `${newCount} new clients found you this month — make sure their first experience is unforgettable.`
      : 'No new clients yet this month. Consider promoting your profile on social media.',
  };
}

async function avgTicket(ownerId) {
  const bookings = await Booking.find(
    { ownerId, status: { $nin: ['cancelled'] } },
    { 'service.price': 1, customerEmail: 1 }
  ).lean();
  if (!bookings.length) return { empty: true };

  const revenue        = bookings.reduce((s, b) => s + parsePrice(b.service?.price), 0);
  const uniqueClients  = new Set(bookings.map(b => b.customerEmail)).size;
  const avgPerApt      = revenue / bookings.length;
  const avgPerClient   = revenue / uniqueClients;

  return {
    headline: `${avgPerApt.toFixed(2)} TND`,
    subline: `average revenue per appointment`,
    breakdown: [
      { label: 'Avg / appointment', value: `${avgPerApt.toFixed(2)} TND` },
      { label: 'Avg / client',       value: `${avgPerClient.toFixed(2)} TND` },
      { label: 'Total revenue',      value: `${revenue.toFixed(2)} TND` },
      { label: 'Total appointments', value: `${bookings.length}` },
    ],
    tip: `Try bundling services to push your average ticket above ${(avgPerApt * 1.2).toFixed(0)} TND.`,
  };
}

async function noShows(ownerId) {
  const start = thisMonthStart();
  const [total, noShow] = await Promise.all([
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start } }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'no-show' }),
  ]);

  const rate = total > 0 ? Math.round((noShow / total) * 100) : 0;
  return {
    headline: `${noShow}`,
    subline: `no-shows this month (${rate}% of bookings)`,
    breakdown: [
      { label: 'No-shows',  count: noShow,         color: 'rose'    },
      { label: 'Showed up', count: total - noShow, color: 'emerald' },
    ],
    rate,
    total,
    tip: noShow > 0
      ? 'Enable 2h-before reminders on your booking settings to cut no-shows significantly.'
      : 'Zero no-shows this month — excellent!',
  };
}

async function cancellationRate(ownerId) {
  const start = thisMonthStart();
  const [total, cancelled] = await Promise.all([
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start } }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'cancelled' }),
  ]);

  const rate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
  return {
    headline: `${rate}%`,
    subline: `cancellation rate this month`,
    breakdown: [
      { label: 'Cancelled',     count: cancelled,         color: 'rose'    },
      { label: 'Not cancelled', count: total - cancelled, color: 'emerald' },
    ],
    rate,
    cancelled,
    total,
    tip: rate > 20
      ? 'High cancellation rate — consider a deposit policy to reduce last-minute cancellations.'
      : rate === 0
      ? 'Zero cancellations this month — perfect!'
      : 'Cancellation rate is healthy. Keep it up.',
  };
}

async function quickStats(ownerId) {
  const start = thisMonthStart();
  const [total, completed, noShow, cancelled, allClients] = await Promise.all([
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start } }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'completed' }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'no-show' }),
    Booking.countDocuments({ ownerId, appointmentDate: { $gte: start }, status: 'cancelled' }),
    Booking.distinct('customerEmail', { ownerId }),
  ]);

  return {
    total,
    completed,
    noShow,
    cancelled,
    successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    totalClients: allClients.length,
    questionsAvailable: 12,
  };
}

// ─── Main handler ────────────────────────────────────────────────────────────

export const getSmartInsight = async (req, res) => {
  const { type } = req.params;
  const ownerId  = req.user._id;

  const handlers = {
    busiest_day:       () => busiestDay(ownerId),
    busiest_hour:      () => busiestHour(ownerId),
    success_rate:      () => successRate(ownerId),
    month_comparison:  () => monthComparison(ownerId),
    top_services:      () => topServices(ownerId),
    revenue_by_service:() => revenueByService(ownerId),
    top_clients:       () => topClients(ownerId),
    inactive_clients:  () => inactiveClients(ownerId),
    new_clients_month: () => newClientsMonth(ownerId),
    avg_ticket:        () => avgTicket(ownerId),
    no_shows:          () => noShows(ownerId),
    cancellation_rate: () => cancellationRate(ownerId),
    quick_stats:       () => quickStats(ownerId),
  };

  if (!handlers[type]) {
    return res.status(400).json({ success: false, message: 'Unknown insight type.' });
  }

  try {
    const data = await handlers[type]();
    return res.json({ success: true, data });
  } catch (err) {
    console.error(`[AI_ASSISTANT] ${type}: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Failed to compute insight.' });
  }
};
