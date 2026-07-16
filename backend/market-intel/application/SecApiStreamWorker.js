// market-intel/application/SecApiStreamWorker.js
// Backend document-intelligence event pipeline (Sec API stream).
//
// Per spec §4:
//   - Starts only when SEC_API_IO_STREAM_ENABLED=true AND SEC_API_IO_KEY present.
//   - Authenticates server-side; reconnects with capped exponential backoff
//     (SEC_API_IO_STREAM_RECONNECT_MAX_MS, default 60s).
//   - Deduplicates by (accessionNumber, eventType).
//   - Persists normalized events in market_events; matches workspace watchlists
//     and portfolio holdings; creates market_portfolio_signals + in-app
//     notifications for MATERIAL events only.
//   - Routine filings stay in the ARW timeline WITHOUT generating notifications.
//
// Ingestion (ingestRaw) is transport-agnostic and pure given injected deps, so
// it is fully unit-testable without a live socket.

const { EVENT_TYPES } = require("./MarketEventEngine");

const MATERIAL_FORMS = new Set(["8-K", "10-K", "10-Q", "DEF 14A", "S-1", "S-3", "SC 13D", "SC 13G", "13F-HR"]);
const ALERT_FORMS = new Set(["8-K", "10-K", "10-Q", "SC 13D", "SC 13G"]);
const RECONNECT_MAX_MS = Number(process.env.SEC_API_IO_STREAM_RECONNECT_MAX_MS || 60000);
const INSIDER_MATERIALITY_SHARES = Number(process.env.SEC_API_IO_INSIDER_SHARES_THRESHOLD || 10000);

function dedupId(eventType, accessionNumber, symbol) {
  return `${eventType}::${accessionNumber || symbol || "unknown"}::${symbol || ""}`;
}

// Classify a raw Sec API stream event into { eventType, material, payload }.
function classify(raw) {
  const form = (raw.formType || raw.form || "").trim();
  const symbol = (raw.ticker || raw.symbol || "").toUpperCase();
  const accessionNumber = raw.accessionNo || raw.accessionNumber || null;

  // Ownership (13F) is routine — surfaced in timeline, never alerted, and must
  // be checked BEFORE the material-forms catch-all below.
  if (form === "13F-HR") {
    return {
      eventType: EVENT_TYPES.OWNERSHIP_CHANGE,
      material: false,
      payload: { formType: "13F-HR", accessionNumber, symbol, holder: raw.name || raw.filingManager || null, filedAt: raw.filedAt || raw.filingDate || null, url: raw.documentUrl || raw.url || null },
    };
  }
  if (MATERIAL_FORMS.has(form)) {
    return {
      eventType: EVENT_TYPES.FILING_MATERIAL,
      material: ALERT_FORMS.has(form),
      payload: { formType: form, accessionNumber, symbol, filedAt: raw.filedAt || raw.filingDate || null, title: raw.title || form, url: raw.documentUrl || raw.url || null },
    };
  }
  if (form === "4") {
    const shares = Number(raw.sharesTransacted ?? raw.shares ?? 0);
    const material = shares >= INSIDER_MATERIALITY_SHARES;
    return {
      eventType: EVENT_TYPES.INSIDER_TRANSACTION,
      material,
      payload: { formType: "4", accessionNumber, symbol, insider: raw.reportingOwner || raw.name || null, transactionType: raw.transactionType || null, shares, filedAt: raw.filedAt || raw.filingDate || null, url: raw.documentUrl || raw.url || null },
    };
  }
  if (["N-PORT", "N-CSR", "N-CEN", "485BPOS", "497K"].includes(form)) {
    return {
      eventType: EVENT_TYPES.FUND_REGULATORY_UPDATE,
      material: form === "485BPOS" || form === "N-PORT",
      payload: { formType: form, accessionNumber, symbol, filedAt: raw.filedAt || raw.filingDate || null, url: raw.documentUrl || raw.url || null },
    };
  }
  // Unknown / routine form — do not alert, but allow ARW timeline via caller.
  return { eventType: null, material: false, payload: { formType: form, accessionNumber, symbol } };
}

