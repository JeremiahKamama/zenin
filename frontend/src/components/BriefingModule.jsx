import { useCallback, useEffect, useState } from "react";
import { CompactPageHeader, GuidedEmptyState, MetricStrip } from "./CompactWorkspaceUI";
import { zeninFetch } from "../utils/zeninFetch";

const REVIEW_DUE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  return new Date(iso).toLocaleDateString();
}

function formatDateLong(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function BriefingModule({
  briefing,
  decisionThreads = [],
  isGuestUser = false,
  spotPrices = {},
  loading = false,
  onGenerate,
  onMarkRead,
  onMarkCompleted,
  onCreateThread,
  onOpenSection,
  autoRefreshMs = 600000
}) {
  const [localBriefing, setLocalBriefing] = useState(briefing || null);
  const [generating, setGenerating] = useState(false);
  const [feedback, setFeedback] = useState(null);
  // Phase 5: collapsible sections, priority sort chip.
  const [collapsedSections, setCollapsedSections] = useState({});
  const [sortMode, setSortMode] = useState("default");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setLocalBriefing(briefing || null);
  }, [briefing]);

  // Auto-refresh the generated-at clock for relative-time rendering. Avoids
  // stale "2m ago" labels when the user leaves the briefing tab open.
  useEffect(() => {
    if (!autoRefreshMs) return undefined;
    const t = setInterval(() => setNow(Date.now()), autoRefreshMs);
    return () => clearInterval(t);
  }, [autoRefreshMs]);
  void now; // keep dependency wired even if downstream consumers use it

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setFeedback(null);
    try {
      const res = await zeninFetch("/daily-briefing/generate", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to generate briefing");
      setLocalBriefing(payload?.briefing || null);
      onGenerate?.(payload?.briefing || null);
    } catch (error) {
      setFeedback(error.message || "Failed to generate briefing.");
    } finally {
      setGenerating(false);
    }
  }, [onGenerate]);

  const handleMarkRead = useCallback(async () => {
    if (!localBriefing?.id) return;
    try {
      const res = await zeninFetch(`/daily-briefing/${localBriefing.id}/read`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to mark briefing read");
      setLocalBriefing(payload?.briefing || localBriefing);
      onMarkRead?.(payload?.briefing);
    } catch (error) {
      setFeedback(error.message || "Failed to mark briefing read.");
    }
  }, [localBriefing, onMarkRead]);

  const handleComplete = useCallback(async () => {
    if (!localBriefing?.id) return;
    try {
      const res = await zeninFetch(`/daily-briefing/${localBriefing.id}/complete`, { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to complete briefing");
      setLocalBriefing(payload?.briefing || localBriefing);
      onMarkCompleted?.(payload?.briefing);
    } catch (error) {
      setFeedback(error.message || "Failed to complete briefing.");
    }
  }, [localBriefing, onMarkCompleted]);

  const handleCreateThreadFromItem = useCallback(async (item, sourceType, defaults = {}) => {
    const title = defaults.title || item?.title || item?.alertKey || item?.symbol || "New decision";
    const payload = {
      title,
      symbol: item?.symbol || defaults.symbol || null,
      sourceType,
      sourceId: item?.alertKey || item?.id || null,
      priority: "medium",
      linkedAlertKey: sourceType === "alert" ? (item?.alertKey || item?.id || null) : null
    };
    try {
      const res = await zeninFetch("/decision-threads", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to create decision thread");
      onCreateThread?.(data?.thread);
      if (defaults.journalDecision) {
        onOpenSection?.("Journal", {
          symbol: item?.symbol || defaults.symbol || "",
          preThesis: title,
          decisionThreadId: data?.thread?.id || null
        });
      } else {
        onOpenSection?.("Decisions");
      }
    } catch (error) {
      setFeedback(error.message || "Failed to create decision thread.");
    }
  }, [onCreateThread, onOpenSection]);

  const handleOpenResearch = useCallback(() => {
    onOpenSection?.("Research");
  }, [onOpenSection]);

  const handleOpenJournal = useCallback(() => {
    onOpenSection?.("Journal");
  }, [onOpenSection]);

  const handleOpenSectionForItem = useCallback((sectionType, item) => {
    if (sectionType === "watchlist") {
      onOpenSection?.("Watchlist", { symbol: item?.symbol });
      return;
    }
    if (sectionType === "portfolio") {
      onOpenSection?.("Portfolio", { symbol: item?.symbol });
      return;
    }
    if (sectionType === "recent_executions") {
      onOpenSection?.("Journal", { symbol: item?.symbol, preThesis: item?.title || `Trade: ${item?.symbol || ""}` });
      return;
    }
    if (sectionType === "alerts") {
      onOpenSection?.("Decisions", { selectedThreadId: item?.id || null, symbol: item?.symbol });
      return;
    }
    if (sectionType === "decision_queue") {
      onOpenSection?.("Decisions", { selectedThreadId: item?.id || null });
      return;
    }
    onOpenSection?.("Decisions");
  }, [onOpenSection]);

  const enrichWatchlistItem = (item) => {
    if (!item?.symbol) return item;
    const spot = spotPrices[item.symbol];
    if (spot == null) return item;
    return { ...item, price: spot, priceChangePercent: item?.priceChangePercent };
  };

  const metrics = localBriefing?.metrics || {};
  const metricItems = [
    { label: "Portfolio value", value: metrics.portfolioValue != null ? `$${Number(metrics.portfolioValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—" },
    { label: "Holdings", value: metrics.holdingsCount != null ? Number(metrics.holdingsCount) : "—" },
    { label: "Open alerts", value: metrics.openAlertCount != null ? Number(metrics.openAlertCount) : "—" },
    { label: "Open decisions", value: metrics.openThreadCount != null ? Number(metrics.openThreadCount) : "—" },
    { label: "Review due", value: metrics.reviewDueCount != null ? Number(metrics.reviewDueCount) : "—" }
  ];

  const SkeletonSections = () => (
    <div className="briefing-content">
      <div className="briefing-skeleton summary" />
      <div className="briefing-skeleton tags" />
      <div className="briefing-sections">
        {[1, 2, 3, 4].map((i) => (
          <section key={i} className="briefing-section">
            <div className="briefing-section-head">
              <div className="briefing-skeleton section-title" />
              <div className="briefing-skeleton section-count" />
            </div>
            <div className="briefing-section-items">
              {[1, 2, 3].map((j) => (
                <div key={j} className="briefing-section-item">
                  <div className="briefing-skeleton item" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );

  return (
    <div className="view-container briefing-module">
      <CompactPageHeader
        title={`Today's Briefing${localBriefing?.briefingDate ? ` · ${formatDateLong(localBriefing.briefingDate)}` : ""}`}
        subtitle="Your daily decision loop: briefing → alert → research → journal → review."
        actions={
          <>
            <button
              type="button"
              className="settings-primary-btn"
              disabled={generating || loading || isGuestUser}
              onClick={handleGenerate}
            >
              {generating || loading ? "Generating…" : (localBriefing ? "Regenerate" : "Generate today's briefing")}
            </button>
            {localBriefing?.id && (
              <button
                type="button"
                className="settings-mini-btn"
                onClick={handleComplete}
              >
                Mark complete
              </button>
            )}
          </>
        }
      />

      {feedback ? (
        <div className="briefing-error-state" role="status" aria-live="polite">
          <span className="status-icon">⚠</span>
          {feedback}
        </div>
      ) : null}

      {generating || loading ? (
        <SkeletonSections />
      ) : !localBriefing ? (
        <GuidedEmptyState
          title="No briefing yet for today"
          body="Generate a daily briefing to see your portfolio snapshot, open alerts, watchlist, decision queue, and recent executions in one place."
          actionLabel={generating ? "Generating…" : "Generate briefing"}
          onAction={handleGenerate}
          disabled={generating || isGuestUser}
        />
      ) : (
        <div className="briefing-content">
          {localBriefing.summary ? (
            <p className="briefing-summary">{localBriefing.summary}</p>
          ) : null}
          <div className="briefing-tags">
            {localBriefing.marketRegime ? (
              <span className="briefing-tag briefing-tag-regime">{localBriefing.marketRegime.replace(/_/g, " ")}</span>
            ) : null}
            {localBriefing.riskLevel ? (
              <span className={`briefing-tag briefing-tag-risk briefing-tag-risk-${localBriefing.riskLevel}`}>{localBriefing.riskLevel}</span>
            ) : null}
            {localBriefing.generatedAt ? (
              <span className="briefing-tag briefing-tag-meta">Generated {formatRelativeTime(localBriefing.generatedAt)}</span>
            ) : null}
            {!localBriefing.readAt ? (
              <button type="button" className="briefing-mark-read-link" onClick={handleMarkRead}>Mark as read</button>
            ) : null}
          </div>

          <div className="briefing-sort-row">
          <span className="briefing-sort-label">Sort items by</span>
          <button
            type="button"
            className={`briefing-sort-chip ${sortMode === "default" ? "active" : ""}`}
            onClick={() => setSortMode("default")}
            aria-pressed={sortMode === "default"}
          >
            Default
          </button>
          <button
            type="button"
            className={`briefing-sort-chip ${sortMode === "priority" ? "active" : ""}`}
            onClick={() => setSortMode("priority")}
            aria-pressed={sortMode === "priority"}
            title="High → Medium → Low"
          >
            Priority
          </button>
        </div>
        <MetricStrip items={metricItems} />

            <div className="briefing-sections">
            {(localBriefing.sections || []).map((section, idx) => {
              const isCollapsed = !!collapsedSections[section?.type || idx];
              const rawItems = Array.isArray(section?.items) ? [...section.items] : [];
              const items = section?.type === "watchlist" ? rawItems.map(enrichWatchlistItem) : rawItems;
              if (sortMode === "priority") {
                const rank = { high: 0, medium: 1, low: 2 };
                items.sort((a, b) => (rank[String(a?.priority || "").toLowerCase()] ?? 3) - (rank[String(b?.priority || "").toLowerCase()] ?? 3));
              }
              return (
                <section
                  key={section?.type || idx}
                  className={`briefing-section ${isCollapsed ? "is-collapsed" : ""}`}
                >
                  <header className="briefing-section-head">
                    <button
                      type="button"
                      className="briefing-section-toggle"
                      onClick={() => setCollapsedSections((prev) => ({ ...prev, [section?.type || idx]: !prev[section?.type || idx] }))}
                      aria-expanded={!isCollapsed}
                      aria-controls={`briefing-section-${section?.type || idx}`}
                    >
                      <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                      <h3>{section?.title || "Section"}</h3>
                    </button>
                    {items.length ? <span className="briefing-section-count">{items.length}</span> : null}
                  </header>
                  {!isCollapsed ? (
                    <div id={`briefing-section-${section?.type || idx}`}>
                      {section?.insight ? <p className="briefing-section-insight">{section.insight}</p> : null}
                      {items.length ? (
                        <ul className="briefing-section-items">
                          {items.map((item, i) => (
                            <li key={item?.id || item?.alertKey || item?.symbol || i} className="briefing-section-item">
                              <button
                                type="button"
                                className="briefing-section-item-copy"
                                onClick={() => handleOpenSectionForItem(section?.type, item)}
                                title="Open related workspace view"
                              >
                                <strong>{item?.symbol || item?.alertKey || item?.title || "Item"}</strong>
                                {item?.name ? <span>{item.name}</span> : null}
                                {section?.type === "watchlist" && item?.price != null ? <span>${Number(item.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : null}
                                {item?.side ? <span>{item.side}{item?.quantity ? ` · ${item.quantity}` : ""}{item?.price ? ` @ $${item.price}` : ""}</span> : null}
                                {item?.status ? <span className="briefing-item-status">{item.status.replace(/_/g, " ")}</span> : null}
                                {item?.priority ? <span className={`briefing-item-priority briefing-item-priority-${item.priority}`}>{item.priority}</span> : null}
                              </button>
                              <div className="briefing-section-item-actions">
                                {section?.type === "alerts" ? (
                                  <>
                                    <button type="button" className="settings-mini-btn" onClick={() => handleCreateThreadFromItem(item, "alert")}>Turn into research</button>
                                    <button type="button" className="settings-mini-btn" onClick={() => handleCreateThreadFromItem(item, "alert", { title: `Journal: ${item?.alertKey || "alert"}`, journalDecision: true, symbol: item?.symbol })}>Journal decision</button>
                                  </>
                                ) : null}
                                {section?.type === "decision_queue" ? (
                                  <>
                                    <button type="button" className="settings-mini-btn" onClick={handleOpenResearch}>Open research</button>
                                    <button type="button" className="settings-mini-btn" onClick={() => onOpenSection?.("Journal", { symbol: item?.symbol, preThesis: item?.title, decisionThreadId: item?.id })}>Open journal</button>
                                  </>
                                ) : null}
                                {section?.type === "watchlist" && item?.symbol ? (
                                  <button type="button" className="settings-mini-btn" onClick={() => handleCreateThreadFromItem(item, "manual", { title: `Research: ${item.symbol}`, symbol: item.symbol })}>Promote to decision</button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="briefing-section-empty">Nothing to surface here right now.</p>
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default BriefingModule;
