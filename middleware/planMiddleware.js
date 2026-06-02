/**
 * Plan / entitlement middleware.
 *
 * `requireFeature(feature)` blocks a route when the owner's current plan does
 * not include it. During an active free trial every feature is allowed (see
 * resolveEntitlements), so this never bites trial users — it only enforces the
 * tier the merchant chose once the trial ends.
 *
 * Use the FEATURES constants from ../config/plans.js as the argument.
 */
import User from '../models/User.js';
import { resolveEntitlements, entitlementsHaveFeature } from '../config/plans.js';

/**
 * Load the owner's entitlements and attach them to req.entitlements.
 * Cached on the request so multiple gates in one route don't re-query.
 */
export const loadEntitlements = async (req) => {
  if (req.entitlements) return req.entitlements;
  const user = await User.findById(req.user._id).select('accountType organization paymentInfo');
  req.entitlements = resolveEntitlements(user || {});
  return req.entitlements;
};

export const requireFeature = (feature) => async (req, res, next) => {
  try {
    const ent = await loadEntitlements(req);
    if (entitlementsHaveFeature(ent, feature)) return next();
    return res.status(402).json({
      success: false,
      code: 'PLAN_UPGRADE_REQUIRED',
      feature,
      planId: ent.planId,
      message: 'This feature is not included in your current plan. Upgrade to unlock it.',
    });
  } catch (err) {
    console.error('[requireFeature]', err.message);
    // Fail-open is wrong for a paywall; fail-closed with a clear message.
    return res.status(500).json({ success: false, message: 'Could not verify your plan.' });
  }
};
