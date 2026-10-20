// admin/test/initials.test.js
//
// The console derived avatar initials with `name.substring(0, 2)`, which is
// not an initials function — it takes the first two CHARACTERS. Real names
// break it three ways:
//
//   "Jo"                          -> "JO"  (the "o" is not an initial)
//   "Reginald P. Montgomery III"  -> "RE"  (should be RM)
//   "🇳🇱 Nienke van der Berg"      -> a LONE SURROGATE, because charAt(0)
//                                    returns "\ud83c" — a visibly broken
//                                    avatar showing the replacement glyph.
//
// These tests pin the grapheme-cluster behaviour that fixes it.

import test from "node:test";
import assert from "node:assert/strict";

import { avatarInitials, initialsFromName, toGraphemes } from "../src/utils/initials.js";

test("grapheme splitting keeps an emoji whole", () => {
  // The original bug: charAt(0) on a flag emoji returns half a surrogate pair.
  const graphemes = toGraphemes("🇳🇱 Nienke");
  assert.equal(graphemes[0], "🇳🇱", "the flag must survive as one cluster");
  assert.notEqual(graphemes[0].length, 1, "a flag is multi-code-unit");
});

test("a two-letter name yields ONE initial, not two characters", () => {
  assert.equal(initialsFromName("Jo"), "J");
});

test("first and last name words produce two initials", () => {
  assert.equal(initialsFromName("Priya Raghunathan"), "PR");
});

test("a long hyphenated name uses the outermost words", () => {
  assert.equal(
    initialsFromName("Aleksandra Wiśniewska-Kowalczyk-Montgomery"),
    "AW"
  );
});

test("a name suffix is not treated as a last name", () => {
  // "Reginald P. Montgomery III" should read as RM, not RI.
  assert.equal(initialsFromName("Reginald P. Montgomery III"), "RM");
  assert.equal(initialsFromName("Sammy Davis Jr"), "SD");
});

test("naming particles are skipped", () => {
  assert.equal(initialsFromName("Nienke van der Berg"), "NB");
  assert.equal(initialsFromName("Ludwig van Beethoven"), "LB");
});

test("an emoji-led name yields letter initials, never the emoji", () => {
  const initials = initialsFromName("🇳🇱 Nienke van der Berg");
  assert.equal(initials, "NB");
  assert.ok(!/[\u{1F1E6}-\u{1F1FF}]/u.test(initials), "no flag in the avatar");
});

test("tall and non-Latin scripts are preserved intact", () => {
  // Grapheme clusters keep the combining marks attached; a code-unit slice
  // would cut a Vietnamese or Thai cluster in half.
  const initials = initialsFromName("Nguyễn Thị Thuỳ Dương ณัฐพงษ์ วงศ์สุวรรณ");
  assert.equal([...initials].length, 2, "exactly two graphemes");
  assert.ok(!initials.includes("\uFFFD"), "no replacement character");
});

test("a person with nothing derivable falls back rather than rendering blank", () => {
  assert.equal(avatarInitials({}, "AD"), "AD");
  assert.equal(avatarInitials({ name: "   " }, "AD"), "AD");
  assert.equal(avatarInitials({ name: "🇳🇱" }, "AD"), "AD", "emoji-only name has no letters");
  assert.equal(avatarInitials({ name: "123" }, "AD"), "AD");
});

test("email is the fallback when there is no name", () => {
  assert.equal(
    avatarInitials({ email: "bartholomew.fitzgerald@northwind.example.com" }),
    "B"
  );
  // An address starting with a digit still deserves a chip.
  assert.equal(avatarInitials({ email: "9lives@x.io" }), "9");
});

test("displayName is used when name is absent", () => {
  assert.equal(avatarInitials({ displayName: "Priya Raghunathan" }), "PR");
});

test("initial casing is uppercase regardless of input case", () => {
  assert.equal(initialsFromName("priya raghunathan"), "PR");
  assert.equal(initialsFromName("JO"), "J");
});
