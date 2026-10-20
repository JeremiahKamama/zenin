// admin/src/dev/worstCaseUsers.js
//
// Worst-case fixture for the admin console's user surfaces (break-ui).
//
// Every value here is PLAUSIBLE OR SCHEMA-BACKED, never random. Demo data is
// chosen — usually without anyone noticing — to make a design look good:
// names that fit on one line, counts that never need a separator, optional
// fields always filled. This undoes that choice one field at a time.
//
// Limits come from the real contract:
//   displayName  validation.js:16  z.string().max(100)
//   name (admin) validation.js:174 z.string().min(2).max(120)
//   email        unbounded in the schema; Postgres column is TEXT
//   plan         canonical: starter | plus | premium
//
// The first rows carry the different failures rather than stacking them all
// into row 1, because only the first few are on screen.
//
// DEV ONLY. Imported behind the ?data=worst-case switch in App.jsx.

/** A 100-character name — exactly the API limit, so it saves. */
const MAX_LENGTH_NAME = "Aleksandra Wiśniewska-Kowalczyk-Montgomery the Third of Northwind Holdings";

/** A realistic long corporate email that shares a domain with its neighbours. */
const LONG_EMAIL = "bartholomew.fitzgerald@northwind-industries-holdings.example.com";

export const WORST_CASE_USERS = [
  {
    // Row 1: the long name + the long email, together. This is the realistic
    // combination — long names and long corporate emails travel together.
    id: 9001,
    name: MAX_LENGTH_NAME,
    email: LONG_EMAIL,
    displayName: MAX_LENGTH_NAME,
    adminRole: "super_admin",
    plan: "premium",
    billingCycle: "yearly",
    isAdmin: true,
    suspendedAt: null,
    createdAt: "2021-03-04T09:15:00.000Z",
    lastActiveAt: "2026-10-20T02:40:00.000Z",
    twoFactorEnabled: true,
    twoFactorMethod: "authenticator",
    workspaceCount: 1284,
    _note: "long name + long email"
  },
  {
    // Row 2: the one-letter name. `name || 'No Name'` passes, but the avatar
    // shows a single glyph, and any "first + last word" initials logic has
    // nothing to work with.
    id: 9002,
    name: "Jo",
    email: "jo@x.io",
    displayName: "Jo",
    adminRole: "user",
    plan: "plus",
    billingCycle: "monthly",
    isAdmin: false,
    suspendedAt: null,
    createdAt: "2026-09-30T11:00:00.000Z",
    lastActiveAt: "2026-10-19T22:00:00.000Z",
    twoFactorEnabled: false,
    twoFactorMethod: null,
    workspaceCount: 1,
    _note: "one-letter name, count of exactly 1 (pluralization)"
  },
  {
    // Row 3: missing optional fields. `displayName` null AND `email` present,
    // so the `|| email` fallback fires and the Profile card shows a raw email
    // where a name belongs.
    id: 9003,
    name: null,
    email: "unlabelled.account@northwind-industries-holdings.example.com",
    displayName: null,
    adminRole: "user",
    plan: "starter",
    billingCycle: "monthly",
    isAdmin: false,
    suspendedAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2025-01-15T00:00:00.000Z",
    lastActiveAt: null,
    twoFactorEnabled: false,
    twoFactorMethod: null,
    workspaceCount: 0,
    _note: "no name at all — every fallback renders"
  },
  {
    // Row 4: emoji-first and non-Latin. `charAt(0)` on an emoji returns half a
    // surrogate pair, which renders as the replacement character.
    id: 9004,
    name: "🇳🇱 Nienke van der Berg",
    email: "nienke@voorbeeld.nl",
    displayName: "🇳🇱 Nienke van der Berg",
    adminRole: "admin",
    plan: "premium",
    billingCycle: "monthly",
    isAdmin: true,
    suspendedAt: null,
    createdAt: "2024-06-01T00:00:00.000Z",
    lastActiveAt: "2026-10-20T01:00:00.000Z",
    twoFactorEnabled: true,
    twoFactorMethod: "passkey",
    workspaceCount: 27,
    _note: "emoji-first name — charAt(0) splits the surrogate pair"
  },
  {
    // Row 5: tall script (Thai has stacked diacritics) plus Vietnamese, which
    // are the scripts that get clipped by tight line-height + overflow hidden.
    id: 9005,
    name: "Nguyễn Thị Thuỳ Dương ณัฐพงษ์ วงศ์สุวรรณ",
    email: "nguyen.thi.thuy.duong@cong-ty-co-phan-dau-tu.example.vn",
    displayName: "Nguyễn Thị Thuỳ Dương ณัฐพงษ์ วงศ์สุวรรณ",
    adminRole: "user",
    plan: "plus",
    billingCycle: "yearly",
    isAdmin: false,
    suspendedAt: null,
    createdAt: "2023-11-11T00:00:00.000Z",
    lastActiveAt: "2026-10-18T08:30:00.000Z",
    twoFactorEnabled: false,
    twoFactorMethod: null,
    workspaceCount: 3,
    _note: "tall diacritics (Vietnamese + Thai) — clipped by tight line-height"
  },
  {
    // Row 6: suffix name. "… Montgomery III" means first-word + first-letter
    // initials give "MI" when the person is "M… III", and the obvious
    // "first two chars" gives "MO".
    id: 9006,
    name: "Reginald P. Montgomery III",
    email: "r.montgomery.iii@example.com",
    displayName: "Reginald P. Montgomery III",
    adminRole: "user",
    plan: "starter",
    billingCycle: "monthly",
    isAdmin: false,
    suspendedAt: null,
    createdAt: "2022-02-02T00:00:00.000Z",
    lastActiveAt: "2026-10-17T12:00:00.000Z",
    twoFactorEnabled: false,
    twoFactorMethod: null,
    workspaceCount: 2,
    _note: "name suffix — naive initials are wrong"
  },
  {
    // Row 7: the extreme count. Forces the separator question and shows
    // whether numbers are tabular.
    id: 9007,
    name: "Priya Raghunathan",
    email: "priya.raghunathan@northwind-industries-holdings.example.com",
    displayName: "Priya Raghunathan",
    adminRole: "super_admin",
    plan: "premium",
    billingCycle: "yearly",
    isAdmin: true,
    suspendedAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    lastActiveAt: "2026-10-20T02:59:00.000Z",
    twoFactorEnabled: true,
    twoFactorMethod: "authenticator",
    workspaceCount: 1284000,
    _note: "extreme count — separator + tabular figures"
  }
];

/** Zero items: the no-results state. */
export const EMPTY_USERS = [];

/** A single item, so every count is exactly 1. */
export const SINGLE_USER = [WORST_CASE_USERS[1]];

/**
 * The realistic upper bound for an unpaginated list. 1,200 rows is also a
 * performance break, not just a visual one.
 */
export const MANY_USERS = Array.from({ length: 1200 }, (_, i) => ({
  ...WORST_CASE_USERS[i % WORST_CASE_USERS.length],
  id: 10000 + i,
  email: `user${i}@northwind-industries-holdings.example.com`
}));

export const WORST_CASE_MODES = {
  demo: null,
  worst: WORST_CASE_USERS,
  empty: EMPTY_USERS,
  one: SINGLE_USER,
  many: MANY_USERS
};
