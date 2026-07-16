// ETFdb-backed implementation of the ETF Intelligence provider.
//
// The scraper runs out-of-process so a slow or malformed third-party response
// cannot block the Node event loop. It is intentionally opt-in: enable it with
// ETF_INTELLIGENCE_ETFDB_ENABLED=true after confirming the deployment's use of
// ETFdb is permitted. ETFdb's published robots policy specifies a 3s crawl
// delay; the gate below enforces that delay across all symbols.

const path = require("path");
const { spawn } = require("child_process");

const ENABLED = String(process.env.ETF_INTELLIGENCE_ETFDB_ENABLED || "false").toLowerCase() === "true";
const PYTHON_BINARY = process.env.ETF_INTELLIGENCE_PYTHON_BINARY || process.env.PYTHON_BINARY || "python3";
const WORKER_PATH = path.join(__dirname, "../../../scripts/fetch_etfdb.py");
const REQUEST_TIMEOUT_MS = Math.max(3_000, Number(process.env.ETF_INTELLIGENCE_ETFDB_TIMEOUT_MS || 15_000));
const MIN_REQUEST_INTERVAL_MS = Math.max(3_000, Number(process.env.ETF_INTELLIGENCE_ETFDB_MIN_INTERVAL_MS || 3_100));

const snapshotCache = new Map();
const inflight = new Map();
let lastRequestAt = 0;

function validSymbol(symbol) {
  return /^[A-Z0-9.-]{1,15}$/.test(String(symbol || "").trim().toUpperCase());
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorker(symbol) {
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) await wait(MIN_REQUEST_INTERVAL_MS - elapsed);
  lastRequestAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(PYTHON_BINARY, [WORKER_PATH, symbol], { cwd: path.join(__dirname, "../../..") });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => finish(null));
    child.on("close", (code) => {
      if (code !== 0) return finish(null);
      try {
        const payload = JSON.parse(stdout);
        finish(payload && payload.available === true ? payload : null);
      } catch {
        finish(null);
      }
    });
  });
}

async function getSnapshot(ticker) {
  const symbol = String(ticker || "").trim().toUpperCase();
  if (!ENABLED || !validSymbol(symbol)) return null;
  if (snapshotCache.has(symbol)) return snapshotCache.get(symbol);
  if (inflight.has(symbol)) return inflight.get(symbol);

  const task = runWorker(symbol)
    .then((payload) => {
      if (payload) snapshotCache.set(symbol, payload);
      return payload;
    })
    .finally(() => inflight.delete(symbol));
  inflight.set(symbol, task);
  return task;
}

async function getProfile(ticker) { return (await getSnapshot(ticker))?.profile || null; }
async function getComposition(ticker) { return (await getSnapshot(ticker))?.composition || null; }
async function getClassification(ticker) { return (await getSnapshot(ticker))?.classification || null; }
async function getStrategy(ticker) { return (await getSnapshot(ticker))?.strategy || null; }
async function getPeers(ticker) { return (await getSnapshot(ticker))?.peers || []; }
async function getThemes(ticker) { return (await getSnapshot(ticker))?.themes || []; }

module.exports = {
  providerId: "ETFDB_SCRAPER",
  getProfile,
  getComposition,
  getClassification,
  getStrategy,
  getPeers,
  getThemes,
};
