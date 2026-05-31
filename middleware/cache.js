import { redis } from '../config/redis.js';
import crypto from 'crypto';

// Bump V to instantly bust every cache key across all namespaces
const V   = 'v1';
const PUB = `c:${V}:pub`;
const PRV = `c:${V}:prv`;

// ─── TTL CONSTANTS (seconds) ──────────────────────────────────────────────────
export const TTL = {
  DISCOVERY:       120,  // 2 min  — business listing
  DISCOVERY_STATS: 300,  // 5 min  — hero counters (changes only when new businesses join)
  SITE:            600,  // 10 min — public storefront (heavy aggregate)
  REVIEWS:         300,  // 5 min  — paginated review pages
  DISPLAY:          20,  // 20 s   — live waiting-room queue
  BOOKING_INFO:    300,  // 5 min  — services + hours for booking page
  SLOTS:            45,  // 45 s   — available slots (invalidated on every booking)
  ANALYTICS:       300,  // 5 min  — dashboard analytics (expensive aggregate)
  KPI:             180,  // 3 min  — KPI summary cards
  MY_WEBSITE:      600,  // 10 min — owner's own website config
  CUSTOMER_LIST:   180,  // 3 min  — merchant customer list
  BOOKING_LIST:     60,  // 1 min  — paginated booking list
};

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex');

// Deterministic hash of query params → compact 12-char key segment
export const hashQuery = (obj) => sha1(JSON.stringify(obj)).slice(0, 12);

// ETag from response body — quoted per RFC 7232
const makeEtag = (data) => `"${sha1(JSON.stringify(data)).slice(0, 16)}"`;

// Sanitise a key segment: only alphanumerics + . _ - ; reject anything else
const safe = (s) => String(s ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);

// ─── PUBLIC CACHE MIDDLEWARE ───────────────────────────────────────────────────
// Shared across ALL users — NEVER include user-identifying data in the key.
//
// segments(req) → string[]   key segments that make the response unique
// ttl           → number      seconds to keep the entry alive in Redis
//
// Behaviour:
//  - HIT  → return JSON + ETag; support 304 Not Modified
//  - MISS  → let handler run, intercept res.json(), store in Redis
//  - Redis down → transparent pass-through (fail-open)
// ──────────────────────────────────────────────────────────────────────────────
export function publicCache(segments, ttl) {
  return async (req, res, next) => {
    let key;
    try {
      key = `${PUB}:${segments(req).map(safe).join(':')}`;
    } catch {
      return next(); // key builder threw — don't cache this request
    }

    // ── Cache read ────────────────────────────────────────────────────────────
    try {
      const raw = await redis.get(key);
      if (raw) {
        const data = JSON.parse(raw);
        const tag  = makeEtag(data);

        // Conditional GET — save bandwidth if client has fresh copy
        if (req.headers['if-none-match'] === tag) {
          return res.status(304).end();
        }

        res.set({
          'ETag':          tag,
          'X-Cache':       'HIT',
          // Override the global no-store header set in server.js for public data.
          // Half TTL for browser max-age; full TTL window for SWR background refresh.
          'Cache-Control': `public, max-age=${Math.floor(ttl / 2)}, stale-while-revalidate=${ttl}`,
        });
        return res.json(data);
      }
    } catch {
      // Redis read failed — continue without cache
    }

    // ── Cache write (intercept res.json) ──────────────────────────────────────
    const _json = res.json.bind(res);
    res.json = async function (data) {
      if (res.statusCode === 200) {
        try {
          await redis.setEx(key, ttl, JSON.stringify(data));
          const tag = makeEtag(data);
          res.set({ 'ETag': tag, 'X-Cache': 'MISS' });
        } catch {
          // Redis write failed — non-fatal, response still goes through
        }
      }
      return _json(data);
    };

    next();
  };
}

// ─── PRIVATE CACHE MIDDLEWARE ──────────────────────────────────────────────────
// Scoped to req.user._id — a different user NEVER receives another user's data.
//
// Security invariant: if req.user._id is absent the middleware is a no-op.
// The private cache deliberately does NOT set Cache-Control: public, so the
// global no-store header from server.js remains in effect for the browser.
// ──────────────────────────────────────────────────────────────────────────────
export function privateCache(segments, ttl) {
  return async (req, res, next) => {
    // Hard guard — authenticated routes only
    if (!req.user?._id) return next();

    let key;
    try {
      const uid = req.user._id.toString();
      key = `${PRV}:${uid}:${segments(req).map(safe).join(':')}`;
    } catch {
      return next();
    }

    // ── Cache read ────────────────────────────────────────────────────────────
    try {
      const raw = await redis.get(key);
      if (raw) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(raw));
      }
    } catch {
      // Redis read failed — continue
    }

    // ── Cache write (intercept res.json) ──────────────────────────────────────
    const _json = res.json.bind(res);
    res.json = async function (data) {
      if (res.statusCode === 200) {
        try {
          await redis.setEx(key, ttl, JSON.stringify(data));
          res.set('X-Cache', 'MISS');
        } catch {
          // non-fatal
        }
      }
      return _json(data);
    };

    next();
  };
}

// ─── INVALIDATION HELPERS ─────────────────────────────────────────────────────
// All helpers are fire-and-forget safe — call with .catch(() => {}).
// They fail silently so a Redis outage never blocks a write request.

/** Delete one specific public cache key. */
export async function bustPublic(...segs) {
  const key = `${PUB}:${segs.map(safe).join(':')}`;
  try { await redis.del(key); } catch { /* silent */ }
}

/** Delete one specific private (user-scoped) cache key. */
export async function bustPrivate(userId, ...segs) {
  const key = `${PRV}:${safe(userId)}:${segs.map(safe).join(':')}`;
  try { await redis.del(key); } catch { /* silent */ }
}

/**
 * Delete ALL public keys that start with a given prefix.
 * Uses SCAN — never blocks Redis the way KEYS* would.
 * Example: bustPublicPrefix('rev:6642...abc:') clears all paginated review pages.
 */
export async function bustPublicPrefix(prefix) {
  await _scanDel(`${PUB}:${prefix}`);
}

/**
 * Delete ALL private keys for one user that start with a given prefix.
 * Example: bustPrivatePrefix(uid, 'bookings:') clears every paginated booking list.
 */
export async function bustPrivatePrefix(userId, prefix) {
  await _scanDel(`${PRV}:${safe(userId)}:${prefix}`);
}

// SCAN-based deletion — O(N) on matching keys only, non-blocking cursor loop.
async function _scanDel(prefix) {
  try {
    let cursor = 0;
    do {
      const { cursor: next, keys } = await redis.scan(cursor, {
        MATCH: `${prefix}*`,
        COUNT: 100,
      });
      cursor = next;
      if (keys.length > 0) await redis.del(keys);
    } while (cursor !== 0);
  } catch { /* silent */ }
}
