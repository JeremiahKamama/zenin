const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FARSIDE_ETF_SOURCES,
  fetchFarsideEtfFlows,
  _internals,
} = require("../../farsideEtf");

const {
  decodeHtmlEntities,
  flattenFarsideHtml,
  parseFarsideNumber,
  toIsoDate,
  extractLatestCompletedRow,
  buildFlowRows,
} = _internals;

// ── FARSIDE_ETF_SOURCES config ────────────────────────────────────────────────

test("FARSIDE_ETF_SOURCES contains BTC, ETH, SOL", () => {
  assert.ok(FARSIDE_ETF_SOURCES.BTC);
  assert.ok(FARSIDE_ETF_SOURCES.ETH);
  assert.ok(FARSIDE_ETF_SOURCES.SOL);
});

test("BTC config has matching tickers and managers length", () => {
  const btc = FARSIDE_ETF_SOURCES.BTC;
  assert.equal(btc.tickers.length, btc.managers.length);
  assert.equal(btc.asset, "BTC");
  assert.ok(btc.url.startsWith("https://"));
});

test("ETH config has matching tickers and managers length", () => {
  const eth = FARSIDE_ETF_SOURCES.ETH;
  assert.equal(eth.tickers.length, eth.managers.length);
  assert.equal(eth.asset, "ETH");
});

test("SOL config has matching tickers and managers length", () => {
  const sol = FARSIDE_ETF_SOURCES.SOL;
  assert.equal(sol.tickers.length, sol.managers.length);
  assert.equal(sol.asset, "SOL");
});

// ── fetchFarsideEtfFlows ──────────────────────────────────────────────────────

test("fetchFarsideEtfFlows throws if fetch is not a function", async () => {
  await assert.rejects(() => fetchFarsideEtfFlows(null), /fetch implementation is required/);
  await assert.rejects(() => fetchFarsideEtfFlows("string"), /fetch implementation is required/);
});

