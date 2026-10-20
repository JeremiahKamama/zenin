// admin/src/utils/plans.js
//
// The single source of truth for plan identity in the console.
//
// WHY THIS EXISTS
// ---------------
// The tier rename (pro -> plus, desk -> premium) left the admin console
// referencing the RETIRED ids. Every dropdown still sent `pro` or `desk`, the
// server no longer recognised them, and the write fell through to a fallback
// while still returning 200 — so changing a plan appeared to work and silently
// did nothing (or downgraded to Starter).
//
// Hardcoding option lists in three separate JSX blocks is what allowed that
// drift, so the lists live here and every dropdown renders from them.

/** Canonical plan ids, in display order. Must match the backend. */
export const PLAN_IDS = ["starter", "plus", "premium"];

/** Presentation metadata. `price` is display-only. */
export const PLANS = [
  {
    id: "starter",
    label: "Starter",
    price: 0,
    priceLabel: "Free",
    blurb: "Paper trading and market data."
  },
  {
    id: "plus",
    label: "Plus",
    price: 29,
    priceLabel: "$29/mo",
    blurb: "Live brokerage connections and alerts."
  },
  {
    id: "premium",
    label: "Premium",
    price: 99,
    priceLabel: "$99/mo",
    blurb: "Everything in Plus, plus automation and priority support."
  }
];

const PLAN_BY_ID = new Map(PLANS.map((plan) => [plan.id, plan]));

/**
 * Ids that were valid before the rename. Kept so a user row still holding a
 * legacy value renders correctly instead of showing "Unknown".
 */
const LEGACY_PLAN_IDS = { pro: "plus", desk: "premium" };

/** Resolve any stored value to a canonical plan id, or null. */
export function normalizePlanId(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (LEGACY_PLAN_ID_SET.has(raw)) return raw;
  return LEGACY_PLAN_IDS[raw] || null;
}
const LEGACY_PLAN_ID_SET = new Set(PLAN_IDS);

/** Look up presentation metadata for any value, canonical or legacy. */
export function getPlan(value) {
  const id = normalizePlanId(value);
  return id ? PLAN_BY_ID.get(id) : null;
}

/** Human label, safe for unknown values. */
export function planLabel(value) {
  const plan = getPlan(value);
  if (plan) return plan.label;
  const raw = String(value ?? "").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Unknown";
}

/** "Plus ($29/mo)" — used inside a select. */
export function planOptionLabel(value) {
  const plan = getPlan(value);
  if (!plan) return planLabel(value);
  return plan.price === 0 ? `${plan.label} (${plan.priceLabel})` : `${plan.label} (${plan.priceLabel})`;
}

/**
 * Describe a move between two plans, for the confirmation UI.
 * Returns null when the target is not a real change.
 */
export function describePlanChange(fromValue, toValue) {
  const from = normalizePlanId(fromValue);
  const to = normalizePlanId(toValue);
  if (!to) return null;
  if (from === to) return null;

  const fromPlan = from ? PLAN_BY_ID.get(from) : null;
  const toPlan = PLAN_BY_ID.get(to);
  const delta = (toPlan?.price || 0) - (fromPlan?.price || 0);

  return {
    from: fromPlan,
    to: toPlan,
    isUpgrade: delta > 0,
    isDowngrade: delta < 0,
    priceDelta: delta,
    // A downgrade removes access the user may be relying on, so the confirm UI
    // treats it as destructive and requires a more deliberate action.
    isDestructive: delta < 0
  };
}

/** Is this a real, recognised plan id? Used to disable invalid submits. */
export function isValidPlanId(value) {
  return normalizePlanId(value) !== null;
}
