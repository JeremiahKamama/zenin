// admin/src/utils/initials.js
//
// Derive up-to-two-character initials from a person's name for avatar chips.
//
// The console used `name.substring(0, 2).toUpperCase()`, which is not an
// initials function at all — it takes the first two CHARACTERS. That is wrong
// in three ways that real names expose:
//
//   "Jo"                  -> "JO"   the "o" is not an initial
//   "Reginald P. Montgomery III" -> "RE"  (should reasonably be "RM")
//   "🇳🇱 Nienke van der Berg"     -> "🇳"  and `charAt(0)` returns the
//                                          LONE SURROGATE "\ud83c", which
//                                          renders as the replacement
//                                          glyph — a visibly broken avatar.
//
// Grapheme-cluster segmentation via Intl.Segmenter is what makes the emoji and
// the combining diacritics in Vietnamese/Thai names survive intact. It is
// available in every browser this console supports; the Array.from fallback
// keeps older engines working without splitting surrogate pairs.

const SEGMENTER =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Split a string into user-perceived characters (grapheme clusters). */
function toGraphemes(value) {
  const text = String(value || "");
  if (SEGMENTER) {
    return Array.from(SEGMENTER.segment(text), (part) => part.segment);
  }
  // Array.from iterates by code point, so surrogate pairs stay whole even
  // without Intl.Segmenter (combining marks may still separate).
  return Array.from(text);
}

/** Name suffixes that should never be treated as a person's last name. */
const SUFFIXES = new Set([
  "jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v",
  "phd", "ph.d.", "md", "m.d.", "esq", "esq.", "cpa", "dds", "rn"
]);

/**
 * Words that carry meaning in an initials chip. Drops:
 *  - flag/emoji tokens (they are not letters),
 *  - honorifics and suffixes, so "Reginald Montgomery III" gives RM not RI,
 *  - particles like "van", "der", "de", "bin" so Dutch/Arabic names read right.
 */
const PARTICLES = new Set([
  "van", "von", "der", "den", "de", "da", "di", "del", "della",
  "bin", "binti", "al", "el", "la", "le", "ter", "ten", "op"
]);

function isLetterGrapheme(grapheme) {
  return /^\p{L}$/u.test(grapheme);
}

/**
 * Build avatar initials from a display name.
 *
 * @param {string} name
 * @returns {string} one or two graphemes, or "" when the name has no letters
 */
function initialsFromName(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Keep only words whose first grapheme is a letter — this drops a leading
  // flag emoji and any punctuation-only token.
  const wordsWithLetters = words
    .map((word) => ({ word, first: toGraphemes(word)[0] }))
    .filter((entry) => entry.first && isLetterGrapheme(entry.first));

  if (!wordsWithLetters.length) return "";

  const meaningful = wordsWithLetters.filter(({ word }) => {
    const bare = word.toLowerCase().replace(/[.,]/g, "");
    return !SUFFIXES.has(bare) && !PARTICLES.has(bare);
  });

  // If every word was a particle/suffix, fall back to what we have rather
  // than returning nothing.
  const source = meaningful.length ? meaningful : wordsWithLetters;

  const first = source[0].first;
  if (source.length === 1) return first.toUpperCase();

  const last = source[source.length - 1].first;
  return (first + last).toUpperCase();
}

/**
 * Initials for an avatar, falling back to the email's first letter and then to
 * a placeholder so the chip is never blank.
 *
 * @param {{name?: string, displayName?: string, email?: string}} person
 * @param {string} fallback shown when there is nothing to derive from
 */
function avatarInitials(person, fallback = "?") {
  const fromName = initialsFromName(person?.name || person?.displayName);
  if (fromName) return fromName;

  const email = String(person?.email || "").trim();
  if (email) {
    const first = toGraphemes(email)[0];
    if (first && isLetterGrapheme(first)) return first.toUpperCase();
    // An email starting with a digit or symbol still deserves a chip.
    if (first) return first.toUpperCase();
  }

  return fallback;
}

export { avatarInitials, initialsFromName, toGraphemes };
