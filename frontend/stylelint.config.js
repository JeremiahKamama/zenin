/**
 * Zenin Frontend Stylelint Config
 *
 * Design-system guardrails (Phase 8 of the consolidation plan).
 *
 * The repo carries one 39K-line legacy stylesheet (src/styles.css) with a
 * very high volume of pre-existing raw-hex / raw-rgb values. Enabling global
 * color discipline there would be all noise and no signal, so we scope the
 * hard rules to the MANAGED surfaces only:
 *   - all component CSS inside src/components
 *   - any src CSS module file
 *
 * The legacy src/styles.css / src/public.css keep a relaxed config so the
 * linter RUNS and catches structural regressions (unit typos, unknown
 * at-rules) without drowning in the backlog. The token migration of those
 * two files is tracked separately; as it lands, pull them under the strict
 * overrides block.
 *
 * See docs/design-system-foundation-plan-2026-07.md for the full strategy.
 */

/** @type {import('stylelint').Config} */
const STRICT_COLOR_RULES = {
  "color-no-hex": true,
  "color-function-notation": "modern",
  "alpha-value-notation": "percentage",
  "color-named": "never",
  "declaration-property-value-allowed-list": null,
};

export default {
  extends: ["stylelint-config-standard"],
  plugins: ["stylelint-no-unsupported-browser-features"],
  rules: {
    // Baseline relaxations so the legacy files lint cleanly enough to run.
    "no-duplicate-selectors": null,
    "comment-empty-line-before": null,
    "block-no-empty": null,
    "no-descending-specificity": null,
    "selector-class-pattern": null,
    "selector-pseudo-class-no-unknown": [
      true,
      { ignorePseudoClasses: ["global", "local", "deep"] },
    ],
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          "tailwind", "apply", "layer", "config", "theme",
          "screen", "variant", "responsive",
        ],
      },
    ],

    // Keep these on — they catch real bugs cheaply.
    "unit-no-unknown": true,
    "declaration-block-single-line-max-declarations": null, // legacy 39K file is single-line heavy
    "length-zero-no-unit": null,
    "font-family-no-missing-generic-family-keyword": null,
    "property-no-vendor-prefix": null,
    "value-no-vendor-prefix": null,

    "plugin/no-unsupported-browser-features": [
      true,
      { severity: "warning", ignore: ["css-nesting", "css-when-else", "css-has"] },
    ],

    // Legacy (relaxed) color discipline — off for the big files.
    "color-no-hex": null,
    "color-function-notation": null,
    "alpha-value-notation": null,
    "color-named": null,
    "declaration-property-unit-allowed-list": null,
  },

  overrides: [
    {
      // The shared UI kit must be 100% token-adopting (Phase 8 success
      // criteria: zero hardcoded colors in managed components).
      files: ["src/components/**/*.css", "src/**/*.module.css"],
      rules: STRICT_COLOR_RULES,
    },
  ],
};
