import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeImportSymbol,
  normalizeImportCategory,
  inferImportType,
  inferImportMarketType,
  splitDelimitedLine,
  detectDelimiter,
  mapImportRow,
  parseStructuredImportRows,
  parseLooseImportRows,
  parseWatchlistImportPayload,
  UNSUPPORTED_IMPORT_EXTENSIONS
} from "../src/utils/watchlistImportParser.js";

// --- normalizeImportSymbol ---

test("normalizeImportSymbol strips leading $ and special chars", () => {
  assert.equal(normalizeImportSymbol("$AAPL"), "AAPL");
  assert.equal(normalizeImportSymbol("$$BTC"), "BTC");
  assert.equal(normalizeImportSymbol("nvda"), "NVDA");
  assert.equal(normalizeImportSymbol("  tsla  "), "TSLA");
});

test("normalizeImportSymbol truncates to 30 chars", () => {
  const long = "A".repeat(50);
  assert.equal(normalizeImportSymbol(long).length, 30);
});

test("normalizeImportSymbol removes invalid chars", () => {
  assert.equal(normalizeImportSymbol("BRK.B"), "BRK.B");
  assert.equal(normalizeImportSymbol("BTC/USDT"), "BTCUSDT");
  assert.equal(normalizeImportSymbol("SPY@100"), "SPY100");
});

test("normalizeImportSymbol returns empty for null/undefined", () => {
  assert.equal(normalizeImportSymbol(null), "");
  assert.equal(normalizeImportSymbol(undefined), "");
  assert.equal(normalizeImportSymbol(""), "");
});

// --- normalizeImportCategory ---

test("normalizeImportCategory normalizes stock variants", () => {
  assert.equal(normalizeImportCategory("stock"), "stocks");
  assert.equal(normalizeImportCategory("Stock"), "stocks");
  assert.equal(normalizeImportCategory("equity"), "stocks");
  assert.equal(normalizeImportCategory("equities"), "stocks");
});

test("normalizeImportCategory normalizes crypto variants", () => {
  assert.equal(normalizeImportCategory("crypto"), "crypto");
  assert.equal(normalizeImportCategory("cryptocurrency"), "crypto");
  assert.equal(normalizeImportCategory("coin"), "crypto");
});

test("normalizeImportCategory falls back to provided fallback", () => {
  assert.equal(normalizeImportCategory("", "crypto"), "crypto");
  assert.equal(normalizeImportCategory(null, "commodities"), "commodities");
});

// --- inferImportType ---

test("inferImportType infers crypto from category", () => {
  assert.equal(inferImportType({}, "crypto"), "crypto");
  assert.equal(inferImportType({ type: "token" }, "stocks"), "crypto");
});

test("inferImportType infers stock as default", () => {
  assert.equal(inferImportType({}, "stocks"), "stock");
  assert.equal(inferImportType({}), "stock");
});

test("inferImportType infers etf from type field", () => {
  assert.equal(inferImportType({ type: "etf" }, "stocks"), "etf");
  assert.equal(inferImportType({ type: "fund" }, "stocks"), "etf");
});

// --- inferImportMarketType ---

test("inferImportMarketType uses explicit marketType from row", () => {
  assert.equal(inferImportMarketType("stock", { marketType: "futures" }), "futures");
});

test("inferImportMarketType infers from type", () => {
  assert.equal(inferImportMarketType("crypto", {}), "spot");
  assert.equal(inferImportMarketType("indicator", {}), "macro");
  assert.equal(inferImportMarketType("commodity", {}), "commodity");
  assert.equal(inferImportMarketType("stock", {}), "equity");
});

// --- splitDelimitedLine ---

test("splitDelimitedLine splits basic CSV", () => {
  assert.deepEqual(splitDelimitedLine("AAPL,Apple,Tech"), ["AAPL", "Apple", "Tech"]);
});

test("splitDelimitedLine handles quoted fields", () => {
  assert.deepEqual(splitDelimitedLine('"AAPL","Apple, Inc.",Tech'), ["AAPL", "Apple, Inc.", "Tech"]);
});

test("splitDelimitedLine handles escaped quotes", () => {
  assert.deepEqual(splitDelimitedLine('"Say ""hello""",world'), ['Say "hello"', "world"]);
});

test("splitDelimitedLine handles TSV", () => {
  assert.deepEqual(splitDelimitedLine("AAPL\tApple\tTech", "\t"), ["AAPL", "Apple", "Tech"]);
});

// --- detectDelimiter ---

test("detectDelimiter detects tab", () => {
  assert.equal(detectDelimiter("AAPL\tApple\n"), "\t");
});

test("detectDelimiter detects pipe", () => {
  assert.equal(detectDelimiter("AAPL|Apple|Tech"), "|");
});

test("detectDelimiter detects semicolon when no comma", () => {
  assert.equal(detectDelimiter("AAPL;Apple;Tech"), ";");
});

test("detectDelimiter defaults to comma", () => {
  assert.equal(detectDelimiter("AAPL,Apple,Tech"), ",");
  assert.equal(detectDelimiter("AAPL"), ",");
});

