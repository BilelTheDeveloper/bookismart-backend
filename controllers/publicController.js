import Website from '../models/Website.js';
import User from '../models/User.js';
import Review from '../models/Review.js';
import Booking from '../models/Booking.js';
import Consultation from '../models/Consultation.js';
import crypto from 'crypto';
import { bustPublic, bustPublicPrefix } from '../middleware/cache.js';

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPER — aggregate trust metrics for a set of ownerIds in one query
// Returns a map keyed by ownerId string
// ─────────────────────────────────────────────────────────────────────────────
const buildTrustMap = async (ownerIds) => {
  const [ratingsAgg, bookingAgg] = await Promise.all([
    Review.aggregate([
      { $match: { ownerId: { $in: ownerIds }, status: 'published' } },
      {
        $group: {
          _id: '$ownerId',
          avgRating:   { $avg: '$rating' },
          reviewCount: { $sum: 1 },
          recentReviews: {
            $push: {
              rating: '$rating',
              text: '$text',
              customerName: '$customerName',
              createdAt: '$createdAt',
            },
          },
        },
      },
    ]),
    Booking.aggregate([
      {
        $match: {
          ownerId: { $in: ownerIds },
          status: { $in: ['completed', 'confirmed', 'cancelled', 'no-show'] },
        },
      },
      {
        $group: {
          _id: '$ownerId',
          completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          confirmedCount: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          uniqueEmails: { $addToSet: '$customerEmail' },
          avgResponseMs: {
            $avg: {
              $cond: [
                { $and: [{ $ne: ['$confirmedAt', null] }, { $gt: ['$confirmedAt', '$createdAt'] }] },
                { $subtract: ['$confirmedAt', '$createdAt'] },
                null,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const trustMap = {};

  // Seed from bookings
  bookingAgg.forEach((r) => {
    const total = r.completedCount + r.confirmedCount + r.cancelledCount;
    trustMap[String(r._id)] = {
      completedCount:    r.completedCount,
      uniqueClients:     r.uniqueEmails.length,
      cancellationRate:  total > 0 ? Math.round((r.cancelledCount / total) * 100) : 0,
      avgResponseHours:  r.avgResponseMs ? Math.round(r.avgResponseMs / 3600000 * 10) / 10 : null,
    };
  });

  // Merge ratings
  ratingsAgg.forEach((r) => {
    const key = String(r._id);
    if (!trustMap[key]) trustMap[key] = {};
    trustMap[key].rating      = Math.round(r.avgRating * 10) / 10;
    trustMap[key].reviewCount = r.reviewCount;
    // Keep only last 3 reviews (sorted by createdAt desc) for card snippets
    trustMap[key].recentReviews = r.recentReviews
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 3);
  });

  return trustMap;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. DISCOVERY FEED — with real ratings, trust metrics, filters, and search
// ─────────────────────────────────────────────────────────────────────────────
export const getDiscoveryFeed = async (req, res) => {
  try {
    const {
      city,
      category,
      sort = 'rating',
      search,
    } = req.query;

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 60));

    const websiteFilter = { verificationStatus: 'approved', isPublished: true };
    const ownerMatch = {};
    if (city)     ownerMatch.ville    = city;
    if (category) ownerMatch.category = category;

    let websites = await Website.find(websiteFilter)
      .populate({
        path: 'ownerId',
        select: 'fullName ville businessName category profilePicUrl',
        ...(Object.keys(ownerMatch).length > 0 ? { match: ownerMatch } : {}),
      })
      .select('slug category hero services contact setupConfig gallery businessHours ownerId lastUpdated')
      .sort({ lastUpdated: -1 })
      .limit(limit)
      .lean();

    websites = websites.filter((w) => w.ownerId);

    const ownerIds = websites.map((w) => w.ownerId._id);
    const trustMap = await buildTrustMap(ownerIds);

    let results = websites.map((w) => {
      const tm = trustMap[String(w.ownerId._id)] || {};
      return {
        ...w,
        rating:           tm.rating      ?? null,
        reviewCount:      tm.reviewCount ?? 0,
        completedCount:   tm.completedCount  ?? 0,
        uniqueClients:    tm.uniqueClients   ?? 0,
        cancellationRate: tm.cancellationRate ?? 0,
        avgResponseHours: tm.avgResponseHours ?? null,
        recentReviews:    tm.recentReviews   ?? [],
      };
    });

    if (search) {
      const s = search.trim().toLowerCase();
      results = results.filter(
        (r) =>
          r.ownerId?.businessName?.toLowerCase().includes(s) ||
          r.ownerId?.fullName?.toLowerCase().includes(s) ||
          r.ownerId?.ville?.toLowerCase().includes(s) ||
          r.category?.toLowerCase().includes(s)
      );
    }

    if (sort === 'rating')    results.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === 'reviews')   results.sort((a, b) => b.reviewCount - a.reviewCount);
    if (sort === 'completed') results.sort((a, b) => b.completedCount - a.completedCount);

    res.status(200).json({ success: true, data: results, total: results.length });
  } catch (err) {
    console.error('[DISCOVERY_FEED_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Discovery feed offline.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. DISCOVERY STATS — hero counters
// ─────────────────────────────────────────────────────────────────────────────
export const getDiscoveryStats = async (req, res) => {
  try {
    const [total, cities, reviewCount, completedCount] = await Promise.all([
      Website.countDocuments({ verificationStatus: 'approved', isPublished: true }),
      User.distinct('ville', { accountStatus: 'active' }),
      Review.countDocuments({ status: 'published' }),
      Booking.countDocuments({ status: 'completed' }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        businesses: total,
        cities:     cities.length,
        reviews:    reviewCount,
        completed:  completedCount,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Stats unavailable.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SINGLE WEBSITE BY SLUG — public storefront + full trust data
// ─────────────────────────────────────────────────────────────────────────────
export const getWebsiteBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const website = await Website.findOne({
      slug,
      verificationStatus: 'approved',
    })
      .populate('ownerId', 'fullName ville category businessName profilePicUrl')
      .lean();

    if (!website) {
      return res.status(404).json({
        success: false,
        message: 'Website not found or pending review.',
      });
    }

    const ownerId = website.ownerId._id;
    const [trustMap, topReviews] = await Promise.all([
      buildTrustMap([ownerId]),
      Review.find({ ownerId, status: 'published' })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const tm = trustMap[String(ownerId)] || {};

    res.status(200).json({
      success: true,
      data: {
        ...website,
        rating:           tm.rating           ?? null,
        reviewCount:      tm.reviewCount       ?? 0,
        completedCount:   tm.completedCount    ?? 0,
        uniqueClients:    tm.uniqueClients     ?? 0,
        cancellationRate: tm.cancellationRate  ?? 0,
        avgResponseHours: tm.avgResponseHours  ?? null,
        reviews:          topReviews,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving website profile.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. PUBLIC REVIEWS — paginated list for a profile
// GET /public/reviews/:ownerId?page=1&limit=10
// ─────────────────────────────────────────────────────────────────────────────
export const getPublicReviews = async (req, res) => {
  try {
    const { ownerId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.max(1, Math.min(20, parseInt(req.query.limit) || 10));
    const skip  = (page - 1) * limit;

    const [reviews, total, agg] = await Promise.all([
      Review.find({ ownerId, status: 'published' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('customerName rating text createdAt')
        .lean(),
      Review.countDocuments({ ownerId, status: 'published' }),
      Review.aggregate([
        { $match: { ownerId: new (await import('mongoose')).default.Types.ObjectId(ownerId), status: 'published' } },
        {
          $group: {
            _id: null,
            avgRating: { $avg: '$rating' },
            dist: { $push: '$rating' },
          },
        },
      ]),
    ]);

    const avgRating = agg[0]?.avgRating ? Math.round(agg[0].avgRating * 10) / 10 : null;
    const dist = [5, 4, 3, 2, 1].map((star) => ({
      star,
      count: agg[0]?.dist.filter((r) => r === star).length ?? 0,
    }));

    res.status(200).json({
      success: true,
      data: { reviews, avgRating, distribution: dist, total, page, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not load reviews.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. REVIEW LOOKUP — verify token and return booking info (for ReviewPage)
// GET /public/reviews/lookup?token=...
// ─────────────────────────────────────────────────────────────────────────────
export const reviewLookup = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: 'Token required.' });

    const booking = await Booking.findOne({ reviewToken: token }).select(
      'customerName service dateString ownerId reviewSubmittedAt'
    );
    if (!booking) return res.status(404).json({ success: false, message: 'Invalid or expired review link.' });
    if (booking.reviewSubmittedAt) {
      return res.status(409).json({ success: false, message: 'You already submitted a review for this booking.', alreadySubmitted: true });
    }

    const owner = await User.findById(booking.ownerId).select('businessName fullName');

    res.status(200).json({
      success: true,
      data: {
        customerName: booking.customerName,
        service:      booking.service?.title,
        date:         booking.dateString,
        businessName: owner?.businessName || owner?.fullName,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Review lookup failed.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. SUBMIT REVIEW — token-based public submission
// POST /public/reviews/submit  { token, rating, text }
// ─────────────────────────────────────────────────────────────────────────────
export const submitPublicReview = async (req, res) => {
  try {
    const { token, rating, text } = req.body;

    if (!token || !rating) {
      return res.status(400).json({ success: false, message: 'Token and rating are required.' });
    }
    const parsedRating = parseInt(rating);
    if (parsedRating < 1 || parsedRating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be 1–5.' });
    }

    const booking = await Booking.findOne({ reviewToken: token });
    if (!booking) return res.status(404).json({ success: false, message: 'Invalid or expired review link.' });
    if (booking.reviewSubmittedAt) {
      return res.status(409).json({ success: false, message: 'Review already submitted.' });
    }

    await Review.create({
      ownerId:      booking.ownerId,
      bookingId:    booking._id,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
      rating:       parsedRating,
      text:         (text || '').trim().slice(0, 1200),
      status:       'published',
    });

    booking.reviewSubmittedAt = new Date();
    booking.reviewToken = '';
    await booking.save();

    // Invalidate review pages and the site's trust metrics (fire-and-forget)
    const ownerId = booking.ownerId.toString();
    bustPublicPrefix(`rev:${ownerId}:`).catch(() => {});
    // Look up the slug so we can bust the public site cache too
    Website.findOne({ ownerId: booking.ownerId }).select('slug').lean()
      .then(site => { if (site?.slug) bustPublic('site', site.slug).catch(() => {}); })
      .catch(() => {});

    res.status(201).json({ success: true, message: 'Thank you! Your review has been published.' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'A review for this booking already exists.' });
    }
    console.error('[SUBMIT_REVIEW_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Could not submit review.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. WAITING ROOM DISPLAY — public live queue screen
// GET /public/display/:slug
// Returns only non-confidential info: first name, position, time slot, duration
// ─────────────────────────────────────────────────────────────────────────────
export const getDisplayQueue = async (req, res) => {
  try {
    const { slug } = req.params;

    const website = await Website.findOne({ slug }).select('ownerId hero name').lean();
    if (!website) {
      return res.status(404).json({ success: false, message: 'Display not found.' });
    }

    const ownerId   = website.ownerId;
    const todayStr  = new Date().toISOString().slice(0, 10);

    const consultations = await Consultation.find(
      {
        ownerId,
        dateString: todayStr,
        status: { $in: ['in_progress', 'waiting'] },
      },
      {
        customerName:          1,
        timeSlot:              1,
        serviceDurationMinutes:1,
        status:                1,
        startedAt:             1,
        remainingSeconds:      1,
      }
    )
      .sort({ timeSlot: 1 })
      .lean();

    // Strip to first name only — privacy-safe
    const queue = consultations.map((c, index) => ({
      position:        index + 1,
      firstName:       (c.customerName || '').trim().split(' ')[0] || '—',
      timeSlot:        c.timeSlot,
      durationMinutes: c.serviceDurationMinutes,
      status:          c.status,
      remainingSeconds:c.status === 'in_progress' ? (c.remainingSeconds ?? 0) : null,
      startedAt:       c.status === 'in_progress' ? c.startedAt : null,
    }));

    return res.json({
      success: true,
      data: {
        businessName: website.name || website.hero?.title || 'Bookiify',
        todayStr,
        serverTime:   new Date().toISOString(),
        queue,
        currentCount: queue.filter(q => q.status === 'in_progress').length,
        waitingCount: queue.filter(q => q.status === 'waiting').length,
      },
    });
  } catch (err) {
    console.error('[DISPLAY_QUEUE_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to load queue.' });
  }
};
