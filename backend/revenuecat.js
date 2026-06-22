const REVENUECAT_API_BASE_URL = "https://api.revenuecat.com/v2";
const REVENUECAT_SUMMARY_CACHE_TTL_MS = 60 * 1000;
const REVENUECAT_CUSTOMER_CACHE_TTL_MS = 30 * 1000;

const revenueCatSummaryCache = { value: null, expiresAt: 0 };
const revenueCatCustomerCache = new Map();

function getRevenueCatSecretKey() {
  return String(
    process.env.REVENUECAT_V2_SECRET_KEY ||
      process.env.REVENUECAT_SECRET_KEY ||
      process.env.REVENUECAT_API_KEY ||
      ""
  ).trim();
}

function getRevenueCatProjectId() {
  return String(process.env.REVENUECAT_PROJECT_ID || "").trim();
}

function isRevenueCatConfigured() {
  return Boolean(getRevenueCatSecretKey() && getRevenueCatProjectId());
}

function previewSecret(value) {
  const raw = String(value || "").trim();
  if (!raw) return "missing";
  if (raw.length <= 8) return `${raw.slice(0, 2)}...${raw.slice(-2)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function previewProjectId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "missing";
  if (raw.length <= 10) return raw;
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function toIsoString(value) {
  if (!value && value !== 0) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getNestedValue(source, path) {
  if (!source || !path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), source);
}

function pickFirst(source, paths, fallback = null) {
  for (const path of paths) {
    const value = getNestedValue(source, path);
    if (value != null && value !== "") return value;
  }
  return fallback;
}

function getListItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractAttributes(customer = {}) {
  const raw = customer.attributes;
  if (!raw) return {};

  if (Array.isArray(raw?.items)) {
    return raw.items.reduce((acc, item) => {
      const key = String(item?.name || item?.id || "").trim();
      if (!key) return acc;
      acc[key] = item?.value ?? null;
      return acc;
    }, {});
  }

  if (Array.isArray(raw)) {
    return raw.reduce((acc, item) => {
      const key = String(item?.name || item?.id || "").trim();
      if (!key) return acc;
      acc[key] = item?.value ?? null;
      return acc;
    }, {});
  }

  if (typeof raw === "object") {
    return Object.entries(raw).reduce((acc, [key, value]) => {
      if (!key) return acc;
      acc[key] = value?.value ?? value ?? null;
      return acc;
    }, {});
  }

  return {};
}

function extractCustomerEmail(customer = {}) {
  const attributes = extractAttributes(customer);
  return (
    pickFirst(customer, ["email", "customer_email"]) ||
    attributes.$email ||
    attributes.email ||
    null
  );
}

function extractCustomerDisplayName(customer = {}) {
  const attributes = extractAttributes(customer);
  return (
    pickFirst(customer, ["display_name", "name"]) ||
    attributes.$displayName ||
    attributes.displayName ||
    attributes.name ||
    null
  );
}

function compactList(values = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

class RevenueCatApiError extends Error {
  constructor(message, status = 500, details = null) {
    super(message);
    this.name = "RevenueCatApiError";
    this.status = status;
    this.details = details;
  }
}

async function revenueCatFetch(path, { query = {}, allowNotFound = false } = {}) {
  const secretKey = getRevenueCatSecretKey();
  if (!secretKey) {
    throw new RevenueCatApiError("RevenueCat secret key is missing.", 500);
  }

  const url = new URL(`${REVENUECAT_API_BASE_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: "application/json"
    }
  });

  if (allowNotFound && response.status === 404) {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.error?.message ||
      payload?.error ||
      `RevenueCat request failed (${response.status}).`;
    throw new RevenueCatApiError(message, response.status, payload);
  }

  return payload;
}

async function revenueCatList(path, query = {}) {
  const payload = await revenueCatFetch(path, { query });
  return getListItems(payload);
}

