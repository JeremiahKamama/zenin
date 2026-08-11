import { ErrorCode, LogLevel, Purchases, ReservedCustomerAttribute } from "@revenuecat/purchases-js";

export const REVENUECAT_WEB_API_KEY =
  String(import.meta.env.VITE_REVENUECAT_WEB_API_KEY || "").trim();

export const REVENUECAT_RECOMMENDED_SETUP = {
  // NOTE: these are EXTERNAL RevenueCat dashboard identifiers (entitlement +
  // product ids). They are intentionally left as zenin_pro/zenin_desk to avoid
  // a RevenueCat dashboard migration; detectPlanFromIdentifier maps them to the
  // internal tier ids (plus/premium) above.
  entitlementIds: {
    plus: "zenin_pro",
    premium: "zenin_desk"
  },
  products: {
    plusMonthly: "zenin.pro.monthly",
    plusYearly: "zenin.pro.yearly",
    premiumMonthly: "zenin.desk.monthly",
    premiumYearly: "zenin.desk.yearly"
  },
  offeringId: "default"
};

const PLAN_PRIORITY = {
  starter: 0,
  plus: 1,
  premium: 2
};

let purchasesInstance = null;
let configuredAppUserId = "";

function normalizeId(value) {
  return String(value || "").trim().toLowerCase();
}

function detectPlanFromIdentifier(identifier) {
  const normalized = normalizeId(identifier);
  if (!normalized) return null;
  // Premium tier (legacy id: "desk"). RevenueCat entitlement/product ids
  // (zenin.desk.*, zenin_desk) are external dashboard identifiers — kept stable —
  // but resolve to the internal "premium" plan.
  if (
    normalized.includes("premium") ||
    normalized.includes("desk") ||
    normalized.includes("team") ||
    normalized.includes("enterprise")
  ) {
    return "premium";
  }
  // Plus tier (legacy id: "pro"). RevenueCat ids (zenin.pro.*, zenin_pro) kept
  // stable; resolve to the internal "plus" plan.
  if (
    normalized.includes("plus") ||
    normalized.includes("pro")
  ) {
    return "plus";
  }
  if (normalized.includes("starter") || normalized.includes("free")) {
    return "starter";
  }
  return null;
}

function detectBillingCycleFromIdentifier(identifier) {
  const normalized = normalizeId(identifier);
  if (!normalized) return null;
  if (
    normalized.includes("yearly") ||
    normalized.includes("annual") ||
    normalized.includes("year")
  ) {
    return "yearly";
  }
  if (
    normalized.includes("monthly") ||
    normalized.includes("month")
  ) {
    return "monthly";
  }
  return null;
}

function chooseHigherPlan(candidate, current) {
  if (!candidate) return current;
  if (!current) return candidate;
  return (PLAN_PRIORITY[candidate] || 0) >= (PLAN_PRIORITY[current] || 0)
    ? candidate
    : current;
}

export function isRevenueCatCancelledError(error) {
  return error?.errorCode === ErrorCode.UserCancelledError;
}

export function formatRevenueCatError(error) {
  if (isRevenueCatCancelledError(error)) {
    return "Purchase canceled.";
  }
  return String(
    error?.message ||
      error?.underlyingErrorMessage ||
      error?.error ||
      "RevenueCat request failed."
  ).trim();
}

export function deriveRevenueCatAccess(customerInfo) {
  const activeEntitlements = Object.values(customerInfo?.entitlements?.active || {});
  const activeProductIdentifiers = Array.from(customerInfo?.activeSubscriptions || []);

  let currentPlan = null;
  let currentBillingCycle = null;

  activeEntitlements.forEach((entitlement) => {
    currentPlan = chooseHigherPlan(
      detectPlanFromIdentifier(entitlement?.identifier) ||
        detectPlanFromIdentifier(entitlement?.productIdentifier),
      currentPlan
    );
    if (!currentBillingCycle) {
      currentBillingCycle = detectBillingCycleFromIdentifier(entitlement?.productIdentifier);
    }
  });

  activeProductIdentifiers.forEach((productIdentifier) => {
    currentPlan = chooseHigherPlan(detectPlanFromIdentifier(productIdentifier), currentPlan);
    if (!currentBillingCycle) {
      currentBillingCycle = detectBillingCycleFromIdentifier(productIdentifier);
    }
  });

  return {
    activeEntitlements,
    activeProductIdentifiers,
    currentPlan: currentPlan || "starter",
    currentBillingCycle: currentBillingCycle || "monthly",
    managementURL: customerInfo?.managementURL || null,
    hasActiveSubscription: activeEntitlements.length > 0 || activeProductIdentifiers.length > 0
  };
}

async function applyRevenueCatAttributes(instance, { email, displayName }) {
  const attributes = {};
  if (email) {
    attributes[ReservedCustomerAttribute.Email] = String(email).trim().toLowerCase();
  }
  if (displayName) {
    attributes[ReservedCustomerAttribute.DisplayName] = String(displayName).trim();
  }
  if (!Object.keys(attributes).length) return;
  await instance.setAttributes(attributes);
}

export async function getRevenueCatInstance({ appUserId, email, displayName }) {
  const normalizedUserId = String(appUserId || "").trim();
  if (!REVENUECAT_WEB_API_KEY) {
    throw new Error("RevenueCat API key is missing.");
  }
  if (!normalizedUserId) {
    throw new Error("A signed-in app user id is required before starting RevenueCat.");
  }

  if (!purchasesInstance) {
    if (import.meta.env.DEV) {
      Purchases.setLogLevel(LogLevel.Debug);
    }
    purchasesInstance = Purchases.configure({
      apiKey: REVENUECAT_WEB_API_KEY,
      appUserId: normalizedUserId
    });
    configuredAppUserId = normalizedUserId;
  } else if (configuredAppUserId !== normalizedUserId) {
    await purchasesInstance.changeUser(normalizedUserId);
    configuredAppUserId = normalizedUserId;
  }

  await applyRevenueCatAttributes(purchasesInstance, { email, displayName });
  return purchasesInstance;
}

export async function loadRevenueCatState({ appUserId, email, displayName }) {
  const purchases = await getRevenueCatInstance({ appUserId, email, displayName });
  await purchases.preload();
  const [customerInfo, offerings] = await Promise.all([
    purchases.getCustomerInfo(),
    purchases.getOfferings()
  ]);
  return {
    purchases,
    customerInfo,
    offerings,
    access: deriveRevenueCatAccess(customerInfo)
  };
}

export async function presentRevenueCatPaywall({
  appUserId,
  email,
  displayName,
  offering,
  htmlTarget,
  onVisitCustomerCenter
}) {
  const purchases = await getRevenueCatInstance({ appUserId, email, displayName });
  return purchases.presentPaywall({
    htmlTarget,
    offering,
    onVisitCustomerCenter
  });
}

export async function purchaseRevenueCatPackage({
  appUserId,
  email,
  displayName,
  rcPackage,
  htmlTarget,
  metadata
}) {
  const purchases = await getRevenueCatInstance({ appUserId, email, displayName });
  return purchases.purchase({
    rcPackage,
    customerEmail: email || undefined,
    htmlTarget,
    metadata
  });
}
