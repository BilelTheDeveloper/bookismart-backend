import Website from '../models/Website.js';
import User from '../models/User.js';
import Review from '../models/Review.js';

// ─────────────────────────────────────────────────────────────────────────────
// 1. DISCOVERY FEED — with real ratings, filters, and search
// ─────────────────────────────────────────────────────────────────────────────
export const getDiscoveryFeed = async (req, res) => {
  try {
    const {
      city,
      category,
      sort = 'rating', // 'rating' | 'reviews' | 'newest'
      search,
      limit = 60,
    } = req.query;

    // Base filter — only live, approved sites
    const websiteFilter = { verificationStatus: 'approved', isPublished: true };

    // Owner-level filters applied via populate match
    const ownerMatch = {};
    if (city)     ownerMatch.ville     = city;
    if (category) ownerMatch.category  = category;

    let websites = await Website.find(websiteFilter)
      .populate({
        path: 'ownerId',
        select: 'fullName ville businessName category profilePicUrl',
        ...(Object.keys(ownerMatch).length > 0 ? { match: ownerMatch } : {}),
      })
      .select('slug category hero services contact setupConfig gallery ownerId lastUpdated')
      .sort({ lastUpdated: -1 })
      .limit(Number(limit))
      .lean();

    // Populate match nullifies non-matching owners — filter them out
    websites = websites.filter((w) => w.ownerId);

    // Aggregate real ratings in one query
    const ownerIds = websites.map((w) => w.ownerId._id);
    const ratingsAgg = await Review.aggregate([
      { $match: { ownerId: { $in: ownerIds }, status: 'published' } },
      {
        $group: {
          _id: '$ownerId',
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);
    const ratingsMap = {};
    ratingsAgg.forEach((r) => {
      ratingsMap[String(r._id)] = { avg: Math.round(r.avgRating * 10) / 10, count: r.count };
    });

    // Attach rating to each result
    let results = websites.map((w) => {
      const rid = String(w.ownerId._id);
      return {
        ...w,
        rating: ratingsMap[rid]?.avg ?? null,
        reviewCount: ratingsMap[rid]?.count ?? 0,
      };
    });

    // Text search across business name, owner name, city, category
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

    // Sort
    if (sort === 'rating')  results.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    if (sort === 'reviews') results.sort((a, b) => b.reviewCount - a.reviewCount);
    // 'newest' is already the default DB sort above

    res.status(200).json({ success: true, data: results, total: results.length });
  } catch (err) {
    console.error('[DISCOVERY_FEED_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Discovery feed offline.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. DISCOVERY STATS — hero counters (businesses, cities, reviews)
// ─────────────────────────────────────────────────────────────────────────────
export const getDiscoveryStats = async (req, res) => {
  try {
    const [total, cities, reviewCount] = await Promise.all([
      Website.countDocuments({ verificationStatus: 'approved', isPublished: true }),
      User.distinct('ville', { accountStatus: 'active' }),
      Review.countDocuments({ status: 'published' }),
    ]);

    res.status(200).json({
      success: true,
      data: { businesses: total, cities: cities.length, reviews: reviewCount },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Stats unavailable.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. SINGLE WEBSITE BY SLUG — for public storefront visit
// ─────────────────────────────────────────────────────────────────────────────
export const getWebsiteBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const website = await Website.findOne({
      slug,
      verificationStatus: 'approved',
    }).populate('ownerId', 'fullName ville category businessName profilePicUrl');

    if (!website) {
      return res.status(404).json({
        success: false,
        message: 'Website not found or pending review.',
      });
    }

    res.status(200).json({ success: true, data: website });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error retrieving website profile.' });
  }
};
