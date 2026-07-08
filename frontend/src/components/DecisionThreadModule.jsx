import { useCallback, useEffect, useMemo, useState } from "react";
import { CompactPageHeader, DensePanelHeader, GuidedEmptyState, InlineControlGroup } from "./CompactWorkspaceUI";
import { zeninFetch } from "../utils/zeninFetch";

const STATUS_COLUMNS = [
  { key: "new", label: "New" },
  { key: "triaged", label: "Triaged" },
  { key: "researching", label: "Researching" },
  { key: "journaled", label: "Journaled" },
  { key: "review_due", label: "Review due" },
  { key: "reviewed", label: "Reviewed" }
];

const REVIEW_RESULTS = ["win", "loss", "breakeven", "avoided", "missed"];

// User-selectable thread sources. trade_execution is intentionally excluded:
// no frontend flow sets linkedTradeExecutionId, so offering it invites
// self-classification with no execution linked. Kept in SOURCE_LABELS so any
// server-side record still renders.
const SOURCE_OPTIONS = ["manual", "daily_briefing", "alert", "research"];
const SOURCE_LABELS = {
  manual: "Manual",
  daily_briefing: "Daily briefing",
  alert: "Alert",
  trade_execution: "Trade execution",
  research: "Research"
};

function formatRelativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatDueDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return "overdue";
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days < 1) return "due today";
  if (days === 1) return "due in 1 day";
  return `due in ${days} days`;
}

