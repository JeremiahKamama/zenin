/**
 * Centralized fetch utility for Zenin.
 * Uses cookie-based auth and handles base URL resolution.
 */

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const SIMULATED_PLAN_VALUES = new Set(["starter", "pro", "desk"]);

function getSimulationPlanHeaderValue(endpoint) {
  if (typeof window === "undefined") return null;

  const normalizedEndpoint = String(endpoint || "");
  const pathname = String(window.location.pathname || "").toLowerCase();

  // Keep simulation scoped to the signed-in app so public/auth requests don't
  // trigger unnecessary CORS preflights in production.
  if (!pathname.startsWith("/app")) return null;
  if (normalizedEndpoint === "/auth" || normalizedEndpoint.startsWith("/auth/")) return null;

  try {
    const authUser = window.localStorage.getItem("zenin_auth_user");
    const simulatePlan = String(window.localStorage.getItem("zenin_simulate_plan") || "")
      .trim()
      .toLowerCase();

    if (!authUser || !SIMULATED_PLAN_VALUES.has(simulatePlan)) {
      return null;
    }

    return simulatePlan;
  } catch {
    return null;
  }
}

export async function zeninFetch(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${ZENIN_API_BASE_URL}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

  const headers = {
    ...options.headers,
  };

  // Ensure JSON requests have correct content-type
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const simulatePlan = getSimulationPlanHeaderValue(endpoint);
  if (simulatePlan) {
    headers["x-zenin-simulate-plan"] = simulatePlan;
  }

  const response = await fetch(url, {
    ...options,
    credentials: options.credentials || "include",
    headers
  });

  return response;
}
