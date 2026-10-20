// admin/test/pluralize.test.js
//
// The console hardcoded plurals: "1 rows", "1 sessions were revoked",
// "Showing 1 to 1 of 1 users", "ran for 1 users". A count of exactly one is
// the case demo data never contains, so it shipped.

import test from "node:test";
import assert from "node:assert/strict";

import { pluralize, formatCount } from "../src/utils/pluralize.js";

test("a count of one is singular", () => {
  assert.equal(pluralize(1, "user"), "1 user");
  assert.equal(pluralize(1, "row"), "1 row");
  assert.equal(pluralize(1, "session"), "1 session");
});

test("zero and many are plural", () => {
  // English treats 0 as plural ("0 users"), which a `=== 1` check also gets
  // right — but Intl.PluralRules is what makes it correct in other locales.
  assert.equal(pluralize(0, "user"), "0 users");
  assert.equal(pluralize(2, "user"), "2 users");
});

test("large counts get thousands separators", () => {
  assert.equal(pluralize(1284, "user"), "1,284 users");
  assert.equal(pluralize(1284000, "workspace"), "1,284,000 workspaces");
});

test("an explicit plural is honoured", () => {
  assert.equal(pluralize(1, "person", "people"), "1 person");
  assert.equal(pluralize(3, "person", "people"), "3 people");
});

test("unusable input renders 0 instead of NaN or undefined", () => {
  // These reached the UI as literal "NaN users" before.
  assert.equal(pluralize(NaN, "row"), "0 rows");
  assert.equal(pluralize(null, "row"), "0 rows");
  assert.equal(pluralize(undefined, "row"), "0 rows");
  assert.equal(pluralize("not a number", "row"), "0 rows");
});

test("numeric strings are coerced, since API counts arrive as strings", () => {
  assert.equal(pluralize("1", "user"), "1 user");
  assert.equal(pluralize("42", "user"), "42 users");
});

test("formatCount separates thousands and guards bad input", () => {
  assert.equal(formatCount(1284), "1,284");
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(NaN), "0");
  assert.equal(formatCount(undefined), "0");
});
