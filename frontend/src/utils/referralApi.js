import { zeninFetchJson } from "@/utils/zeninFetch";

/**
 * Referral program service client (Part 3).
 * Thin wrappers around the /api/referrals/* endpoints.
 */

/**
 * Get (or create) the current user's referral code + shareable link.
 * @returns {Promise<{code: string, referralLink: string, created: string}|null>}
 */
export async function getReferralCode() {
  try {
    const data = await zeninFetchJson("/api/referrals/code");
    if (!data) return null;
    return {
      code: String(data.code || ""),
      referralLink: String(data.referralLink || ""),
      created: data.created || null,
      createdFresh: !data.created ? true : false
    };
  } catch (error) {
    if (error?.status === 401) return null;
    console.warn("[referralApi] getReferralCode failed:", error?.message || error);
    return null;
  }
}

/**
 * Track a referral click when a visitor lands with ?ref=<code>.
 * This is a public (unauthenticated) endpoint.
 * @param {string} refCode  The referral code from the URL.
 * @param {string} [visitorRef]  Optional opaque visitor identifier.
 * @returns {Promise<{tracked: boolean, reason?: string}>}
 */
export async function trackReferral(refCode, visitorRef) {
  try {
    const body = { ref: String(refCode || "") };
    if (visitorRef) body.visitorRef = String(visitorRef);
    const data = await zeninFetchJson("/api/referrals/track", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" }
    });
    return { tracked: Boolean(data?.tracked), reason: data?.reason };
  } catch (error) {
    console.warn("[referralApi] trackReferral failed:", error?.message || error);
    return { tracked: false, reason: "error" };
  }
}

/**
 * Get referral statistics for the current user (clicks, signups, conversions).
 * @returns {Promise<{hasCode: boolean, code?: string, clicks: number, signups: number, conversions: number, recentEvents: Array}|null>}
 */
export async function getReferralStats() {
  try {
    const data = await zeninFetchJson("/api/referrals/stats");
    if (!data) return null;
    return {
      hasCode: Boolean(data.hasCode),
      code: data.code,
      created: data.created,
      clicks: Number(data.clicks || 0),
      signups: Number(data.signups || 0),
      conversions: Number(data.conversions || 0),
      recentEvents: Array.isArray(data.recentEvents) ? data.recentEvents : []
    };
  } catch (error) {
    if (error?.status === 401) return null;
    console.warn("[referralApi] getReferralStats failed:", error?.message || error);
    return null;
  }
}

/**
 * Call this once on app load if ?ref=<code> is present in the URL.
 * Uses sessionStorage to ensure a single click event per visitor session.
 * @returns {Promise<{tracked: boolean}>}
 */
export async function initReferralTrackingIfPresent() {
  if (typeof window === "undefined") return { tracked: false };
  const params = new URLSearchParams(window.location.search);
  const refCode = params.get("ref");
  if (!refCode || refCode.length < 2) return { tracked: false };

  const sessionKey = `zenin_referral_tracked_${String(refCode).toLowerCase()}`;
  try {
    if (sessionStorage.getItem(sessionKey) === "1") {
      return { tracked: false };
    }
  } catch {
    // storage unavailable — proceed to track
  }

  // Generate a simple visitor ref from session + timestamp
  let visitorRef = null;
  try {
    visitorRef = sessionStorage.getItem("zenin_visitor_ref") || Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem("zenin_visitor_ref", visitorRef);
  } catch {
    // ignore
  }

  const result = await trackReferral(refCode, visitorRef);
  try {
    if (result.tracked) sessionStorage.setItem(sessionKey, "1");
  } catch {
    // ignore
  }
  return result;
}