function buildRevenueCatProviderStatus() {
  const configured = isRevenueCatConfigured();
  const secretKey = getRevenueCatSecretKey();
  const projectId = getRevenueCatProjectId();
  return {
    configured,
    name: "RevenueCat",
    status: configured ? "active" : "degraded",
    note: configured
      ? "RevenueCat API credentials detected for admin billing support."
      : "Set REVENUECAT_V2_SECRET_KEY (or REVENUECAT_SECRET_KEY) and REVENUECAT_PROJECT_ID to enable RevenueCat admin insights.",
    lastSyncAt: new Date().toISOString(),
    projectId: projectId || null,
    projectIdPreview: previewProjectId(projectId),
    secretKeyPreview: previewSecret(secretKey)
  };
}

function mapRevenueCatOffering(item = {}) {
  return {
    id: String(pickFirst(item, ["lookup_key", "identifier", "id", "name"], "unknown")),
    name: String(pickFirst(item, ["display_name", "name", "identifier", "id"], "Untitled offering")),
    createdAt: toIsoString(pickFirst(item, ["created_at", "createdAt"]))
  };
}

function mapRevenueCatEntitlement(item = {}) {
  return {
    id: String(pickFirst(item, ["lookup_key", "identifier", "id", "name"], "unknown")),
    name: String(pickFirst(item, ["display_name", "name", "identifier", "id"], "Untitled entitlement")),
    createdAt: toIsoString(pickFirst(item, ["created_at", "createdAt"]))
  };
}

function mapRevenueCatCustomer(item = {}) {
  return {
    id: String(pickFirst(item, ["id", "app_user_id"], "unknown")),
    email: extractCustomerEmail(item),
    displayName: extractCustomerDisplayName(item),
    createdAt: toIsoString(pickFirst(item, ["created_at", "createdAt", "first_seen_at"])),
    lastSeenAt: toIsoString(pickFirst(item, ["last_seen_at", "updated_at", "updatedAt"]))
  };
}

function mapRevenueCatSubscription(item = {}) {
  return {
    id: String(pickFirst(item, ["id", "store_identifier", "product_id", "product_identifier"], "unknown")),
    productId: String(pickFirst(item, ["product_id", "product_identifier", "product.id", "id"], "unknown")),
    status: String(pickFirst(item, ["status", "state"], "unknown")).toLowerCase(),
    store: String(pickFirst(item, ["store", "platform", "purchase_source"], "unknown")),
    managementUrl: pickFirst(item, ["management_url", "management_urls.web", "customer_portal_url"]),
    currentPeriodEndsAt: toIsoString(pickFirst(item, ["current_period_ends_at", "renewal_or_expiration_at", "expires_at"])),
    startedAt: toIsoString(pickFirst(item, ["starts_at", "purchased_at", "created_at"]))
  };
}

function mapRevenueCatEntitlementAccess(item = {}) {
  return {
    id: String(pickFirst(item, ["entitlement_id", "lookup_key", "identifier", "id"], "unknown")),
    productId: pickFirst(item, ["product_id", "product_identifier", "subscription.product_id"]),
    expiresAt: toIsoString(pickFirst(item, ["expires_at", "current_period_ends_at"])),
    purchasedAt: toIsoString(pickFirst(item, ["purchased_at", "starts_at", "created_at"]))
  };
}

function mapRevenueCatInvoice(item = {}) {
  const amount = Number(
    pickFirst(item, [
      "total_in_purchased_currency",
      "total",
      "subtotal_in_purchased_currency",
      "amount"
    ], 0)
  );

  return {
    id: String(pickFirst(item, ["id", "invoice_number"], "unknown")),
    status: String(pickFirst(item, ["status", "state"], "unknown")).toLowerCase(),
    amount: Number.isFinite(amount) ? amount : 0,
    currency: String(pickFirst(item, ["purchased_currency", "currency"], "USD")).toUpperCase(),
    createdAt: toIsoString(pickFirst(item, ["created_at", "issued_at", "date"])),
    paidAt: toIsoString(pickFirst(item, ["paid_at", "completed_at"])),
    hostedUrl: pickFirst(item, ["hosted_invoice_url", "invoice_url", "download_url"])
  };
}

