// ── Chart Theme Resolver (Brand System v2 — monochrome) ─────────────
// Chart libraries (apexcharts, recharts, lightweight-charts) do not resolve
// CSS custom properties reliably, so they need concrete color values that
// match the active theme. This helper reads the resolved value of a design
// token from the document and returns a hex/rgba string the chart can use.
//
// Brand v2 default chart series are monochrome:
//   portfolio / primary → white
//   benchmark           → gray
//   comparison          → darker gray
// Green / red appear ONLY where the underlying data carries market direction
// (candlesticks, P&L bars, tick arrows). Volume histograms are neutral gray.
//
// Usage:
//   import { chartColors } from "../utils/chartTheme";
//   const opts = { colors: chartColors.primary() };

const TOKEN_CACHE = new Map();
let lastTheme = "";

function readToken(name) {
  if (typeof window === "undefined" || !document.documentElement) return "";
  const root = document.documentElement;
  // Bust the cache when the theme class changes.
  const theme = root.classList.contains("light-theme-active") ? "light" : "dark";
  if (theme !== lastTheme) {
    TOKEN_CACHE.clear();
    lastTheme = theme;
  }
  if (TOKEN_CACHE.has(name)) return TOKEN_CACHE.get(name);
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  TOKEN_CACHE.set(name, value);
  return value;
}

/** Resolve any design token to its current concrete value. */
export function resolveChartToken(token) {
  const name = token.startsWith("--") ? token : `--${token}`;
  return readToken(name) || token;
}

/** Returns "light" or "dark" based on the active theme class on <html>.
 *  Use for chart-library options that take a theme mode string (e.g.
 *  apexcharts `theme.mode`). The class is the source of truth, set by
 *  App.jsx's theme effect before first paint. */
export function activeChartThemeMode() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light-theme-active")
    ? "light"
    : "dark";
}

/** Curried accessors for the monochrome + semantic chart palette.
 *  Each returns the resolved value for the active theme, so charts
 *  re-render with correct colors. */
export const chartColors = {
  // ── Monochrome series (Brand v2) ─────────────────────────────────
  /** Primary series — portfolio / focal line. White on dark, near-black on light. */
  primary: () => resolveChartToken("color-data-primary"),
  /** Secondary series — benchmark. Mid-gray. */
  secondary: () => resolveChartToken("color-data-secondary"),
  /** Tertiary series — historical comparison. Darker gray. */
  muted: () => resolveChartToken("color-data-muted"),

  // Legacy aliases retained so unmigrated call-sites resolve to neutrals
  // instead of cyan. DELETE once all chart consumers use primary/secondary.
  success: () => resolveChartToken("color-success"),
  danger: () => resolveChartToken("color-danger"),
  warning: () => resolveChartToken("color-warning"),
  info: () => resolveChartToken("color-data-secondary"),
  text: () => resolveChartToken("color-text-secondary"),
  textPrimary: () => resolveChartToken("color-text-primary"),
  surface: () => resolveChartToken("color-surface-card"),

  // ── Semantic only ────────────────────────────────────────────────
  /** P&L pair: green positive / red negative. Use ONLY for directional data. */
  pnl: (value) =>
    Number(value || 0) >= 0 ? chartColors.success() : chartColors.danger(),
  up: () => resolveChartToken("color-data-up"),
  down: () => resolveChartToken("color-data-down"),

  // ── Monochrome categorical ramp (for allocation/donut charts) ────
  // White → successively darker gray. No saturated hues.
  palette: () => [
    resolveChartToken("color-data-primary"),
    resolveChartToken("color-data-secondary"),
    resolveChartToken("color-data-muted"),
    resolveChartToken("color-text-dim"),
    resolveChartToken("color-border-strong"),
  ],
};