export function DecisionThreadModule({
  decisionThreads = [],
  isGuestUser = false,
  onThreadsChanged,
  onOpenSection
}) {
  const [threads, setThreads] = useState(Array.isArray(decisionThreads) ? decisionThreads : []);
  const [selectedId, setSelectedId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: "", symbol: "", priority: "medium", sourceType: "manual" });
  const [reviewDraft, setReviewDraft] = useState({ result: "", pnl: "", lesson: "", mistakeTag: "" });
  // Phase 5: drag-and-drop between Kanban columns + WIP limit indicator.
  const [dragSource, setDragSource] = useState(null);
  const [dragOverColumn, setDragOverColumn] = useState(null);
  const WIP_LIMIT = 8;
  // Phase 5: outcomes review view.
  const [showOutcomes, setShowOutcomes] = useState(false);
  const [outcomes, setOutcomes] = useState({ items: [], aggregated: { byResult: {}, totalPnl: 0, winCount: 0, lossCount: 0, total: 0 } });
  const [outcomesLoading, setOutcomesLoading] = useState(false);
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [boardFilter, setBoardFilter] = useState("all");
  const [showActivity, setShowActivity] = useState(false);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    setThreads(Array.isArray(decisionThreads) ? decisionThreads : []);
  }, [decisionThreads]);

  const selectedThread = useMemo(
    () => threads.find((t) => String(t.id) === String(selectedId)) || null,
    [threads, selectedId]
  );

  const refreshThreads = useCallback(async () => {
    setThreadsLoading(true);
    setFeedback(null);
    try {
      const res = await zeninFetch("/decision-threads");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load decision threads");
      const next = Array.isArray(data?.items) ? data.items : [];
      setThreads(next);
      onThreadsChanged?.(next);
    } catch (error) {
      setFeedback(error.message || "Failed to load decision threads.");
    } finally {
      setThreadsLoading(false);
    }
  }, [onThreadsChanged]);

  const loadOutcomes = useCallback(async () => {
    setOutcomesLoading(true);
    try {
      const params = new URLSearchParams();
      if (outcomeFilter && outcomeFilter !== "all") params.set("result", outcomeFilter);
      params.set("limit", "100");
      const res = await zeninFetch(`/decision-threads/outcomes?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load outcomes");
      setOutcomes({
        items: Array.isArray(data?.items) ? data.items : [],
        aggregated: data?.aggregated || { byResult: {}, totalPnl: 0, winCount: 0, lossCount: 0, total: 0 }
      });
    } catch (error) {
      setFeedback(error.message || "Failed to load decision outcomes.");
    } finally {
      setOutcomesLoading(false);
    }
  }, [outcomeFilter]);

  useEffect(() => {
    if (showOutcomes) void loadOutcomes();
  }, [showOutcomes, loadOutcomes]);

  const loadActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const res = await zeninFetch("/workspaces/current/activity?limit=25");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to load activity");
      setActivity(Array.isArray(data?.items) ? data.items : []);
    } catch (error) {
      setFeedback(error.message || "Failed to load activity timeline.");
    } finally {
      setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showActivity) void loadActivity();
  }, [showActivity, loadActivity]);

  const handleCreate = useCallback(async () => {
    const title = String(draft.title || "").trim();
    if (!title) {
      setFeedback("Title is required.");
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const payload = {
        title,
        symbol: draft.symbol ? String(draft.symbol).trim().toUpperCase() : null,
        priority: draft.priority || "medium",
        sourceType: draft.sourceType || "manual"
      };
      const res = await zeninFetch("/decision-threads", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create decision thread");
      setDraft({ title: "", symbol: "", priority: "medium", sourceType: "manual" });
      await refreshThreads();
      setSelectedId(data?.thread?.id || null);
    } catch (error) {
      setFeedback(error.message || "Failed to create decision thread.");
    } finally {
      setCreating(false);
    }
  }, [draft, refreshThreads]);

  const handleUpdateStatus = useCallback(async (thread, status) => {
    if (!thread?.id) return;
    try {
      const res = await zeninFetch(`/decision-threads/${thread.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update thread");
      await refreshThreads();
    } catch (error) {
      setFeedback(error.message || "Failed to update thread.");
    }
  }, [refreshThreads]);

  const handleOpenResearch = useCallback((thread) => {
    onOpenSection?.("Research");
  }, [onOpenSection]);

  const handleCreateJournal = useCallback(async (thread) => {
    if (!thread?.id) return;
    try {
      const res = await zeninFetch(`/decision-threads/${thread.id}/create-journal-entry`, {
        method: "POST",
        body: JSON.stringify({
          symbol: thread.symbol || "",
          preThesis: thread.title || ""
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create journal entry");
      await refreshThreads();
      onOpenSection?.("Journal", {
        symbol: thread.symbol || "",
        preThesis: thread.title || "",
        decisionThreadId: thread.id
      });
    } catch (error) {
      setFeedback(error.message || "Failed to create journal entry.");
    }
  }, [refreshThreads, onOpenSection]);

  const handleMarkReviewed = useCallback(async (thread) => {
    if (!thread?.id) return;
    const outcome = {
      result: reviewDraft.result || "reviewed",
      pnl: reviewDraft.pnl === "" ? null : Number(reviewDraft.pnl),
      lesson: reviewDraft.lesson || null,
      mistakeTag: reviewDraft.mistakeTag || null
    };
    try {
      const res = await zeninFetch(`/decision-threads/${thread.id}/mark-reviewed`, {
        method: "POST",
        body: JSON.stringify(outcome)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to mark reviewed");
      setReviewDraft({ result: "reviewed", pnl: "", lesson: "", mistakeTag: "" });
      await refreshThreads();
    } catch (error) {
      setFeedback(error.message || "Failed to mark reviewed.");
    }
  }, [reviewDraft, refreshThreads]);

  const visibleThreads = useMemo(() => {
    if (!boardFilter || boardFilter === "all") return threads;
    return threads.filter((t) => (t.sourceType || "manual") === boardFilter);
  }, [threads, boardFilter]);

  const threadsByStatus = useMemo(() => {
    const map = {};
    for (const col of STATUS_COLUMNS) map[col.key] = [];
    for (const t of visibleThreads) {
      const bucket = map[t.status] || (map[t.status] ? map[t.status] : []);
      if (map[t.status]) {
        map[t.status].push(t);
      }
    }
    return map;
  }, [visibleThreads]);

  // Per-column P&L aggregate (sum of recorded outcomes on reviewed threads).
  const pnlByStatus = useMemo(() => {
    const acc = {};
    for (const t of threads) {
      const pnl = Number(t?.outcome?.pnl);
      if (Number.isFinite(pnl)) {
        acc[t.status] = (acc[t.status] || 0) + pnl;
      }
    }
    return acc;
  }, [threads]);

  const onDrop = useCallback(
    (statusKey) => {
      if (!dragSource) return;
      const [sourceStatus, threadId] = dragSource;
      if (sourceStatus === statusKey) {
        setDragSource(null);
        setDragOverColumn(null);
        return;
      }
      const thread = threads.find((t) => String(t.id) === String(threadId));
      if (thread) handleUpdateStatus(thread, statusKey);
      setDragSource(null);
      setDragOverColumn(null);
    },
    [dragSource, threads, handleUpdateStatus]
  );

  return (
    <div className="view-container decision-threads-module">
      <CompactPageHeader
        title="Decision Threads"
        subtitle="One loop: briefing → alert → research → journal → review. Every journaled decision gets a review due date."
        actions={
          <InlineControlGroup>
            <select value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} title="Filter board by source">
              <option value="all">All sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
              ))}
            </select>
            <button
              type="button"
              className={`settings-mini-btn ${showActivity ? "active" : ""}`}
              onClick={() => setShowActivity((value) => !value)}
            >
              {showActivity ? "Hide activity" : "Activity"}
            </button>
            <button
              type="button"
              className={`settings-mini-btn ${showOutcomes ? "active" : ""}`}
              onClick={() => setShowOutcomes((value) => !value)}
            >
              {showOutcomes ? "Hide outcomes" : "Outcomes"}
            </button>
            <button type="button" className="settings-primary-btn" disabled={creating || isGuestUser} onClick={handleCreate}>
              {creating ? "Creating…" : "New decision"}
            </button>
          </InlineControlGroup>
        }
      />

      {feedback ? (
        <div className="decision-error-state" role="status" aria-live="polite">
          <span className="status-icon">⚠</span>
          {feedback}
        </div>
      ) : null}

      {showOutcomes ? (
        <section className="decision-outcomes-panel">
          <div className="decision-outcomes-head">
            <strong>Reviewed outcomes</strong>
            <InlineControlGroup>
              <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
                <option value="all">All results</option>
                {REVIEW_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button type="button" className="settings-mini-btn" onClick={loadOutcomes} disabled={outcomesLoading}>
                {outcomesLoading ? "Loading…" : "Refresh"}
              </button>
            </InlineControlGroup>
          </div>
          <div className="decision-outcomes-summary">
            <div><strong>{outcomes.aggregated.total}</strong><span>Reviewed</span></div>
            <div><strong className={outcomes.aggregated.totalPnl >= 0 ? "positive" : "negative"}>{outcomes.aggregated.totalPnl >= 0 ? "+" : ""}${outcomes.aggregated.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong><span>Total PnL</span></div>
            <div><strong className="positive">{outcomes.aggregated.winCount}</strong><span>Wins</span></div>
            <div><strong className="negative">{outcomes.aggregated.lossCount}</strong><span>Losses</span></div>
          </div>
          {outcomes.items.length ? (
            <ul className="decision-outcomes-list">
              {outcomes.items.map((thread) => (
                <li key={thread.id} className="decision-outcome-row">
                  <div>
                    <strong>{thread.title}</strong>
                    <span>{thread.symbol || "No symbol"} · {thread.outcome?.result || "reviewed"}</span>
                  </div>
                  {thread.outcome?.pnl != null ? (
                    <span className={`decision-outcome-pnl ${Number(thread.outcome.pnl) >= 0 ? "positive" : "negative"}`}>
                      {Number(thread.outcome.pnl) >= 0 ? "+" : "-"}${Math.abs(Number(thread.outcome.pnl)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="decision-outcomes-empty">No reviewed outcomes yet. Mark decisions as reviewed to build this history.</p>
          )}
        </section>
      ) : null}

      {showActivity ? (
        <section className="decision-outcomes-panel">
          <div className="decision-outcomes-head">
            <strong>Recent activity</strong>
            <button type="button" className="settings-mini-btn" onClick={loadActivity} disabled={activityLoading}>
              {activityLoading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {activity.length ? (
            <ul className="decision-outcomes-list">
              {activity.map((item) => (
                <li key={item.id || `${item.eventType}-${item.createdAt}`} className="decision-outcome-row">
                  <div>
                    <strong>{(item.eventType || "event").replace(/_/g, " ")}</strong>
                    <span>{item.entityType || ""}{item.entityId ? ` · ${item.entityId}` : ""} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ""}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="decision-outcomes-empty">No recent workspace activity.</p>
          )}
        </section>
      ) : null}

      <div className="decision-thread-create-row">
        <input
          type="text"
          className="decision-thread-input"
          placeholder="Decision title (e.g. Long BTC on ETF inflow strength)"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <input
          type="text"
          className="decision-thread-input decision-thread-input-symbol"
          placeholder="Symbol"
          value={draft.symbol}
          onChange={(e) => setDraft((d) => ({ ...d, symbol: e.target.value }))}
        />
        <select
          className="decision-thread-select"
          value={draft.priority}
          onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <select
          className="decision-thread-select"
          value={draft.sourceType}
          onChange={(e) => setDraft((d) => ({ ...d, sourceType: e.target.value }))}
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>{SOURCE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {threadsLoading ? (
        <div className="decision-threads-board is-loading">
          {STATUS_COLUMNS.slice(0, 4).map((col) => (
            <div key={col.key} className="decision-threads-column">
              <header className="decision-threads-column-head">
                <span>{col.label}</span>
                <span className="decision-threads-column-count">—</span>
              </header>
              <div className="decision-threads-column-body">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="decision-thread-card decision-thread-card-skeleton">
                    <div className="decision-skeleton title" />
                    <div className="decision-skeleton meta" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="decision-guided-workspace">
          <section className="decision-guided-block decision-guided-cta">
            <DensePanelHeader title="Start a Decision" meta="New" />
            <div className="decision-guided-create-row">
              <input
                type="text"
                className="decision-thread-input"
                placeholder="Decision title (e.g. Long BTC on ETF inflow strength)"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
              <input
                type="text"
                className="decision-thread-input decision-thread-input-symbol"
                placeholder="Symbol"
                value={draft.symbol}
                onChange={(e) => setDraft((d) => ({ ...d, symbol: e.target.value }))}
              />
              <select
                className="decision-thread-select"
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <button type="button" className="settings-primary-btn" disabled={creating || isGuestUser} onClick={handleCreate}>
                {creating ? "Creating…" : "Create decision"}
              </button>
            </div>
          </section>

          <section className="decision-guided-block">
            <DensePanelHeader title="Decision Templates" meta="Templates" />
            <div className="decision-guided-templates">
              <button type="button" className="journal-btn secondary" onClick={() => setDraft((d) => ({ ...d, title: "Long thesis", priority: "medium" }))}>Long thesis</button>
              <button type="button" className="journal-btn secondary" onClick={() => setDraft((d) => ({ ...d, title: "Hedge / risk-off", priority: "high" }))}>Hedge / risk-off</button>
              <button type="button" className="journal-btn secondary" onClick={() => setDraft((d) => ({ ...d, title: "Earnings play", priority: "medium" }))}>Earnings play</button>
              <button type="button" className="journal-btn secondary" onClick={() => setDraft((d) => ({ ...d, title: "Macro allocation shift", priority: "high" }))}>Macro allocation shift</button>
            </div>
          </section>

          <section className="decision-guided-block">
            <DensePanelHeader title="Recent Decisions" meta="History" />
            <div className="decision-guided-placeholder">
              <p>Your reviewed and archived decisions appear here. The decision loop keeps every journaled decision tied to a review due date.</p>
            </div>
          </section>

          <section className="decision-guided-block">
            <DensePanelHeader title="Quick Actions" meta="Shortcuts" />
            <div className="decision-guided-actions">
              <button type="button" className="settings-mini-btn" onClick={() => onOpenSection?.("Briefing")}>Open Briefing</button>
              <button type="button" className="settings-mini-btn" onClick={() => onOpenSection?.("Research")}>Open Research</button>
              <button type="button" className="settings-mini-btn" onClick={() => onOpenSection?.("Journal")}>Open Journal</button>
            </div>
          </section>

          <section className="decision-guided-block">
            <DensePanelHeader title="Decision Statistics" meta="Loop" />
            <div className="decision-guided-stats">
              <div><strong>0</strong><span>Open</span></div>
              <div><strong>0</strong><span>Reviewed</span></div>
              <div><strong>0</strong><span>Win rate</span></div>
            </div>
          </section>
        </div>
      ) : (
        <div className="decision-threads-board">
          {STATUS_COLUMNS.map((col) => {
            const items = threadsByStatus[col.key] || [];
            const columnPnl = pnlByStatus[col.key] || 0;
            const overWip = items.length > WIP_LIMIT;
            const isOver = dragOverColumn === col.key;
            return (
              <div
                key={col.key}
                className={`decision-threads-column ${isOver ? "is-drag-over" : ""} ${overWip ? "is-over-wip" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverColumn !== col.key) setDragOverColumn(col.key);
                }}
                onDragLeave={() => {
                  if (dragOverColumn === col.key) setDragOverColumn(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(col.key);
                }}
              >
                <header className="decision-threads-column-head">
                  <span>{col.label}</span>
                  <span className="decision-threads-column-count" title={overWip ? `Over WIP limit of ${WIP_LIMIT}` : ""}>
                    {items.length}{overWip ? "!" : ""}
                  </span>
                </header>
                <span
                  className={`decision-threads-column-pnl ${columnPnl > 0 ? "positive" : columnPnl < 0 ? "negative" : ""}`}
                  title="Sum of recorded P&L on threads in this column"
                >
                  {columnPnl === 0 ? "—" : `${columnPnl > 0 ? "+" : "-"}$${Math.abs(columnPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </span>
                <div className="decision-threads-column-body">
                  {items.map((thread) => {
                    const due = formatDueDate(thread.dueAt);
                    const isSelected = String(selectedId) === String(thread.id);
                    return (
                      <button
                        type="button"
                        key={thread.id}
                        className={`decision-thread-card ${isSelected ? "decision-thread-card-selected" : ""} decision-thread-card-priority-${thread.priority || "medium"}`}
                        draggable
                        onDragStart={() => setDragSource([col.key, thread.id])}
                        onDragEnd={() => { setDragSource(null); setDragOverColumn(null); }}
                        onClick={() => setSelectedId(thread.id)}
                      >
                        <strong>{thread.title}</strong>
                        {thread.symbol ? <span className="decision-thread-card-symbol">{thread.symbol}</span> : null}
                        <span className="decision-thread-card-meta">
                          {thread.sourceType ? (SOURCE_LABELS[thread.sourceType] || thread.sourceType.replace(/_/g, " ")) : "manual"}
                          {due ? ` · ${due}` : ""}
                        </span>
                      </button>
                    );
                  })}
                  {items.length === 0 ? (
                    <span className="decision-threads-column-empty">—</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedThread ? (
        <aside className="decision-thread-detail">
          <header className="decision-thread-detail-head">
            <div>
              <strong>{selectedThread.title}</strong>
              <span className="decision-thread-detail-meta">
                {selectedThread.symbol || "No symbol"} · {selectedThread.status.replace(/_/g, " ")} · {selectedThread.priority} priority
              </span>
              {selectedThread.dueAt ? (
                <span className="decision-thread-detail-due">Review {formatDueDate(selectedThread.dueAt)}</span>
              ) : null}
            </div>
            <button type="button" className="decision-thread-detail-close" onClick={() => setSelectedId(null)}>×</button>
          </header>

          <div className="decision-thread-detail-body">
            <InlineControlGroup>
              <select
                value={selectedThread.status}
                onChange={(e) => handleUpdateStatus(selectedThread, e.target.value)}
              >
                {STATUS_COLUMNS.map((col) => (
                  <option key={col.key} value={col.key}>{col.label}</option>
                ))}
                <option value="archived">Archived</option>
              </select>
              <button type="button" className="settings-mini-btn" onClick={() => handleOpenResearch(selectedThread)}>Find research</button>
              {selectedThread.status !== "reviewed" ? (
                <button type="button" className="settings-mini-btn" onClick={() => handleCreateJournal(selectedThread)}>Create journal entry</button>
              ) : null}
            </InlineControlGroup>

            <div className="decision-thread-detail-links">
              {selectedThread.linkedAlertKey ? <span>Alert: {selectedThread.linkedAlertKey}</span> : null}
              {selectedThread.linkedResearchId ? <span>Research: {selectedThread.linkedResearchId}</span> : null}
              {selectedThread.linkedJournalId ? <span>Journal: {selectedThread.linkedJournalId}</span> : null}
              {selectedThread.linkedTradeExecutionId ? <span>Trade: {selectedThread.linkedTradeExecutionId}</span> : null}
            </div>

            {selectedThread.outcome && Object.keys(selectedThread.outcome).length ? (
              <div className="decision-thread-outcome">
                <h4>Outcome</h4>
                <p>Result: <strong>{selectedThread.outcome.result || "—"}</strong></p>
                {selectedThread.outcome.pnl != null ? <p>PnL: ${Number(selectedThread.outcome.pnl).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p> : null}
                {selectedThread.outcome.lesson ? <p>Lesson: {selectedThread.outcome.lesson}</p> : null}
                {selectedThread.outcome.mistakeTag ? <p>Mistake tag: {selectedThread.outcome.mistakeTag}</p> : null}
                {selectedThread.outcome.reviewedAt ? <p>Reviewed {formatRelativeTime(selectedThread.outcome.reviewedAt)}</p> : null}
              </div>
            ) : null}

            {selectedThread.status === "review_due" || selectedThread.status === "journaled" ? (
              <div className="decision-thread-review-form">
                <h4>Record review outcome</h4>
                <InlineControlGroup>
                  <select
                    value={reviewDraft.result}
                    onChange={(e) => setReviewDraft((d) => ({ ...d, result: e.target.value }))}
                  >
                    <option value="">Pick an outcome…</option>
                    {REVIEW_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input
                    type="number"
                    placeholder="PnL (optional)"
                    value={reviewDraft.pnl}
                    onChange={(e) => setReviewDraft((d) => ({ ...d, pnl: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Mistake tag (optional)"
                    value={reviewDraft.mistakeTag}
                    onChange={(e) => setReviewDraft((d) => ({ ...d, mistakeTag: e.target.value }))}
                  />
                </InlineControlGroup>
                <textarea
                  placeholder="Lesson learned (optional)"
                  value={reviewDraft.lesson}
                  onChange={(e) => setReviewDraft((d) => ({ ...d, lesson: e.target.value }))}
                  rows={3}
                />
                {!reviewDraft.result ? (
                  <p className="decision-review-hint">Pick an outcome to record this review.</p>
                ) : null}
                <button
                  type="button"
                  className="settings-primary-btn"
                  disabled={!reviewDraft.result}
                  onClick={() => handleMarkReviewed(selectedThread)}
                >
                  Mark reviewed
                </button>
              </div>
            ) : null}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

export default DecisionThreadModule;