function buildCustomerCacheKey({ customerId, userId, email }) {
  return [customerId || "", userId || "", String(email || "").trim().toLowerCase()].join("::");
}

function getCachedCustomer(key) {
  const entry = revenueCatCustomerCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    revenueCatCustomerCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedCustomer(key, value) {
  revenueCatCustomerCache.set(key, {
    value,
    expiresAt: Date.now() + REVENUECAT_CUSTOMER_CACHE_TTL_MS
  });
}

async function resolveRevenueCatCustomer({ customerId = null, userId = null, email = null }) {
  const projectId = getRevenueCatProjectId();
  const normalizedCustomerId = String(customerId || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (normalizedCustomerId) {
    const customer = await revenueCatFetch(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(normalizedCustomerId)}`,
      { query: { expand: "attributes" }, allowNotFound: true }
    );
    if (customer) {
      return { customer, resolution: "customer_id" };
    }
  }

  if (normalizedUserId) {
    const customer = await revenueCatFetch(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(normalizedUserId)}`,
      { query: { expand: "attributes" }, allowNotFound: true }
    );
    if (customer) {
      return { customer, resolution: "user_id" };
    }
  }

  if (normalizedEmail) {
    const customers = await revenueCatList(
      `/projects/${encodeURIComponent(projectId)}/customers`,
      { search: normalizedEmail, limit: 10, expand: "attributes" }
    );
    const exactEmailMatch =
      customers.find((item) => String(extractCustomerEmail(item) || "").trim().toLowerCase() === normalizedEmail) ||
      customers[0] ||
      null;
    if (exactEmailMatch) {
      return { customer: exactEmailMatch, resolution: "email" };
    }
  }

  return { customer: null, resolution: null };
}

async function getRevenueCatCustomerSnapshot({ customerId = null, userId = null, email = null } = {}) {
  const cacheKey = buildCustomerCacheKey({ customerId, userId, email });
  const cached = getCachedCustomer(cacheKey);
  if (cached) return cached;

  const providerStatus = buildRevenueCatProviderStatus();
  if (!providerStatus.configured) {
    const result = {
      configured: false,
      found: false,
      providerStatus,
      customer: null,
      subscriptions: [],
      activeEntitlements: [],
      invoices: []
    };
    setCachedCustomer(cacheKey, result);
    return result;
  }

  const { customer, resolution } = await resolveRevenueCatCustomer({ customerId, userId, email });
  if (!customer) {
    const result = {
      configured: true,
      found: false,
      resolution,
      providerStatus,
      customer: null,
      subscriptions: [],
      activeEntitlements: [],
      invoices: []
    };
    setCachedCustomer(cacheKey, result);
    return result;
  }

  const projectId = getRevenueCatProjectId();
  const resolvedCustomerId = String(pickFirst(customer, ["id", "app_user_id"], "")).trim();
  const [subscriptions, activeEntitlements, invoices] = await Promise.all([
    revenueCatList(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolvedCustomerId)}/subscriptions`,
      { limit: 20 }
    ).catch((error) => { console.warn("[RevenueCat] Subscriptions fetch failed:", error?.message || error); return []; }),
    revenueCatList(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolvedCustomerId)}/active_entitlements`,
      { limit: 20 }
    ).catch((error) => { console.warn("[RevenueCat] Active entitlements fetch failed:", error?.message || error); return []; }),
    revenueCatList(
      `/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(resolvedCustomerId)}/invoices`,
      { limit: 12 }
    ).catch((error) => { console.warn("[RevenueCat] Invoices fetch failed:", error?.message || error); return []; })
  ]);

  const mappedCustomer = mapRevenueCatCustomer(customer);
  const mappedSubscriptions = subscriptions.map(mapRevenueCatSubscription);
  const mappedEntitlements = activeEntitlements.map(mapRevenueCatEntitlementAccess);
  const mappedInvoices = invoices.map(mapRevenueCatInvoice);
  const managementUrl =
    mappedSubscriptions.find((item) => item.managementUrl)?.managementUrl ||
    pickFirst(customer, ["management_url", "customer_portal_url"]);

  const result = {
    configured: true,
    found: true,
    resolution,
    providerStatus,
    customer: {
      ...mappedCustomer,
      managementUrl,
      aliases: compactList(
        getListItems(customer.aliases || customer.alias_ids || []).map((item) =>
          String(pickFirst(item, ["id", "app_user_id", "alias", "value"], "")).trim()
        )
      )
    },
    subscriptions: mappedSubscriptions,
    activeEntitlements: mappedEntitlements,
    invoices: mappedInvoices
  };

  setCachedCustomer(cacheKey, result);
  return result;
}