class SecApiStreamWorker {
  constructor({ db, notifier, matcher, eventBus } = {}) {
    this._db = db || null;
    this._notifier = notifier || null; // { notify(recipient, title, body, opts) }
    this._matcher = matcher || (async () => []); // (symbol) => [{userId, workspaceId}]
    this._eventBus = eventBus || null;
    this._running = false;
    this._attempt = 0;
    this._timer = null;
  }

  isConfigured() {
    return Boolean(process.env.SEC_API_IO_KEY) && process.env.SEC_API_IO_STREAM_ENABLED === "true";
  }

  // Pure ingestion path — testable without a socket.
  async ingestRaw(raw) {
    const { eventType, material, payload } = classify(raw);
    if (!eventType) return { accepted: false, reason: "non-alertable-form" };
    const id = dedupId(eventType, payload.accessionNumber, payload.symbol);

    // Dedup: skip if already persisted.
    if (this._db) {
      const existing = await this._db.query("SELECT id FROM market_events WHERE id = $1", [id]);
      if (existing.rowCount > 0) return { accepted: false, reason: "duplicate" };
      await this._db.query(
        `INSERT INTO market_events (id, event_type, symbol, payload, source, origin)
         VALUES ($1, $2, $3, $4, 'sec-api', 'document-intelligence')
         ON CONFLICT (id) DO NOTHING`,
        [id, eventType, payload.symbol || null, JSON.stringify(payload)]
      );
    }

    if (this._eventBus && typeof this._eventBus.emit === "function") {
      this._eventBus.emit("market:event", { id, type: eventType, symbol: payload.symbol, payload, createdAt: new Date().toISOString(), source: "sec-api", origin: "document-intelligence" });
    }

    if (!material) return { accepted: true, alerted: false };

    // Match watchlists/holdings and create signals + notifications.
    const recipients = await this._matcher(payload.symbol || "");
    for (const r of recipients) {
      const signalId = `${id}::${r.userId}`;
      if (this._db) {
        await this._db.query(
          `INSERT INTO market_portfolio_signals (id, user_id, workspace_id, event_id, event_type, symbol, payload, severity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'high')
           ON CONFLICT (id) DO NOTHING`,
          [signalId, r.userId, r.workspaceId || null, id, eventType, payload.symbol || null, JSON.stringify(payload)]
        );
      }
      if (this._notifier) {
        await this._notifier.notify(
          { userId: r.userId, workspaceId: r.workspaceId || null },
          `${payload.symbol} ${payload.formType} filed`,
          `${payload.symbol} filed ${payload.formType}${payload.title ? ` — ${payload.title}` : ""}.`,
          { category: "document-intelligence", actionUrl: payload.url || null }
        );
      }
    }
    return { accepted: true, alerted: recipients.length > 0, recipients: recipients.length };
  }

  start() {
    if (!this.isConfigured() || this._running) return false;
    this._running = true;
    this._connect();
    return true;
  }

  stop() {
    this._running = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  // Transport layer: connect to the Sec API stream. Implemented defensively —
  // if the stream endpoint/module is unavailable, schedule a capped backoff
  // reconnect rather than crash. Real transport wiring happens once the
  // Sec API stream entitlement + endpoint are confirmed in production.
  _connect() {
    if (!this._running) return;
    // Placeholder for live transport:
    //   const ws = new WebSocket(`wss://...?token=${process.env.SEC_API_IO_KEY}`);
    //   ws.on('message', (m) => this.ingestRaw(JSON.parse(m)));
    //   ws.on('close', () => this._scheduleReconnect());
    //   ws.on('error', () => this._scheduleReconnect());
    // For now, no-op connect with backoff so the worker is runtime-safe without
    // a confirmed stream contract (alerts still flow via on-demand ingest path).
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (!this._running) return;
    this._attempt += 1;
    const backoff = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** (this._attempt - 1));
    this._timer = setTimeout(() => this._connect(), backoff);
  }
}

module.exports = { SecApiStreamWorker, classify, dedupId, MATERIAL_FORMS, RECONNECT_MAX_MS };
