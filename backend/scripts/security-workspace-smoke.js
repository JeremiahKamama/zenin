#!/usr/bin/env node
"use strict";

const { initializeDatabase, closeDatabase, userAuth, workspaces, pool } = require("../database");
const crypto = require("crypto");

const BASE_URL = String(process.env.ZENIN_SMOKE_BASE_URL || "http://127.0.0.1:4000/api").replace(/\/+$/, "");
const PASSWORD = "DeskSmoke!1234";

function derivePasswordHash(password, salt = null) {
  const safeSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password || ""), safeSalt, 64).toString("hex");
  return `scrypt:${safeSalt}:${hash}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, { method = "GET", cookie = "", body } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body != null) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""].filter(Boolean);
  const sessionCookie = setCookies.find((part) => part.startsWith("zenin_session="));
  const csrfCookie = setCookies.find((part) => part.startsWith("zenin_csrf="));

  return {
    status: response.status,
    ok: response.ok,
    data,
    sessionCookie: sessionCookie ? sessionCookie.split(";")[0] : "",
    csrfCookie: csrfCookie ? csrfCookie.split(";")[0] : ""
  };
}

async function getCsrfCookie(cookie = "") {
  const response = await request("/auth/csrf", { cookie });
  return response.csrfCookie || cookie.split(";").find((entry) => entry.trim().startsWith("zenin_csrf=")) || "";
}

async function requestWithCsrf(path, { method = "GET", cookie = "", body } = {}) {
  let combinedCookie = cookie;
  if (!["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase())) {
    const csrfCookie = await getCsrfCookie(cookie);
    if (csrfCookie && !combinedCookie.includes("zenin_csrf=")) {
      combinedCookie = combinedCookie ? `${combinedCookie}; ${csrfCookie}` : csrfCookie;
    }
  }
  const headers = {};
  if (combinedCookie) headers.Cookie = combinedCookie;
  if (body != null) headers["Content-Type"] = "application/json";
  const csrfToken = combinedCookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("zenin_csrf="))
    ?.split("=")[1] || "";
  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase())) {
    headers["x-csrf-token"] = csrfToken;
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    redirect: "manual"
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""].filter(Boolean);
  const sessionCookie = setCookies.find((part) => part.startsWith("zenin_session="));
  const csrfCookie = setCookies.find((part) => part.startsWith("zenin_csrf="));
  const nextCookies = [
    sessionCookie ? sessionCookie.split(";")[0] : "",
    csrfCookie ? csrfCookie.split(";")[0] : "",
    ...combinedCookie.split(";").map((entry) => entry.trim()).filter(Boolean)
  ].filter(Boolean);
  const deduped = Array.from(new Map(nextCookies.map((entry) => [entry.split("=")[0], entry])).values()).join("; ");
  return { status: response.status, ok: response.ok, data, cookie: deduped };
}

async function createUserAndSignin(email, displayName) {
  const existing = await userAuth.findUserByEmail(email);
  if (!existing) {
    await userAuth.createUser({
      email,
      passwordHash: derivePasswordHash(PASSWORD),
      displayName,
      authProvider: "email",
      emailVerified: true
    });
  }
  const signup = await requestWithCsrf("/auth/signin", {
    method: "POST",
    body: { email, password: PASSWORD }
  });
  assert(signup.ok, `Signin failed for ${email}: ${signup.data?.error || signup.status}`);
  const sessionCookie = signup.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("zenin_session="));
  assert(sessionCookie, `Missing session cookie for ${email}`);
  return signup.cookie;
}

async function main() {
  await initializeDatabase();
  const stamp = Date.now();
  const ownerEmail = `desk.owner.${stamp}@example.com`;
  const memberEmail = `desk.member.${stamp}@example.com`;
  const outsiderEmail = `desk.outsider.${stamp}@example.com`;

  try {
    const ownerCookie = await createUserAndSignin(ownerEmail, "Desk Owner");
    const memberCookie = await createUserAndSignin(memberEmail, "Desk Member");
    const outsiderCookie = await createUserAndSignin(outsiderEmail, "Desk Outsider");

    const owner = await userAuth.findUserByEmail(ownerEmail);
    const member = await userAuth.findUserByEmail(memberEmail);
    const outsider = await userAuth.findUserByEmail(outsiderEmail);
    assert(owner && member && outsider, "Smoke users were not created.");

    await requestWithCsrf("/account/plan", {
      method: "POST",
      cookie: ownerCookie,
      body: { plan: "desk", billingCycle: "monthly" }
    });

    const ownerWorkspace = await workspaces.ensurePersonalWorkspace(owner.id);
    assert(ownerWorkspace?.id, "Owner workspace was not provisioned.");

    const { token } = await workspaces.createInvite({
      workspaceId: ownerWorkspace.id,
      email: memberEmail,
      role: "member",
      createdByUserId: owner.id
    });

    const accepted = await requestWithCsrf(`/workspaces/invites/${token}/accept`, {
      method: "POST",
      cookie: memberCookie
    });
    assert(accepted.ok, `Invite accept failed: ${accepted.data?.error || accepted.status}`);

    const roleUpdate = await requestWithCsrf(`/workspaces/current/members/${member.id}/role`, {
      method: "PATCH",
      cookie: ownerCookie,
      body: { role: "admin" }
    });
    assert(roleUpdate.ok, `Role update failed: ${roleUpdate.data?.error || roleUpdate.status}`);

    const watchlistAdd = await requestWithCsrf("/db/watchlist", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        symbol: "AAPL",
        name: "Apple",
        type: "stock",
        marketType: "equity",
        category: "equities",
        theme: "mega-cap"
      }
    });
    assert(watchlistAdd.ok, `Watchlist add failed: ${watchlistAdd.data?.error || watchlistAdd.status}`);

    const tradeAdd = await requestWithCsrf("/db/execute-trade", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        symbol: "AAPL",
        name: "Apple",
        price: 190,
        quantity: 2,
        type: "stock",
        marketType: "equity",
        orderType: "buy",
        currency: "USD",
        clientId: `desk-smoke-${stamp}`
      }
    });
    assert(tradeAdd.ok, `Trade execution failed: ${tradeAdd.data?.error || tradeAdd.status}`);

    const memberWatchlist = await requestWithCsrf("/db/watchlist", { cookie: memberCookie });
    assert(memberWatchlist.ok, "Member could not read shared watchlist.");
    assert(Array.isArray(memberWatchlist.data?.assets) && memberWatchlist.data.assets.some((item) => item.symbol === "AAPL"), "Member did not see shared watchlist asset.");

    const memberPortfolio = await requestWithCsrf("/db/portfolio", { cookie: memberCookie });
    assert(memberPortfolio.ok, "Member could not read shared portfolio.");
    assert(Array.isArray(memberPortfolio.data?.holdings) && memberPortfolio.data.holdings.some((item) => item.symbol === "AAPL"), "Member did not see shared holding.");

    await pool.query("UPDATE app_users SET active_workspace_id = $2 WHERE id = $1", [outsider.id, ownerWorkspace.id]);

    const outsiderWorkspace = await requestWithCsrf("/workspaces/current", { cookie: outsiderCookie });
    assert(outsiderWorkspace.ok, `Expected outsider workspace request to self-heal, got ${outsiderWorkspace.status}`);
    assert(Number(outsiderWorkspace.data?.workspace?.id || 0) !== Number(ownerWorkspace.id), "Outsider was incorrectly bound to the owner's workspace.");

    const outsiderWatchlist = await requestWithCsrf("/db/watchlist", { cookie: outsiderCookie });
    assert(outsiderWatchlist.ok, `Expected outsider watchlist request to succeed against personal workspace, got ${outsiderWatchlist.status}`);
    assert(!Array.isArray(outsiderWatchlist.data?.assets) || !outsiderWatchlist.data.assets.some((item) => item.symbol === "AAPL"), "Outsider unexpectedly saw another workspace's watchlist asset.");

    console.log("Workspace security smoke passed.");
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error("Workspace security smoke failed:", error?.message || error);
  process.exitCode = 1;
});