test("fetchFarsideEtfFlows returns empty array when all fetches fail", async () => {
  const mockFetch = async () => ({ ok: false, status: 500, text: async () => "" });
  const result = await fetchFarsideEtfFlows(mockFetch);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test("fetchFarsideEtfFlows parses valid HTML with flow data", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const flowValues = Array.from({ length: tickerCount }, (_, i) => (i + 1) * 10);
  const totalFlow = flowValues.reduce((a, b) => a + b, 0);

  const htmlLines = [
    "<table>",
    "<tr><td>15 Jan 2025</td>",
    ...flowValues.map((v) => `<td>${v}</td>`),
    `<td>${totalFlow}</td>`,
    "</tr>",
    "</table>",
  ];
  const html = htmlLines.join("");

  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  assert.ok(callCount >= 1);

  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.ok(btcFlows.length > 0);
  btcFlows.forEach((flow) => {
    assert.equal(flow.date, "2025-01-15");
    assert.equal(flow.period, "daily");
    assert.equal(flow.source, "Farside");
    assert.ok(flow.id.startsWith("farside-BTC-"));
    assert.ok(Number.isFinite(flow.netUsd));
  });
});

test("fetchFarsideEtfFlows skips rows with no numeric values", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const dashes = Array.from({ length: tickerCount + 1 }, () => "-");

  const html = [
    "<tr><td>20 Feb 2025</td>",
    ...dashes.map((d) => `<td>${d}</td>`),
    "</tr>",
  ].join("");

  const mockFetch = async (url) => {
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.equal(btcFlows.length, 0);
});

test("fetchFarsideEtfFlows handles negative values in parentheses", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const values = Array.from({ length: tickerCount }, () => "(50)");
  const total = `(${50 * tickerCount})`;

  const html = [
    "<tr><td>10 Mar 2025</td>",
    ...values.map((v) => `<td>${v}</td>`),
    `<td>${total}</td>`,
    "</tr>",
  ].join("");

  const mockFetch = async (url) => {
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.ok(btcFlows.length > 0);
  btcFlows.forEach((flow) => {
    assert.ok(flow.netUsd < 0, `Expected negative netUsd, got ${flow.netUsd}`);
  });
});

test("fetchFarsideEtfFlows handles HTML entities", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const values = Array.from({ length: tickerCount }, () => "100");
  const total = `${100 * tickerCount}`;

  const html = [
    "<tr><td>05&nbsp;Apr&nbsp;2025</td>",
    ...values.map((v) => `<td>${v}</td>`),
    `<td>${total}</td>`,
    "</tr>",
  ].join("");

  const mockFetch = async (url) => {
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.ok(btcFlows.length > 0);
  assert.equal(btcFlows[0].date, "2025-04-05");
});

test("fetchFarsideEtfFlows uses latest row when multiple dates present", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const values1 = Array.from({ length: tickerCount }, () => "10");
  const values2 = Array.from({ length: tickerCount }, () => "20");

  const html = [
    "<tr><td>01 Jan 2025</td>",
    ...values1.map((v) => `<td>${v}</td>`),
    `<td>${10 * tickerCount}</td>`,
    "</tr>",
    "<tr><td>02 Jan 2025</td>",
    ...values2.map((v) => `<td>${v}</td>`),
    `<td>${20 * tickerCount}</td>`,
    "</tr>",
  ].join("");

  const mockFetch = async (url) => {
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.ok(btcFlows.length > 0);
  assert.equal(btcFlows[0].date, "2025-01-02");
  assert.equal(btcFlows[0].netUsd, 20_000_000);
});

test("fetchFarsideEtfFlows handles comma-separated numbers", async () => {
  const tickerCount = FARSIDE_ETF_SOURCES.BTC.tickers.length;
  const values = Array.from({ length: tickerCount }, () => "1,234");

  const html = [
    "<tr><td>15 Jun 2025</td>",
    ...values.map((v) => `<td>${v}</td>`),
    `<td>${1234 * tickerCount}</td>`,
    "</tr>",
  ].join("");

  const mockFetch = async (url) => {
    if (url === FARSIDE_ETF_SOURCES.BTC.url) {
      return { ok: true, status: 200, text: async () => html };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  const flows = await fetchFarsideEtfFlows(mockFetch);
  const btcFlows = flows.filter((f) => f.asset === "BTC");
  assert.ok(btcFlows.length > 0);
  assert.equal(btcFlows[0].netUsd, 1_234_000_000);
});

// ── decodeHtmlEntities ────────────────────────────────────────────────────────

test("decodeHtmlEntities decodes &nbsp; and &#160;", () => {
  assert.equal(decodeHtmlEntities("hello&nbsp;world"), "hello world");
  assert.equal(decodeHtmlEntities("a&#160;b"), "a b");
});

test("decodeHtmlEntities decodes &amp; &quot; &#39; &apos;", () => {
  assert.equal(decodeHtmlEntities("A&amp;B"), "A&B");
  assert.equal(decodeHtmlEntities("say&quot;hi&quot;"), 'say"hi"');
  assert.equal(decodeHtmlEntities("it&#39;s"), "it's");
  assert.equal(decodeHtmlEntities("it&apos;s"), "it's");
});

test("decodeHtmlEntities handles null/undefined", () => {
  assert.equal(decodeHtmlEntities(null), "");
  assert.equal(decodeHtmlEntities(undefined), "");
});

// ── flattenFarsideHtml ────────────────────────────────────────────────────────

test("flattenFarsideHtml strips tags and scripts", () => {
  const html = "<script>alert(1)</script><p>Hello</p><div>World</div>";
  const lines = flattenFarsideHtml(html);
  assert.ok(!lines.some((l) => l.includes("alert")));
  assert.ok(lines.includes("Hello"));
  assert.ok(lines.includes("World"));
});

test("flattenFarsideHtml converts br to newlines", () => {
  const html = "A<br/>B<br>C";
  const lines = flattenFarsideHtml(html);
  assert.ok(lines.includes("A"));
  assert.ok(lines.includes("B"));
  assert.ok(lines.includes("C"));
});

test("flattenFarsideHtml filters empty lines", () => {
  const html = "<p></p><p>Data</p><p></p>";
  const lines = flattenFarsideHtml(html);
  assert.ok(!lines.includes(""));
  assert.ok(lines.includes("Data"));
});

// ── parseFarsideNumber ────────────────────────────────────────────────────────

test("parseFarsideNumber parses positive numbers", () => {
  assert.equal(parseFarsideNumber("42"), 42);
  assert.equal(parseFarsideNumber("3.14"), 3.14);
});

test("parseFarsideNumber parses negative numbers", () => {
  assert.equal(parseFarsideNumber("-100"), -100);
});

test("parseFarsideNumber parses parenthesized negatives", () => {
  assert.equal(parseFarsideNumber("(50)"), -50);
  assert.equal(parseFarsideNumber("(3.5)"), -3.5);
});

test("parseFarsideNumber strips commas and asterisks", () => {
  assert.equal(parseFarsideNumber("1,234*"), 1234);
  assert.equal(parseFarsideNumber("1,234,567"), 1234567);
});

test("parseFarsideNumber normalizes en-dash and em-dash to minus", () => {
  assert.equal(parseFarsideNumber("–100"), -100);
  assert.equal(parseFarsideNumber("—50"), -50);
  assert.equal(parseFarsideNumber("−25"), -25);
});

test("parseFarsideNumber returns null for dash-only values", () => {
  assert.equal(parseFarsideNumber("-"), null);
  assert.equal(parseFarsideNumber("–"), null);
  assert.equal(parseFarsideNumber("—"), null);
});

test("parseFarsideNumber returns null for pending/yes/no", () => {
  assert.equal(parseFarsideNumber("pending"), null);
  assert.equal(parseFarsideNumber("PENDING"), null);
  assert.equal(parseFarsideNumber("yes"), null);
  assert.equal(parseFarsideNumber("no"), null);
});

test("parseFarsideNumber returns null for empty/whitespace", () => {
  assert.equal(parseFarsideNumber(""), null);
  assert.equal(parseFarsideNumber("   "), null);
  assert.equal(parseFarsideNumber(null), null);
  assert.equal(parseFarsideNumber(undefined), null);
});

// ── toIsoDate ─────────────────────────────────────────────────────────────────

test("toIsoDate converts valid date labels", () => {
  assert.equal(toIsoDate("15 Jan 2025"), "2025-01-15");
  assert.equal(toIsoDate("01 Dec 2024"), "2024-12-01");
  assert.equal(toIsoDate("28 Feb 2023"), "2023-02-28");
});

test("toIsoDate returns null for invalid formats", () => {
  assert.equal(toIsoDate("Jan 15 2025"), null);
  assert.equal(toIsoDate("2025-01-15"), null);
  assert.equal(toIsoDate("15 Xyz 2025"), null);
  assert.equal(toIsoDate(""), null);
  assert.equal(toIsoDate(null), null);
});

// ── extractLatestCompletedRow ─────────────────────────────────────────────────

test("extractLatestCompletedRow picks last valid row", () => {
  const lines = [
    "01 Jan 2025",
    "10",
    "20",
    "30",
    "02 Jan 2025",
    "40",
    "50",
    "90",
  ];
  const row = extractLatestCompletedRow(lines, 2);
  assert.ok(row);
  assert.equal(row.dateLabel, "02 Jan 2025");
  assert.deepEqual(row.flowValues, [40, 50]);
  assert.equal(row.total, 90);
});

test("extractLatestCompletedRow returns null for no valid rows", () => {
  const lines = ["not a date", "foo", "bar"];
  const row = extractLatestCompletedRow(lines, 2);
  assert.equal(row, null);
});

test("extractLatestCompletedRow skips rows with no numeric flows", () => {
  const lines = [
    "01 Jan 2025",
    "-",
    "-",
    "-",
  ];
  const row = extractLatestCompletedRow(lines, 2);
  assert.equal(row, null);
});

// ── buildFlowRows ─────────────────────────────────────────────────────────────

test("buildFlowRows builds rows from valid config and row", () => {
  const config = {
    asset: "BTC",
    tickers: ["IBIT", "FBTC"],
    managers: ["BlackRock", "Fidelity"],
  };
  const row = {
    dateLabel: "15 Mar 2025",
    total: 300,
    flowValues: [100, 200],
  };
  const flows = buildFlowRows(config, row);
  assert.equal(flows.length, 2);
  assert.equal(flows[0].ticker, "IBIT");
  assert.equal(flows[0].manager, "BlackRock");
  assert.equal(flows[0].netUsd, 100_000_000);
  assert.equal(flows[0].date, "2025-03-15");
  assert.equal(flows[1].ticker, "FBTC");
  assert.equal(flows[1].netUsd, 200_000_000);
});

test("buildFlowRows returns empty for invalid date", () => {
  const config = {
    asset: "BTC",
    tickers: ["IBIT"],
    managers: ["BlackRock"],
  };
  const row = { dateLabel: "bad date", flowValues: [100] };
  assert.deepEqual(buildFlowRows(config, row), []);
});

test("buildFlowRows skips null flow values", () => {
  const config = {
    asset: "ETH",
    tickers: ["ETHA", "ETHB"],
    managers: ["BlackRock", "BlackRock"],
  };
  const row = {
    dateLabel: "01 Apr 2025",
    total: 50,
    flowValues: [null, 50],
  };
  const flows = buildFlowRows(config, row);
  assert.equal(flows.length, 1);
  assert.equal(flows[0].ticker, "ETHB");
});