async function getRevenueCatAdminSummary() {
  const cached = revenueCatSummaryCache.value && revenueCatSummaryCache.expiresAt > Date.now()
    ? revenueCatSummaryCache.value
    : null;
  if (cached) return cached;

  const providerStatus = buildRevenueCatProviderStatus();
  if (!providerStatus.configured) {
    const result = {
      configured: false,
      providerStatus,
      offerings: [],
      entitlements: [],
      recentCustomers: [],
      summary: {
        offeringsCount: 0,
        entitlementsCount: 0,
        recentCustomersCount: 0
      }
    };
    revenueCatSummaryCache.value = result;
    revenueCatSummaryCache.expiresAt = Date.now() + REVENUECAT_SUMMARY_CACHE_TTL_MS;
    return result;
  }

  const projectId = getRevenueCatProjectId();
  try {
    const [offerings, entitlements, recentCustomers] = await Promise.all([
      revenueCatList(`/projects/${encodeURIComponent(projectId)}/offerings`, { limit: 20 }),
      revenueCatList(`/projects/${encodeURIComponent(projectId)}/entitlements`, { limit: 20 }),
      revenueCatList(`/projects/${encodeURIComponent(projectId)}/customers`, { limit: 8, expand: "attributes" })
    ]);

    const result = {
      configured: true,
      providerStatus,
      offerings: offerings.map(mapRevenueCatOffering),
      entitlements: entitlements.map(mapRevenueCatEntitlement),
      recentCustomers: recentCustomers.map(mapRevenueCatCustomer),
      summary: {
        offeringsCount: offerings.length,
        entitlementsCount: entitlements.length,
        recentCustomersCount: recentCustomers.length
      }
    };
    revenueCatSummaryCache.value = result;
    revenueCatSummaryCache.expiresAt = Date.now() + REVENUECAT_SUMMARY_CACHE_TTL_MS;
    return result;
  } catch (error) {
    const result = {
      configured: true,
      providerStatus: {
        ...providerStatus,
        status: "degraded",
        note: error?.message || "RevenueCat is configured, but the admin API request failed."
      },
      offerings: [],
      entitlements: [],
      recentCustomers: [],
      summary: {
        offeringsCount: 0,
        entitlementsCount: 0,
        recentCustomersCount: 0
      }
    };
    revenueCatSummaryCache.value = result;
    revenueCatSummaryCache.expiresAt = Date.now() + REVENUECAT_SUMMARY_CACHE_TTL_MS;
    return result;
  }
}

function buildRevenueCatIntegrationItem(summary = null) {
  const providerStatus = summary?.providerStatus || buildRevenueCatProviderStatus();
  return {
    name: "RevenueCat",
    category: "Payments",
    status: providerStatus.status || "degraded",
    note: providerStatus.note,
    lastSyncAt: providerStatus.lastSyncAt,
    actionLabel: providerStatus.configured ? "Inspect" : "Configure",
    credentialStatus: providerStatus.configured ? "configured" : "missing",
    syncLagMinutes: 0,
    webhookFailures: 0,
    retryable: false,
    metadata: {
      projectIdPreview: providerStatus.projectIdPreview,
      secretKeyPreview: providerStatus.secretKeyPreview
    }
  };
}

module.exports = {
  RevenueCatApiError,
  buildRevenueCatIntegrationItem,
  buildRevenueCatProviderStatus,
  getRevenueCatAdminSummary,
  getRevenueCatCustomerSnapshot,
  isRevenueCatConfigured
};
