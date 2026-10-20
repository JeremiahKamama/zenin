// admin/src/utils/pluralize.js
//
// Plural-aware count formatting.
//
// The console hardcoded the plural: "1 rows", "1 sessions were revoked",
// "Showing 1 to 1 of 1 users", "ran for 1 users". A count of exactly one is
// the case demo data never contains, so it reached production.
//
// Intl.PluralRules is used rather than `n === 1 ? x : xs` because "one" is not
// the same as "equals 1" in every locale — and because the console is
// English-only today but the counts are not inherently so.

const PLURAL_RULES = typeof Intl !== "undefined" && Intl.PluralRules
  ? new Intl.PluralRules("en")
  : null;

/**
 * Pick the singular or plural form for a count.
 *
 * @param {number} count
 * @param {string} singular  e.g. "user"
 * @param {string} [plural]  defaults to singular + "s"
 * @returns {string} e.g. "1 user", "2 users"
 */
function pluralize(count, singular, plural) {
  const n = Number(count);
  const safe = Number.isFinite(n) ? n : 0;
  const category = PLURAL_RULES ? PLURAL_RULES.select(safe) : (safe === 1 ? "one" : "other");
  const word = category === "one" ? singular : (plural || `${singular}s`);
  return `${formatCount(safe)} ${word}`;
}

/**
 * Locale-formatted integer. Guards null/NaN, which would otherwise render as
 * "NaN" or "undefined" straight into the UI.
 */
function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en").format(n);
}

export { pluralize, formatCount };
