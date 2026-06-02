/**
 * Bookiify — Plan Catalog (single source of truth for billing).
 *
 * Tunisia-launch pricing (TND/month, 30-day free trial on every plan):
 *   Individual    → Solo Starter (19), Solo Pro (39)
 *   Organization  → Team (59), Business (99), Enterprise (149–199 / custom)
 *
 * Every plan ships with a 30-day free trial. During the trial the merchant
 * gets FULL access to every feature with no limits — gating only applies once
 * the trial ends and a paid plan takes over. This keeps the "easy yes" for the
 * Tunisia market while still letting the app enforce entitlements per tier.
 *
 * Frontend display strings (names / feature bullets / CTA) live in i18n under
 * `home.pricing.*`; this file owns the *logic* (price, limits, feature flags).
 */

export const TRIAL_DAYS = 30;
export const CURRENCY = 'TND';

/** Sentinel: unlimited. Serialized to `null` over the API. */
export const UNLIMITED = Infinity;

/* ── Feature keys (the vocabulary used by requireFeature + the UI) ── */
export const FEATURES = {
  BOOKING: 'booking',
  PUBLIC_PAGE: 'publicPage',
  CRM: 'crm',
  REMINDERS: 'reminders',
  BASIC_WEBSITE: 'basicWebsite',
  INVOICES: 'invoices',
  LOYALTY: 'loyalty',
  BASIC_ANALYTICS: 'basicAnalytics',
  UNLIMITED_BOOKINGS: 'unlimitedBookings',
  WEBSITE_BUILDER: 'websiteBuilder',
  AI_SITE_GENERATOR: 'aiSiteGenerator',
  PACKAGES: 'packages',
  GIFT_CARDS: 'giftCards',
  MARKETING: 'marketing',
  ADVANCED_ANALYTICS: 'advancedAnalytics',
  STAFF: 'staff',
  TEAM_SCHEDULING: 'teamScheduling',
  FINANCE_DASHBOARD: 'financeDashboard',
  PAYMENTS: 'payments',
  CHAT_WORKMODE: 'chatWorkMode',
  MULTI_BRANCH: 'multiBranch',
  RECRUITMENT: 'recruitment',
  MARKETING_AUTOMATION: 'marketingAutomation',
  PERMISSIONS: 'permissions',
  PRIORITY_SUPPORT: 'prioritySupport',
  PREMIUM_SUPPORT: 'premiumSupport',
  CUSTOM_SETUP: 'customSetup',
};

const F = FEATURES;

/** Baseline every plan (and every trial) includes. */
const BASE = [
  F.BOOKING, F.PUBLIC_PAGE, F.CRM, F.REMINDERS,
  F.BASIC_WEBSITE, F.INVOICES, F.LOYALTY, F.BASIC_ANALYTICS,
];

/** Every feature there is — used for trial (full access). */
export const ALL_FEATURES = Object.values(FEATURES);

/* ── The plans ── */
export const PLANS = {
  solo_starter: {
    id: 'solo_starter',
    i18nKey: 'soloStarter',
    name: 'Solo Starter',
    audience: 'individual',
    priceTND: 19,
    custom: false,
    trialDays: TRIAL_DAYS,
    limits: { staff: 0, branches: 1, bookingsPerMonth: 200 },
    features: [...BASE],
  },
  solo_pro: {
    id: 'solo_pro',
    i18nKey: 'soloPro',
    name: 'Solo Pro',
    audience: 'individual',
    priceTND: 39,
    custom: false,
    popular: true,
    trialDays: TRIAL_DAYS,
    limits: { staff: 1, branches: 1, bookingsPerMonth: UNLIMITED },
    features: [
      ...BASE,
      F.UNLIMITED_BOOKINGS, F.WEBSITE_BUILDER, F.AI_SITE_GENERATOR,
      F.PACKAGES, F.GIFT_CARDS, F.MARKETING, F.ADVANCED_ANALYTICS,
      F.PRIORITY_SUPPORT,
    ],
  },
  team: {
    id: 'team',
    i18nKey: 'team',
    name: 'Team',
    audience: 'organization',
    priceTND: 59,
    custom: false,
    trialDays: TRIAL_DAYS,
    limits: { staff: 5, branches: 1, bookingsPerMonth: UNLIMITED },
    features: [
      ...BASE,
      F.UNLIMITED_BOOKINGS, F.STAFF, F.TEAM_SCHEDULING, F.FINANCE_DASHBOARD,
      F.WEBSITE_BUILDER, F.AI_SITE_GENERATOR, F.PAYMENTS, F.CHAT_WORKMODE,
    ],
  },
  business: {
    id: 'business',
    i18nKey: 'business',
    name: 'Business',
    audience: 'organization',
    priceTND: 99,
    custom: false,
    popular: true,
    trialDays: TRIAL_DAYS,
    limits: { staff: 20, branches: 10, bookingsPerMonth: UNLIMITED },
    features: [
      ...BASE,
      F.UNLIMITED_BOOKINGS, F.STAFF, F.TEAM_SCHEDULING, F.FINANCE_DASHBOARD,
      F.WEBSITE_BUILDER, F.AI_SITE_GENERATOR, F.PAYMENTS, F.CHAT_WORKMODE,
      F.MULTI_BRANCH, F.ADVANCED_ANALYTICS, F.RECRUITMENT,
      F.MARKETING, F.MARKETING_AUTOMATION, F.PERMISSIONS,
      F.PACKAGES, F.GIFT_CARDS, F.PRIORITY_SUPPORT,
    ],
  },
  enterprise: {
    id: 'enterprise',
    i18nKey: 'enterprise',
    name: 'Enterprise',
    audience: 'organization',
    priceTND: 199,        // 149–199 range; used as checkout fallback before custom quote
    priceMinTND: 149,
    custom: true,
    trialDays: TRIAL_DAYS,
    limits: { staff: UNLIMITED, branches: UNLIMITED, bookingsPerMonth: UNLIMITED },
    features: [...ALL_FEATURES],
  },
};

