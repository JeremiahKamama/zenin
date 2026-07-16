// MacroProviderRegistry — canonical macro data provider metadata.
// Brand v2: monochrome. Badge uses token class, not color.
// Source provenance must always be shown (Objective 11).

export const MACRO_PROVIDERS = {
  FRED: { id: "FRED", label: "FRED", full: "Federal Reserve Economic Data", scope: "USA", kind: "central-bank" },
  BLS: { id: "BLS", label: "BLS", full: "Bureau of Labor Statistics", scope: "USA", kind: "government" },
  WORLDBANK: { id: "WORLDBANK", label: "World Bank", full: "The World Bank", scope: "Global", kind: "multilateral" },
  IMF: { id: "IMF", label: "IMF", full: "International Monetary Fund", scope: "Global", kind: "multilateral" },
  TRADINGECONOMICS: { id: "TRADINGECONOMICS", label: "Trading Economics", full: "Trading Economics", scope: "Global", kind: "aggregator" },
  ECB: { id: "ECB", label: "ECB", full: "European Central Bank", scope: "Eurozone", kind: "central-bank" },
  BOE: { id: "BOE", label: "BoE", full: "Bank of England", scope: "United Kingdom", kind: "central-bank" },
  BOJ: { id: "BOJ", label: "BoJ", full: "Bank of Japan", scope: "Japan", kind: "central-bank" },
  OECD: { id: "OECD", label: "OECD", full: "Organisation for Economic Co-operation and Development", scope: "Global", kind: "multilateral" },
  YAHOO: { id: "YAHOO", label: "Yahoo", full: "Yahoo Finance", scope: "Global", kind: "market" },
};

// Normalize a raw source string from any payload into a known provider id.
export function resolveProviderId(raw = "") {
  const s = String(raw || "").toUpperCase();
  if (!s) return null;
  if (s.includes("FRED")) return "FRED";
  if (s.includes("BLS") || s.includes("LABOR")) return "BLS";
  if (s.includes("WORLD BANK") || s.includes("WORLDBANK")) return "WORLDBANK";
  if (s.includes("IMF")) return "IMF";
  if (s.includes("TRADINGECONOMICS") || s.includes("TE ")) return "TRADINGECONOMICS";
  if (s.includes("ECB") || s.includes("EUROPEAN CENTRAL")) return "ECB";
  if (s.includes("BOE") || s.includes("ENGLAND")) return "BOE";
  if (s.includes("BOJ") || s.includes("JAPAN")) return "BOJ";
  if (s.includes("OECD")) return "OECD";
  if (s.includes("YAHOO")) return "YAHOO";
  return null;
}

export function getProvider(raw) {
  const id = resolveProviderId(raw);
  return id ? MACRO_PROVIDERS[id] : null;
}

export function providerLabel(raw) {
  const p = getProvider(raw);
  return p ? p.label : String(raw || "Source").trim();
}

export default MACRO_PROVIDERS;
