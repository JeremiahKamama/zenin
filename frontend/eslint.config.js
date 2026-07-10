// @ts-check
/**
 * Zenin Frontend ESLint Config (flat config — ESLint 9)
 *
 * Design-system guardrails (Phase 8):
 * These rules enforce the token system by flagging inline `style={{...}}`
 * that contain design-token properties (color / font-size / spacing /
 * radius / z-index / shadow). Inline styles that bypass tokens are the #1
 * source of visual drift. Layout-only inline styles (e.g. `width`,
 * `transform`, `flex`) are intentionally allowed.
 *
 * Severity note: set to "warn" today because the existing codebase has a
 * large legacy backlog of inline styles. The audit script
 * (scripts/design-system-audit.mjs) tracks the count and CI fails if it
 * regresses. Once the backlog is cleared, graduate these to "error".
 */
import js from "@eslint/js";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import globals from "globals";

// Token-prohibited inline-style properties. Setting any of these inline
// bypasses the design system. Layout-only props (width, transform, flex,
// display, etc.) are deliberately NOT listed.
const DESIGN_TOKEN_PROPERTIES = [
  // color
  "color", "backgroundColor", "background", "backgroundImage",
  "borderColor", "borderTopColor", "borderRightColor", "borderBottomColor",
  "borderLeftColor", "outlineColor", "fill", "stroke", "boxShadow",
  "textDecorationColor", "WebkitBoxShadow", "textShadow",
  // typography
  "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing",
  // spacing
  "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
  "gap", "rowGap", "columnGap",
  // shape
  "borderRadius", "borderWidth",
  // layering
  "zIndex",
];

const PROP_SET = new Set(DESIGN_TOKEN_PROPERTIES);

// Custom rule: inspect inline `style` object expressions for token props.
const noInlineDesignToken = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow inline styles that bypass design tokens." },
    messages: {
      tokenProp:
        "Inline style uses `{{prop}}`, which bypasses the design-token system. Use a CSS class with var(--token) instead.",
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      if (node.name?.name !== "style") return;
      const expr = node.value?.expression;
      if (!expr || expr.type !== "ObjectExpression") return;
      for (const prop of expr.properties) {
        if (prop.type !== "Property") continue;
        const key = prop.key?.name ?? prop.key?.value;
        if (typeof key === "string" && PROP_SET.has(key)) {
          context.report({ node: prop, messageId: "tokenProp", data: { prop: key } });
        }
      }
    }
    return { JSXAttribute: check };
  },
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "public/**",
      "scripts/**",
      "*.config.js",
      "vite.config.*",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2022 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
      zenin: { rules: { "no-inline-design-token": noInlineDesignToken } },
    },
    settings: { react: { version: "detect" } },
    rules: {
      // ── React correctness ──────────────────────────────────────────
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── Design-system guardrail (Phase 8) ─────────────────────────
      // Property-aware: only flags inline styles containing token props.
      "zenin/no-inline-design-token": "warn",
    },
  },
];