/** Plan keys shown per audience, in display order. */
export const PLAN_KEYS_BY_AUDIENCE = {
  individual: ['solo_starter', 'solo_pro'],
  organization: ['team', 'business', 'enterprise'],
};

/** Legacy plan ids (pre-relaunch) → current ids, so old user docs keep working. */
const LEGACY_MAP = {
  basic: 'solo_starter',
  premium: 'solo_pro',
  pro: 'team',
};

/* ── Helpers ── */
export const getPlan = (id) => PLANS[id] || PLANS[LEGACY_MAP[id]] || null;

export const plansForAudience = (audience) =>
  (PLAN_KEYS_BY_AUDIENCE[audience] || PLAN_KEYS_BY_AUDIENCE.individual).map((id) => PLANS[id]);

const audienceOf = (user) => (user?.accountType === 'organization' ? 'organization' : 'individual');

/**
 * Is the merchant currently inside an active free trial?
 * Trial = subscription marked trialing OR still on the free_trial plan, with a
 * trialEndsAt in the future.
 */
export const isTrialActive = (user) => {
  const sub = user?.paymentInfo?.subscription;
  if (!sub) return false;
  const onTrialPlan = sub.plan === 'free_trial' || sub.status === 'trialing';
  if (!onTrialPlan) return false;
  return sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() > Date.now();
};

/**
 * Resolve everything the app needs to gate features for a user.
 * During an active trial → full access, no limits.
 */
export const resolveEntitlements = (user) => {
  const audience = audienceOf(user);
  const sub = user?.paymentInfo?.subscription || {};
  const rawPlan = sub.plan || 'free_trial';
  const trial = isTrialActive(user);
  const trialEndsAt = sub.trialEndsAt || null;
  const daysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  // Trial → full access; otherwise the resolved paid plan (fallback to starter for the audience).
  const plan = getPlan(rawPlan) ||
    (audience === 'organization' ? PLANS.team : PLANS.solo_starter);

  const features = trial ? [...ALL_FEATURES] : [...plan.features];
  const limits = trial
    ? { staff: UNLIMITED, branches: UNLIMITED, bookingsPerMonth: UNLIMITED }
    : { ...plan.limits };

  return {
    audience,
    planId: trial ? 'free_trial' : plan.id,
    planName: trial ? 'Free Trial' : plan.name,
    status: sub.status || 'trialing',
    trial: { active: trial, endsAt: trialEndsAt, daysLeft, totalDays: TRIAL_DAYS },
    features,
    limits,
  };
};

export const entitlementsHaveFeature = (ent, feature) => ent?.features?.includes(feature);

/** Limit lookup with `null` = unlimited (API-friendly). */
export const limitValue = (ent, key) => {
  const v = ent?.limits?.[key];
  return v === UNLIMITED || v === undefined ? null : v;
};

/** API-safe view of a plan (Infinity → null). */
export const serializePlan = (plan) => ({
  id: plan.id,
  i18nKey: plan.i18nKey,
  name: plan.name,
  audience: plan.audience,
  priceTND: plan.priceTND,
  priceMinTND: plan.priceMinTND ?? null,
  custom: !!plan.custom,
  popular: !!plan.popular,
  trialDays: plan.trialDays,
  limits: {
    staff: plan.limits.staff === UNLIMITED ? null : plan.limits.staff,
    branches: plan.limits.branches === UNLIMITED ? null : plan.limits.branches,
    bookingsPerMonth: plan.limits.bookingsPerMonth === UNLIMITED ? null : plan.limits.bookingsPerMonth,
  },
  features: plan.features,
});

/** API-safe view of resolved entitlements. */
export const serializeEntitlements = (ent) => ({
  ...ent,
  limits: {
    staff: ent.limits.staff === UNLIMITED ? null : ent.limits.staff,
    branches: ent.limits.branches === UNLIMITED ? null : ent.limits.branches,
    bookingsPerMonth: ent.limits.bookingsPerMonth === UNLIMITED ? null : ent.limits.bookingsPerMonth,
  },
});