// --- mapImportRow ---

test("mapImportRow maps basic row", () => {
  const result = mapImportRow({ symbol: "NVDA", name: "NVIDIA" }, "stocks");
  assert.equal(result.symbol, "NVDA");
  assert.equal(result.name, "NVIDIA");
  assert.equal(result.type, "stock");
  assert.equal(result.category, "stocks");
  assert.equal(result.marketType, "equity");
});

test("mapImportRow returns null for empty symbol", () => {
  assert.equal(mapImportRow({}, "stocks"), null);
  assert.equal(mapImportRow({ symbol: "" }, "stocks"), null);
});

test("mapImportRow uses ticker field as symbol fallback", () => {
  const result = mapImportRow({ ticker: "SOL" }, "crypto");
  assert.equal(result.symbol, "SOL");
  assert.equal(result.type, "crypto");
});

// --- parseStructuredImportRows ---

test("parseStructuredImportRows parses CSV with headers", () => {
  const csv = "Symbol,Name,Category\nAAPL,Apple,stocks\nBTC,Bitcoin,crypto";
  const rows = parseStructuredImportRows(csv, "stocks");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].category, "stocks");
  assert.equal(rows[1].symbol, "BTC");
  assert.equal(rows[1].category, "crypto");
});

test("parseStructuredImportRows parses CSV without headers", () => {
  const csv = "AAPL,Apple,Tech\nNVDA,NVIDIA,AI";
  const rows = parseStructuredImportRows(csv, "stocks");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[0].name, "Apple");
  assert.equal(rows[0].theme, "Tech");
});

test("parseStructuredImportRows returns empty for blank input", () => {
  assert.deepEqual(parseStructuredImportRows("", "stocks"), []);
  assert.deepEqual(parseStructuredImportRows(null, "stocks"), []);
});

// --- parseLooseImportRows ---

test("parseLooseImportRows extracts symbols from free text", () => {
  const rows = parseLooseImportRows("AAPL NVDA TSLA", "stocks");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[1].symbol, "NVDA");
  assert.equal(rows[2].symbol, "TSLA");
});

test("parseLooseImportRows filters blocked words", () => {
  const rows = parseLooseImportRows("AAPL HTTP HTTPS WWW CSV JSON", "stocks");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPL");
});

test("parseLooseImportRows strips URLs", () => {
  const rows = parseLooseImportRows("AAPL https://example.com/foo NVDA", "stocks");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[1].symbol, "NVDA");
});

test("parseLooseImportRows returns empty for blank", () => {
  assert.deepEqual(parseLooseImportRows("", "stocks"), []);
});

// --- parseWatchlistImportPayload ---

test("parseWatchlistImportPayload parses JSON array", () => {
  const json = JSON.stringify([
    { symbol: "AAPL", name: "Apple" },
    { symbol: "NVDA", name: "NVIDIA" }
  ]);
  const rows = parseWatchlistImportPayload(json, "stocks");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, "AAPL");
});

test("parseWatchlistImportPayload parses JSON with assets key", () => {
  const json = JSON.stringify({ assets: [{ symbol: "BTC" }] });
  const rows = parseWatchlistImportPayload(json, "crypto");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "BTC");
  assert.equal(rows[0].type, "crypto");
});

test("parseWatchlistImportPayload deduplicates rows", () => {
  const csv = "Symbol\nAAPL\nAAPL\nAAPL";
  const rows = parseWatchlistImportPayload(csv, "stocks");
  assert.equal(rows.length, 1);
});

test("parseWatchlistImportPayload parses comma-separated symbols without headers", () => {
  const rows = parseWatchlistImportPayload("AAPL,NVDA,TSLA", "stocks");
  // Without headers, treated as a single row: symbol=AAPL, name=NVDA, theme=TSLA
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, "AAPL");
});

test("parseWatchlistImportPayload parses newline-separated symbols", () => {
  const rows = parseWatchlistImportPayload("AAPL\nNVDA\nTSLA", "stocks");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].symbol, "AAPL");
  assert.equal(rows[1].symbol, "NVDA");
  assert.equal(rows[2].symbol, "TSLA");
});

test("parseWatchlistImportPayload returns empty for blank", () => {
  assert.deepEqual(parseWatchlistImportPayload(""), []);
  assert.deepEqual(parseWatchlistImportPayload(null), []);
});

// --- UNSUPPORTED_IMPORT_EXTENSIONS ---

test("UNSUPPORTED_IMPORT_EXTENSIONS contains expected formats", () => {
  assert.ok(UNSUPPORTED_IMPORT_EXTENSIONS.has("xlsx"));
  assert.ok(UNSUPPORTED_IMPORT_EXTENSIONS.has("xls"));
  assert.ok(UNSUPPORTED_IMPORT_EXTENSIONS.has("pdf"));
  assert.ok(UNSUPPORTED_IMPORT_EXTENSIONS.has("docx"));
  assert.ok(!UNSUPPORTED_IMPORT_EXTENSIONS.has("csv"));
  assert.ok(!UNSUPPORTED_IMPORT_EXTENSIONS.has("json"));
});
