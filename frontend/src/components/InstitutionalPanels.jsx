import { useEffect, useMemo, useState } from "react";
import { DensePanelHeader, GuidedEmptyState, InlineControlGroup } from "./CompactWorkspaceUI";
import { hasWorkspaceSession, loadWorkspaceCollection, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";

function readLocalJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // no-op
  }
}

function formatSavedAt(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "Saved recently";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value, currency = "USD") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(amount) >= 1000 ? 0 : 2
  }).format(amount);
}

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function downloadTextFile(text, filename, type = "text/plain;charset=utf-8") {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function inferAssetBucket(item) {
  const type = String(item?.type || item?.marketType || item?.category || "").toLowerCase();
  if (type.includes("option")) return "Options";
  if (type.includes("crypto") || type.includes("stablecoin") || type.includes("spot")) return "Crypto";
  if (type.includes("commodity")) return "Commodities";
  if (type.includes("bond")) return "Fixed Income";
  return "Equities";
}

function compactPercent(value, digits = 1) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function signedMoney(value, currency = "USD") {
  const amount = Number(value || 0);
  return `${amount >= 0 ? "+" : "-"}${formatMoney(Math.abs(amount), currency)}`;
}

function stripText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function SharedWatchlistWorkspacePanel({
  activeCategory = "stocks",
  activeTheme = "All",
  assets = [],
  title = "Shared Desk Watchlists"
}) {
  const defaultCommentTags = ["Catalyst", "Risk", "Sizing", "Follow-up", "Earnings"];
  const [sharedViews, setSharedViews] = useState(() => readLocalJson("zenin_workspace_shared_watchlists", []));
  const [deskComments, setDeskComments] = useState(() => readLocalJson("zenin_workspace_watchlist_comments", []));
  const [reportHighlights, setReportHighlights] = useState(() => readLocalJson("zenin_workspace_report_highlights", []));
  const [commentSymbol, setCommentSymbol] = useState(() => normalizeSymbol(assets[0]?.symbol));
  const [commentText, setCommentText] = useState("");
  const [commentTag, setCommentTag] = useState("Catalyst");
  const [customCommentTag, setCustomCommentTag] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const [viewsRes, commentsRes, highlightsRes] = await Promise.all([
          loadWorkspaceCollection("workspace:watchlists:shared", sharedViews),
          loadWorkspaceCollection("workspace:watchlists:comments", deskComments),
          loadWorkspaceCollection("workspace:report_highlights", reportHighlights)
        ]);
        if (cancelled) return;
        setSharedViews(Array.isArray(viewsRes?.items) ? viewsRes.items : []);
        setDeskComments(Array.isArray(commentsRes?.items) ? commentsRes.items : []);
        setReportHighlights(Array.isArray(highlightsRes?.items) ? highlightsRes.items : []);
      } catch {
        // local fallback already loaded
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!commentSymbol && assets[0]?.symbol) setCommentSymbol(normalizeSymbol(assets[0].symbol));
  }, [assets, commentSymbol]);

  const visibleAssets = Array.isArray(assets) ? assets.slice(0, 8) : [];
  const availableCommentTags = useMemo(() => {
    const customTags = deskComments
      .map((item) => stripText(item?.tag))
      .filter(Boolean);
    return [...new Set([...defaultCommentTags, ...customTags])];
  }, [deskComments]);

  const saveSharedView = async () => {
    const record = {
      id: `shared-view-${Date.now()}`,
      name: `${String(activeCategory).toUpperCase()} · ${activeTheme || "All"}`,
      category: activeCategory,
      theme: activeTheme,
      symbols: visibleAssets.slice(0, 6).map((item) => normalizeSymbol(item?.symbol)).filter(Boolean),
      createdAt: new Date().toISOString(),
      visibility: hasWorkspaceSession() ? "Workspace" : "Local"
    };
    const next = [record, ...sharedViews].slice(0, 20);
    setSharedViews(next);
    writeLocalJson("zenin_workspace_shared_watchlists", next);
    try {
      await saveWorkspaceCollection("workspace:watchlists:shared", next, 20);
      setNotice("Shared watchlist snapshot saved.");
    } catch {
      setNotice("Shared snapshot saved locally.");
    }
  };

  const addComment = async () => {
    const resolvedTag = commentTag === "__custom__" ? stripText(customCommentTag) : stripText(commentTag);
    if (!commentSymbol || !commentText.trim()) {
      setNotice("Choose a symbol and enter a note first.");
      return;
    }
    if (!resolvedTag) {
      setNotice("Add a tag before saving the desk note.");
      return;
    }
    const record = {
      id: `desk-comment-${Date.now()}`,
      symbol: commentSymbol,
      tag: resolvedTag,
      text: commentText.trim(),
      createdAt: new Date().toISOString(),
      visibility: hasWorkspaceSession() ? "Workspace" : "Local"
    };
    const next = [record, ...deskComments].slice(0, 40);
    setDeskComments(next);
    setCommentText("");
    if (commentTag === "__custom__") {
      setCommentTag(resolvedTag);
      setCustomCommentTag("");
    }
    writeLocalJson("zenin_workspace_watchlist_comments", next);
    try {
      await saveWorkspaceCollection("workspace:watchlists:comments", next, 40);
      setNotice(`Desk note saved for ${commentSymbol}.`);
    } catch {
      setNotice(`Desk note saved locally for ${commentSymbol}.`);
    }
  };

  const promoteCommentToReport = async (item) => {
    if (!item?.symbol || !item?.text) {
      setNotice("Choose a saved desk note before promoting it.");
      return;
    }
    const record = {
      id: `report-highlight-${item.id || Date.now()}`,
      symbol: item.symbol,
      tag: item.tag || "Desk note",
      headline: `${item.symbol} · ${item.tag || "Desk note"}`,
      text: stripText(item.text),
      createdAt: new Date().toISOString(),
      source: "watchlist_comment",
      visibility: hasWorkspaceSession() ? "Workspace" : "Local"
    };
    const deduped = [record, ...reportHighlights.filter((highlight) => stripText(highlight.text) !== stripText(record.text))].slice(0, 20);
    setReportHighlights(deduped);
    writeLocalJson("zenin_workspace_report_highlights", deduped);
    try {
      await saveWorkspaceCollection("workspace:report_highlights", deduped, 20);
      setNotice(`${item.symbol} promoted into the report queue.`);
    } catch {
      setNotice(`${item.symbol} saved to the local report queue.`);
    }
  };

  return (
    <section className="watchlist-panel glass institutional-panel">
      <DensePanelHeader
        title={title}
        subtitle="Save desk views, capture why the list changed, and promote the notes worth surfacing in reports."
        actions={
          <InlineControlGroup>
            <button type="button" className="analytics-btn" onClick={saveSharedView}>Save shared view</button>
          </InlineControlGroup>
        }
      />
      <div className="institutional-grid three-up">
        <div className="institutional-surface">
          <div className="institutional-kicker">Shared snapshots</div>
          <div className="institutional-list">
            {sharedViews.length ? sharedViews.slice(0, 5).map((view) => (
              <div key={view.id} className="institutional-list-row">
                <div>
                  <strong>{view.name}</strong>
                  <span>{(view.symbols || []).join(" · ") || "No symbols captured"}</span>
                </div>
                <em>{formatSavedAt(view.createdAt)}</em>
              </div>
            )) : (
              <div className="institutional-empty">No shared watchlist snapshots yet.</div>
            )}
          </div>
        </div>
        <div className="institutional-surface">
          <div className="institutional-kicker">Desk comments</div>
          <div className="institutional-form-grid">
            <label>
              <span>Symbol</span>
              <select value={commentSymbol} onChange={(event) => setCommentSymbol(event.target.value)}>
                {visibleAssets.length ? visibleAssets.map((item) => (
                  <option key={item.symbol} value={normalizeSymbol(item.symbol)}>{normalizeSymbol(item.symbol)}</option>
                )) : <option value="">No assets</option>}
              </select>
            </label>
            <label>
              <span>Tag</span>
              <select value={commentTag} onChange={(event) => setCommentTag(event.target.value)}>
                {availableCommentTags.map((tag) => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
                <option value="__custom__">Custom tag</option>
              </select>
            </label>
          </div>
          {commentTag === "__custom__" ? (
            <label className="institutional-field">
              <span>Custom tag</span>
              <input
                type="text"
                value={customCommentTag}
                onChange={(event) => setCustomCommentTag(event.target.value)}
                placeholder="Add your own desk tag"
              />
            </label>
          ) : null}
          <label className="institutional-field">
            <span>Desk note</span>
            <textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Capture the why behind the watchlist change, catalyst, or risk note." rows={3} />
          </label>
          <div className="institutional-inline-actions">
            <button type="button" className="analytics-btn" onClick={addComment}>Add note</button>
          </div>
          <div className="institutional-list compact">
            {deskComments.slice(0, 4).map((item) => (
              <div key={item.id} className="institutional-list-row">
                <div>
                  <strong>{item.symbol} · {item.tag}</strong>
                  <span>{item.text}</span>
                </div>
                <div className="institutional-inline-actions">
                  <em>{formatSavedAt(item.createdAt)}</em>
                  <button type="button" className="analytics-btn subtle" onClick={() => { void promoteCommentToReport(item); }}>
                    Promote to report
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="institutional-surface">
          <div className="institutional-kicker">Decision queue</div>
          <div className="institutional-list compact">
            {reportHighlights.length ? reportHighlights.slice(0, 4).map((item) => (
              <div key={item.id} className="institutional-list-row">
                <div>
                  <strong>{item.headline || `${item.symbol} · ${item.tag}`}</strong>
                  <span>{item.text}</span>
                </div>
                <em>{formatSavedAt(item.createdAt)}</em>
              </div>
            )) : (
              <GuidedEmptyState
                eyebrow="Report queue"
                title="No report-ready decisions yet"
                description="Promote the desk notes that explain sizing changes, catalysts, or risk shifts so Portfolio reporting stays tied to actual decisions."
                steps={[
                  "Capture a desk note against the symbol you are debating.",
                  "Promote the note once it should appear in reports or handoffs.",
                ]}
                tone="subtle"
                className="guided-empty-state--compact"
              />
            )}
          </div>
        </div>
      </div>
      {notice ? <div className="institutional-notice">{notice}</div> : null}
    </section>
  );
}

export function PortfolioInstitutionalSuite({
  hasDeskFeatureAccess = false,
  onOpenPlans,
  ...props
}) {
  if (!hasDeskFeatureAccess) {
    return (
      <section className="desk-feature-lock institutional-desk-lock" role="status">
        <span>Desk feature</span>
        <h2>Institutional desk tools require Desk</h2>
        <p>
          Shared decisions, report templates, AI desk briefs, treasury monitoring, and portfolio command workflows are only available on a Desk workspace.
        </p>
        {onOpenPlans ? (
          <button type="button" className="settings-primary-btn" onClick={onOpenPlans}>
            View Plans
          </button>
        ) : null}
      </section>
    );
  }

  return <PortfolioInstitutionalSuiteUnlocked {...props} />;
}

function PortfolioInstitutionalSuiteUnlocked({
  portfolio = [],
  trades = [],
  activeOptionsTrades = [],
  benchmarkSymbol = "SPY",
  currency = "USD",
  balance = 0,
  onOpenConnections,
}) {
  const [savedReports, setSavedReports] = useState(() => readLocalJson("zenin_workspace_report_templates", []));
  const [savedBriefs, setSavedBriefs] = useState(() => readLocalJson("zenin_workspace_ai_briefs", []));
  const [reportHighlights, setReportHighlights] = useState(() => readLocalJson("zenin_workspace_report_highlights", []));
  const [researchContext, setResearchContext] = useState(() => readLocalJson("zenin_portfolio_research_context", { memo: "", annotations: "", catalysts: "" }));
  const [assistantPrompt, setAssistantPrompt] = useState("Explain today's portfolio movement");
  const [assistantOutput, setAssistantOutput] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const [reportsRes, briefsRes, highlightsRes, researchRes] = await Promise.all([
          loadWorkspaceCollection("workspace:reports:templates", savedReports),
          loadWorkspaceCollection("workspace:assistant:briefs", savedBriefs),
          loadWorkspaceCollection("workspace:report_highlights", reportHighlights),
          loadWorkspaceDoc("research:equities", researchContext),
        ]);
        if (cancelled) return;
        setSavedReports(Array.isArray(reportsRes?.items) ? reportsRes.items : []);
        setSavedBriefs(Array.isArray(briefsRes?.items) ? briefsRes.items : []);
        setReportHighlights(Array.isArray(highlightsRes?.items) ? highlightsRes.items : []);
        if (researchRes?.document) {
          const nextResearchContext = {
            memo: researchRes.document.memo || "",
            annotations: researchRes.document.annotations || "",
            catalysts: researchRes.document.catalysts || ""
          };
          setResearchContext(nextResearchContext);
          writeLocalJson("zenin_portfolio_research_context", nextResearchContext);
        }
      } catch {
        // local fallback
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const holdings = Array.isArray(portfolio) ? portfolio : [];
  const totalValue = holdings.reduce((sum, item) => sum + (Number(item?.price || 0) * Number(item?.quantity || 0)), 0);
  const totalOptionsPnL = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).reduce((sum, item) => sum + Number(item?.unrealizedPnL || item?.pnl || 0), 0);
  const totalEquity = totalValue + Number(balance || 0) + totalOptionsPnL;
  const topHoldings = [...holdings]
    .map((item) => ({
      ...item,
      value: Number(item?.price || 0) * Number(item?.quantity || 0),
      bucket: inferAssetBucket(item)
    }))
    .sort((a, b) => b.value - a.value);
  const hasLiveBook = topHoldings.length > 0 || trades.length > 0 || activeOptionsTrades.length > 0;
  const topPositionWeight = totalEquity > 0 ? ((topHoldings[0]?.value || 0) / totalEquity) * 100 : 0;
  const concentrationRisk = topPositionWeight >= 30 ? "High" : topPositionWeight >= 18 ? "Watch" : "Contained";
  const bucketExposure = topHoldings.reduce((acc, item) => {
    acc[item.bucket] = (acc[item.bucket] || 0) + item.value;
    return acc;
  }, {});
  const attributionRows = Object.entries(
    topHoldings.reduce((acc, item) => {
      const pnl = Number(item?.positionGain ?? item?.pnl ?? item?.profitLoss ?? 0);
      acc[item.bucket] = (acc[item.bucket] || 0) + pnl;
      return acc;
    }, {})
  )
    .map(([bucket, pnl]) => ({ bucket, pnl: Number(pnl || 0) }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  const correlationRows = topHoldings.slice(0, 4).map((item, index, rows) => {
    const peer = rows[(index + 1) % rows.length];
    const raw = item.bucket === peer?.bucket ? 0.79 : item.bucket === "Crypto" || peer?.bucket === "Crypto" ? 0.56 : 0.34;
    return {
      id: `${item.symbol}-${peer?.symbol || "desk"}`,
      pair: `${item.symbol}/${peer?.symbol || benchmarkSymbol}`,
      correlation: raw
    };
  });
  const scenarioRows = [
    { name: "Risk-off shock", move: "-12%", impact: totalEquity * -0.08, note: "Equities and crypto compress together." },
    { name: "Rates +50bps", move: "+50bps", impact: totalEquity * -0.03, note: "Duration and multiple pressure." },
    { name: `${benchmarkSymbol} catch-up`, move: "+6%", impact: totalEquity * 0.041, note: "Benchmark-led upside case." }
  ];
  const treasuryRows = [
    { label: "Cash / stable reserve", value: formatMoney(Number(balance || 0), currency), helper: "Funding runway" },
    { label: "Crypto treasury", value: formatMoney(bucketExposure.Crypto || 0, currency), helper: `${Object.keys(bucketExposure).includes("Crypto") ? "Spot + stablecoins" : "No crypto treasury yet"}` },
    { label: "Exchange + venue count", value: String(new Set(topHoldings.map((item) => item?.venue || item?.market || item?.broker || "Desk")).size), helper: "Operational spread" },
    { label: "Stable reserve ratio", value: totalEquity > 0 ? `${(((Number(balance || 0)) / totalEquity) * 100).toFixed(1)}%` : "0.0%", helper: "Balance / total equity" }
  ];
  const keyMoveRows = topHoldings
    .map((item) => {
      const pnl = Number(item?.positionGain ?? item?.pnl ?? item?.profitLoss ?? 0);
      const pct = Number(item?.priceChangePercent ?? 0);
      return {
        symbol: item.symbol,
        bucket: item.bucket,
        pnl,
        pct,
        note: pnl
          ? `${item.symbol} contributed ${signedMoney(pnl, currency)} to the marked book.`
          : Number.isFinite(pct)
            ? `${item.symbol} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% on the tape.`
            : "No marked move recorded yet."
      };
    })
    .sort((a, b) => Math.abs(b.pnl || b.pct) - Math.abs(a.pnl || a.pct))
    .slice(0, 5);
  const topRiskRows = [
    {
      label: "Concentration risk",
      value: `${topHoldings[0]?.symbol || "No lead"} · ${topPositionWeight.toFixed(1)}%`,
      helper: concentrationRisk === "High" ? "Reduce position size or hedge concentration." : concentrationRisk === "Watch" ? "Keep trim / hedge playbook ready." : "No immediate concentration breach."
    },
    {
      label: "Correlation cluster",
      value: correlationRows[0]?.pair || `${benchmarkSymbol} cluster`,
      helper: correlationRows[0] ? `${(correlationRows[0].correlation * 100).toFixed(0)}% co-move signal across the book.` : "Need more than one live holding to compute a cluster."
    },
    {
      label: "Liquidity / reserve",
      value: formatMoney(balance, currency),
      helper: totalEquity > 0 ? `${(((Number(balance || 0)) / totalEquity) * 100).toFixed(1)}% of total equity held as reserve.` : "No marked reserve yet."
    }
  ];
  const decisionHighlights = reportHighlights
    .map((item) => ({
      ...item,
      headline: item.headline || `${item.symbol} · ${item.tag || "Desk note"}`,
      text: stripText(item.text)
    }))
    .filter((item) => item.text)
    .slice(0, 5);
  const researchNotes = [researchContext.memo, researchContext.catalysts, researchContext.annotations]
    .map(stripText)
    .filter(Boolean)
    .slice(0, 3);

  useEffect(() => {
    if (!hasLiveBook || assistantOutput) return;
    setAssistantOutput(generateAssistantOutput(assistantPrompt));
  }, [assistantOutput, assistantPrompt, hasLiveBook]);

  const generateAssistantOutput = (prompt) => {
    const leader = topHoldings[0];
    if (prompt.includes("portfolio movement")) {
      return `${leader?.symbol || "Top holding"} is the largest driver of current equity, with ${compactPercent(topPositionWeight)} concentration versus total account equity. ${Object.keys(bucketExposure).join(", ") || "Portfolio"} buckets are setting the tape today.`;
    }
    if (prompt.includes("risk changes")) {
      return `Concentration risk is ${concentrationRisk.toLowerCase()} with the top position at ${topPositionWeight.toFixed(1)}%. The strongest correlation cluster is ${correlationRows[0]?.pair || `${benchmarkSymbol} cluster`} at ${(Number(correlationRows[0]?.correlation || 0) * 100).toFixed(0)}%.`;
    }
    if (prompt.includes("investor update")) {
      return `This month the desk remained anchored to ${benchmarkSymbol}, with ${topHoldings.length} tracked holdings, ${trades.length} trades, and a treasury reserve of ${formatMoney(balance, currency)}. Primary focus remains ${leader?.bucket || "multi-asset"} exposure and disciplined concentration management.`;
    }
    return `Relative to ${benchmarkSymbol}, the book is tilted toward ${leader?.bucket || "core holdings"} with ${topHoldings.length} positions and ${activeOptionsTrades.length} active options overlays.`;
  };

  const runAssistant = async (prompt) => {
    const text = generateAssistantOutput(prompt);
    setAssistantPrompt(prompt);
    setAssistantOutput(text);
    const record = {
      id: `brief-${Date.now()}`,
      prompt,
      output: text,
      createdAt: new Date().toISOString()
    };
    const next = [record, ...savedBriefs].slice(0, 20);
    setSavedBriefs(next);
    writeLocalJson("zenin_workspace_ai_briefs", next);
    try {
      await saveWorkspaceCollection("workspace:assistant:briefs", next, 20);
    } catch {
      // local fallback
    }
  };

  const saveReportTemplate = async () => {
    const record = {
      id: `report-${Date.now()}`,
      name: `Portfolio summary · ${benchmarkSymbol}`,
      benchmarkSymbol,
      reportType: "Portfolio summary",
      holdings: topHoldings.slice(0, 8).map((item) => item.symbol),
      createdAt: new Date().toISOString()
    };
    const next = [record, ...savedReports].slice(0, 12);
    setSavedReports(next);
    writeLocalJson("zenin_workspace_report_templates", next);
    try {
      await saveWorkspaceCollection("workspace:reports:templates", next, 12);
      setNotice("Report template saved.");
    } catch {
      setNotice("Report template saved locally.");
    }
  };

  const exportInvestorUpdate = () => {
    if (!hasLiveBook) {
      setNotice("Connect venues or add holdings before exporting a portfolio summary.");
      return;
    }
    const autoCommentary = assistantOutput || generateAssistantOutput("Generate a monthly investor update");
    const lines = [
      "# Zenin Portfolio Summary",
      "",
      `Generated: ${new Date().toLocaleString()}`,
      `Benchmark: ${benchmarkSymbol}`,
      `Coverage: ${topHoldings.length} holdings · ${trades.length} trades · ${activeOptionsTrades.length} options overlays`,
      "",
      "## Executive Summary",
      autoCommentary,
      "",
      "## Benchmark & Portfolio",
      `- Total equity: ${formatMoney(totalEquity, currency)}`,
      `- Treasury reserve: ${formatMoney(balance, currency)}`,
      `- Top holding: ${topHoldings[0]?.symbol || "None"} (${topPositionWeight.toFixed(1)}%)`,
      `- Concentration state: ${concentrationRisk}`,
      "",
      "## Attribution",
      ...(attributionRows.length
        ? attributionRows.slice(0, 4).map((row) => `- ${row.bucket}: ${signedMoney(row.pnl, currency)}`)
        : ["- Attribution will populate once holdings carry marked P&L."]),
      "",
      "## Top Risks",
      ...topRiskRows.map((row) => `- ${row.label}: ${row.value} — ${row.helper}`),
      "",
      "## Key Moves",
      ...(keyMoveRows.length
        ? keyMoveRows.map((row) => `- ${row.symbol} (${row.bucket}): ${row.note}`)
        : ["- Key movers will populate once live holdings are connected."]),
      "",
      "## Shared Desk Decisions",
      ...(decisionHighlights.length
        ? decisionHighlights.map((item) => `- ${item.headline}: ${item.text}`)
        : ["- No promoted watchlist decisions yet."]),
      "",
      "## Commentary",
      ...(researchNotes.length ? researchNotes.map((note) => `- ${note}`) : ["- No research commentary attached yet."]),
      "",
      "## Scenario Pressure",
      ...scenarioRows.map((row) => `- ${row.name}: ${row.move} | ${signedMoney(row.impact, currency)} | ${row.note}`),
      "",
      "## Top Holdings",
      ...topHoldings.slice(0, 8).map((item) => `- ${item.symbol} | ${item.bucket} | ${formatMoney(item.value, currency)}`),
    ];
    downloadTextFile(lines.join("\n"), `zenin-portfolio-summary-${new Date().toISOString().slice(0, 10)}.md`, "text/markdown;charset=utf-8");
    setNotice("Portfolio summary exported.");
  };

  return (
    <section className="institutional-grid portfolio-suite-grid">
      <div className="watchlist-panel glass institutional-panel">
        <DensePanelHeader title="Risk Command Center" subtitle="Correlation, scenario pressure, and concentration checks for the current book." />
        {!hasLiveBook ? (
          <GuidedEmptyState
            eyebrow="Portfolio workflow"
            title="No live portfolio book yet"
            description="Connect a venue or seed positions first so the risk layer can explain concentration, scenarios, and hedge posture."
            steps={[
              "Connect an exchange or add positions so Zenin can mark the book.",
              "Return here to review concentration, correlations, and scenario pressure.",
            ]}
            cta={onOpenConnections ? "Connect venues" : undefined}
            onAction={onOpenConnections}
          />
        ) : (
          <>
            <div className="institutional-grid two-up">
              <div className="institutional-surface">
                <div className="institutional-kicker">Concentration</div>
                <div className="institutional-metric-stack">
                  <div><span>Top position</span><strong>{topHoldings[0]?.symbol || "—"} · {topPositionWeight.toFixed(1)}%</strong></div>
                  <div><span>Risk state</span><strong className={concentrationRisk === "High" ? "negative" : concentrationRisk === "Watch" ? "warning" : "positive"}>{concentrationRisk}</strong></div>
                  <div><span>Active overlays</span><strong>{activeOptionsTrades.length} option structures</strong></div>
                </div>
              </div>
              <div className="institutional-surface">
                <div className="institutional-kicker">Correlation heatmap</div>
                <div className="institutional-list compact">
                  {correlationRows.map((row) => (
                    <div key={row.id} className="institutional-list-row">
                      <div>
                        <strong>{row.pair}</strong>
                        <span>Desk correlation cluster</span>
                      </div>
                      <em>{(row.correlation * 100).toFixed(0)}%</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="institutional-surface" style={{ marginTop: 12 }}>
              <div className="institutional-kicker">Scenario analysis</div>
              <div className="institutional-list compact">
                {scenarioRows.map((row) => (
                  <div key={row.name} className="institutional-list-row">
                    <div>
                      <strong>{row.name}</strong>
                      <span>{row.note}</span>
                    </div>
                    <em className={row.impact >= 0 ? "positive" : "negative"}>{formatMoney(row.impact, currency)}</em>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="watchlist-panel glass institutional-panel">
        <DensePanelHeader
          title="Report Center"
          subtitle="Generate a portfolio summary with benchmark context, attribution, top risks, key moves, and desk commentary."
          actions={
            <InlineControlGroup>
              <button type="button" className="analytics-btn" onClick={saveReportTemplate} disabled={!hasLiveBook}>Save template</button>
              <button type="button" className="analytics-btn primary" onClick={exportInvestorUpdate} disabled={!hasLiveBook}>Export summary</button>
            </InlineControlGroup>
          }
        />
        {!hasLiveBook ? (
          <GuidedEmptyState
            eyebrow="Reporting workflow"
            title="Portfolio reporting starts once the book is live"
            description="Zenin’s report export becomes useful when it can pull holdings, benchmark context, risks, and shared desk decisions into one summary."
            steps={[
              "Connect venues or add positions so the report has a real book.",
              "Promote watchlist notes into the report queue to capture team commentary.",
              "Export the summary once benchmark, risks, and decisions look right.",
            ]}
            cta={onOpenConnections ? "Connect venues" : undefined}
            onAction={onOpenConnections}
          />
        ) : (
          <div className="institutional-grid two-up">
            <div className="institutional-surface">
              <div className="institutional-kicker">Saved templates</div>
              <div className="institutional-list">
                {savedReports.length ? savedReports.slice(0, 4).map((item) => (
                  <div key={item.id} className="institutional-list-row">
                    <div>
                      <strong>{item.name}</strong>
                      <span>{(item.holdings || []).join(" · ")}</span>
                    </div>
                    <em>{formatSavedAt(item.createdAt)}</em>
                  </div>
                )) : <div className="institutional-empty">No institutional report templates yet.</div>}
              </div>
            </div>
            <div className="institutional-surface">
              <div className="institutional-kicker">Coverage pack</div>
              <div className="institutional-list compact">
                {[
                  ["Benchmark", benchmarkSymbol],
                  ["Trades in period", String(trades.length)],
                  ["Holdings covered", String(topHoldings.length)],
                  ["Treasury reserve", formatMoney(balance, currency)],
                  ["Desk decisions linked", String(decisionHighlights.length)]
                ].map(([label, value]) => (
                  <div key={label} className="institutional-list-row">
                    <div><strong>{label}</strong><span>Included in generated updates</span></div>
                    <em>{value}</em>
                  </div>
                ))}
              </div>
            </div>
            <div className="institutional-surface">
              <div className="institutional-kicker">Desk decisions in focus</div>
              <div className="institutional-list compact">
                {decisionHighlights.length ? decisionHighlights.map((item) => (
                  <div key={item.id} className="institutional-list-row">
                    <div>
                      <strong>{item.headline}</strong>
                      <span>{item.text}</span>
                    </div>
                    <em>{item.symbol}</em>
                  </div>
                )) : (
                  <div className="institutional-empty">Promoted watchlist notes will land here before export.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="watchlist-panel glass institutional-panel">
        <DensePanelHeader title="Crypto Treasury Monitor" subtitle="Runway, reserve mix, and venue concentration for crypto-native operating capital." />
        <div className="institutional-grid two-up">
          {treasuryRows.map((item) => (
            <div key={item.label} className="institutional-surface">
              <div className="institutional-kicker">{item.label}</div>
              <strong className="institutional-big-value">{item.value}</strong>
              <span className="institutional-helper">{item.helper}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="watchlist-panel glass institutional-panel">
        <DensePanelHeader title="AI Desk Assistant" subtitle="Operator prompts tuned for portfolio movement, risk, and investor communication." />
        <div className="institutional-inline-actions" style={{ marginBottom: 10 }}>
          {[
            "Explain today's portfolio movement",
            "Summarize this week's risk changes",
            "Generate a monthly investor update",
            `Compare my portfolio against ${benchmarkSymbol}`
          ].map((prompt) => (
            <button key={prompt} type="button" className={`analytics-btn ${assistantPrompt === prompt ? "primary" : ""}`.trim()} onClick={() => { void runAssistant(prompt); }}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="institutional-surface">
          <div className="institutional-kicker">Current brief</div>
          <p className="institutional-prose">{assistantOutput || "Run one of the desk prompts to generate a reusable portfolio brief."}</p>
        </div>
        <div className="institutional-list compact" style={{ marginTop: 12 }}>
          {savedBriefs.slice(0, 3).map((item) => (
            <div key={item.id} className="institutional-list-row">
              <div>
                <strong>{item.prompt}</strong>
                <span>{item.output}</span>
              </div>
              <em>{formatSavedAt(item.createdAt)}</em>
            </div>
          ))}
        </div>
      </div>
      {notice ? <div className="institutional-notice">{notice}</div> : null}
    </section>
  );
}

export function ResearchWorkspacePanel({ scope = "equities", title = "Research Workspace", signals = [] }) {
  const storageKey = `zenin_research_workspace_${scope}`;
  const [workspace, setWorkspace] = useState(() => readLocalJson(storageKey, {
    memo: "",
    bull: "",
    base: "",
    bear: "",
    catalysts: "",
    filings: "",
    earnings: "",
    valuation: "",
    annotations: ""
  }));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const result = await loadWorkspaceDoc(`research:${scope}`, workspace);
        if (!cancelled && result?.document) setWorkspace((prev) => ({ ...prev, ...result.document }));
      } catch {
        // local fallback
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const updateField = (key, value) => {
    const next = { ...workspace, [key]: value };
    setWorkspace(next);
    writeLocalJson(storageKey, next);
  };

  const saveResearch = async () => {
    try {
      await saveWorkspaceDoc(`research:${scope}`, workspace);
      setNotice("Research workspace synced.");
    } catch {
      setNotice("Research workspace saved locally.");
    }
  };

  return (
    <section className="watchlist-panel glass institutional-panel" style={{ marginTop: 16 }}>
      <DensePanelHeader
        title={title}
        subtitle="Bull/base/bear framing, valuation notes, filing follow-ups, and internal annotations."
        actions={<button type="button" className="analytics-btn" onClick={saveResearch}>Save research</button>}
      />
      <div className="institutional-grid two-up">
        <label className="institutional-field">
          <span>Investment memo</span>
          <textarea rows={4} value={workspace.memo} onChange={(event) => updateField("memo", event.target.value)} placeholder="Write the current thesis and what matters next." />
        </label>
        <label className="institutional-field">
          <span>Catalysts / comp set</span>
          <textarea rows={4} value={workspace.catalysts} onChange={(event) => updateField("catalysts", event.target.value)} placeholder="Catalysts, comps, or channel checks." />
        </label>
        <label className="institutional-field">
          <span>Bull case</span>
          <textarea rows={3} value={workspace.bull} onChange={(event) => updateField("bull", event.target.value)} />
        </label>
        <label className="institutional-field">
          <span>Base case</span>
          <textarea rows={3} value={workspace.base} onChange={(event) => updateField("base", event.target.value)} />
        </label>
        <label className="institutional-field">
          <span>Bear case</span>
          <textarea rows={3} value={workspace.bear} onChange={(event) => updateField("bear", event.target.value)} />
        </label>
        <label className="institutional-field">
          <span>Valuation assumptions</span>
          <textarea rows={3} value={workspace.valuation} onChange={(event) => updateField("valuation", event.target.value)} placeholder="Multiples, margins, growth, discount rate." />
        </label>
        <label className="institutional-field">
          <span>Filing summaries</span>
          <textarea rows={3} value={workspace.filings} onChange={(event) => updateField("filings", event.target.value)} placeholder="10-Q, annual report, or on-chain governance notes." />
        </label>
        <label className="institutional-field">
          <span>Earnings / call notes</span>
          <textarea rows={3} value={workspace.earnings} onChange={(event) => updateField("earnings", event.target.value)} placeholder="Call takeaways and management tone." />
        </label>
      </div>
      {signals.length ? (
        <div className="institutional-surface" style={{ marginTop: 12 }}>
          <div className="institutional-kicker">Current desk signals</div>
          <div className="institutional-list compact">
            {signals.slice(0, 4).map((item, index) => (
              <div key={`${item}-${index}`} className="institutional-list-row">
                <div className="institutional-signal-copy"><strong>Signal {index + 1}</strong><span>{item}</span></div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {notice ? <div className="institutional-notice">{notice}</div> : null}
    </section>
  );
}

export function TaxCompliancePanel({
  jurisdictions = [],
  ledgerRows = [],
  scenarioRows = [],
  currency = "USD",
  summary = null
}) {
  const [accountantMode, setAccountantMode] = useState(() => readLocalJson("zenin_tax_accountant_mode", false));
  const [auditTrail, setAuditTrail] = useState(() => readLocalJson("zenin_tax_audit_trail", []));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const result = await loadWorkspaceCollection("tax:audit_trail", auditTrail);
        if (!cancelled && Array.isArray(result?.items)) setAuditTrail(result.items);
      } catch {
        // local fallback
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const washSaleWarnings = useMemo(() => {
    const rows = Array.isArray(ledgerRows) ? ledgerRows : [];
    const warnings = [];
    rows.forEach((row, index) => {
      const symbol = normalizeSymbol(row.instrument || row.symbol);
      const saleDate = new Date(row.saleDate || row.updatedAt || 0).getTime();
      const gain = Number(row.shortTermGain || 0) + Number(row.longTermGain || 0) + Number(row.standardGain || 0);
      if (!symbol || !Number.isFinite(saleDate) || gain >= 0) return;
      const nearMatch = rows.find((candidate, candidateIndex) => {
        if (candidateIndex === index) return false;
        const candidateSymbol = normalizeSymbol(candidate.instrument || candidate.symbol);
        if (candidateSymbol !== symbol) return false;
        const candidateDate = new Date(candidate.acquisitionDate || candidate.saleDate || candidate.updatedAt || 0).getTime();
        return Number.isFinite(candidateDate) && Math.abs(candidateDate - saleDate) <= 30 * 24 * 60 * 60 * 1000;
      });
      if (nearMatch) warnings.push(`${symbol} shows a loss event within a 30-day reacquisition window.`);
    });
    return warnings;
  }, [ledgerRows]);

  const appendAuditEvent = async (eventType) => {
    const record = {
      id: `tax-audit-${Date.now()}`,
      eventType,
      jurisdictions: [...jurisdictions],
      scenarios: scenarioRows.length,
      estimatedTax: summary?.estimatedTax ?? null,
      createdAt: new Date().toISOString()
    };
    const next = [record, ...auditTrail].slice(0, 20);
    setAuditTrail(next);
    writeLocalJson("zenin_tax_audit_trail", next);
    try {
      await saveWorkspaceCollection("tax:audit_trail", next, 20);
      setNotice("Compliance audit trail updated.");
    } catch {
      setNotice("Audit trail saved locally.");
    }
  };

  return (
    <section className="watchlist-panel glass institutional-panel" style={{ marginTop: 16 }}>
      <DensePanelHeader
        title="Compliance Console"
        subtitle="Wash sale checks, accountant handoff, and audit evidence for institutional tax review."
        actions={
          <InlineControlGroup>
            <button
              type="button"
              className="analytics-btn"
              onClick={() => {
                const nextValue = !accountantMode;
                setAccountantMode(nextValue);
                writeLocalJson("zenin_tax_accountant_mode", nextValue);
                if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("zenin:tax-accountant-mode", {
                      detail: { enabled: nextValue },
                    })
                  );
                }
              }}
            >
              {accountantMode ? "Disable accountant mode" : "Enable accountant mode"}
            </button>
            <button type="button" className="analytics-btn" onClick={() => { void appendAuditEvent("scenario_reviewed"); }}>
              Log review
            </button>
          </InlineControlGroup>
        }
      />
      <div className="institutional-grid two-up">
        <div className="institutional-surface">
          <div className="institutional-kicker">Checks</div>
          <div className="institutional-list compact">
            <div className="institutional-list-row"><div><strong>Jurisdictions</strong><span>Base plus comparison regimes</span></div><em>{jurisdictions.length}</em></div>
            <div className="institutional-list-row"><div><strong>Scenario set</strong><span>Recorded optimization cases</span></div><em>{scenarioRows.length}</em></div>
            <div className="institutional-list-row"><div><strong>Accountant mode</strong><span>Review-friendly labels and export posture</span></div><em>{accountantMode ? "On" : "Off"}</em></div>
          </div>
        </div>
        <div className="institutional-surface">
          <div className="institutional-kicker">Wash sale / lot warnings</div>
          <div className="institutional-list compact">
            {washSaleWarnings.length ? washSaleWarnings.map((warning, index) => (
              <div key={`${warning}-${index}`} className="institutional-list-row">
                <div><strong>Review</strong><span>{warning}</span></div>
              </div>
            )) : <div className="institutional-empty">No wash-sale style overlaps detected from the current ledger rows.</div>}
          </div>
        </div>
      </div>
      <div className="institutional-surface" style={{ marginTop: 12 }}>
        <div className="institutional-kicker">Audit trail</div>
        <div className="institutional-list compact">
          {auditTrail.length ? auditTrail.slice(0, 5).map((item) => (
            <div key={item.id} className="institutional-list-row">
              <div>
                <strong>{(item.eventType || "tax_event").replace(/_/g, " ")}</strong>
                <span>{(item.jurisdictions || []).join(" · ") || "No jurisdictions"} · {item.scenarios} scenarios</span>
              </div>
              <em>{item.estimatedTax == null ? formatSavedAt(item.createdAt) : formatMoney(item.estimatedTax, currency)}</em>
            </div>
          )) : <div className="institutional-empty">No audit trail entries yet.</div>}
        </div>
      </div>
      {notice ? <div className="institutional-notice">{notice}</div> : null}
    </section>
  );
}

export function OptionsInstitutionalPanel({ chain = [], activeOptionsTrades = [], activeAsset = "BTC" }) {
  const normalizedChain = Array.isArray(chain) ? chain : [];
  const ivValues = normalizedChain.flatMap((row) => [Number(row?.call?.iv || 0), Number(row?.put?.iv || 0)]).filter((value) => Number.isFinite(value) && value > 0);
  const avgIv = ivValues.length ? ivValues.reduce((sum, value) => sum + value, 0) / ivValues.length : 0;
  const minIv = ivValues.length ? Math.min(...ivValues) : 0;
  const maxIv = ivValues.length ? Math.max(...ivValues) : 1;
  const ivRank = maxIv > minIv ? ((avgIv - minIv) / (maxIv - minIv)) * 100 : 0;
  const ivPercentile = Math.min(99, Math.max(1, Math.round((ivValues.filter((value) => value <= avgIv).length / Math.max(ivValues.length, 1)) * 100)));
  const skewRows = normalizedChain.slice(0, 6).map((row) => ({
    strike: row.strike,
    callIv: Number(row?.call?.iv || 0),
    putIv: Number(row?.put?.iv || 0)
  }));
  const hedgeSuggestion = avgIv >= 0.7
    ? `Vol is elevated in ${activeAsset}; prioritize defined-risk hedges and shorter premium windows.`
    : avgIv >= 0.45
      ? `Vol is balanced in ${activeAsset}; spreads and collars are favored over naked convexity.`
      : `Vol is compressed in ${activeAsset}; consider protection before the term structure steepens.`;

  return (
    <section className="watchlist-panel glass institutional-panel" style={{ marginTop: 16 }}>
      <DensePanelHeader title="Institutional Options Desk" subtitle="IV rank, percentile, surface checks, and hedge posture layered on top of the chain." />
      <div className="institutional-grid three-up">
        <div className="institutional-surface"><div className="institutional-kicker">IV rank</div><strong className="institutional-big-value">{ivRank.toFixed(1)}%</strong><span className="institutional-helper">Current level within observed chain range</span></div>
        <div className="institutional-surface"><div className="institutional-kicker">IV percentile</div><strong className="institutional-big-value">{ivPercentile}%</strong><span className="institutional-helper">Approximate percentile across visible strikes</span></div>
        <div className="institutional-surface"><div className="institutional-kicker">Overlay load</div><strong className="institutional-big-value">{activeOptionsTrades.length}</strong><span className="institutional-helper">Live options structures</span></div>
      </div>
      <div className="institutional-grid two-up" style={{ marginTop: 12 }}>
        <div className="institutional-surface">
          <div className="institutional-kicker">Surface snapshot</div>
          <div className="institutional-list compact">
            {skewRows.length ? skewRows.map((row) => (
              <div key={`skew-${row.strike}`} className="institutional-list-row">
                <div><strong>{Number(row.strike || 0).toLocaleString()}</strong><span>Call IV {compactPercent(row.callIv * 100, 1)} · Put IV {compactPercent(row.putIv * 100, 1)}</span></div>
              </div>
            )) : <div className="institutional-empty">No chain rows available for a surface snapshot.</div>}
          </div>
        </div>
        <div className="institutional-surface">
          <div className="institutional-kicker">Hedging suggestion</div>
          <p className="institutional-prose">{hedgeSuggestion}</p>
        </div>
      </div>
    </section>
  );
}

export function WorkspaceInstitutionalControlPanel({ activeWorkspace = null }) {
  const [integrationDoc, setIntegrationDoc] = useState(() => readLocalJson("zenin_workspace_integrations", {
    broker: "Interactive Brokers",
    delivery: "Webhook",
    slackChannel: "",
    sheetsMode: "Pending",
    apiAccess: false
  }));
  const [controlDoc, setControlDoc] = useState(() => readLocalJson("zenin_workspace_enterprise_controls", {
    approvalWorkflow: true,
    exportPermission: "admins",
    ssoStatus: "Planned",
    auditRetention: "12 months"
  }));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const [integrationsRes, controlsRes] = await Promise.all([
          loadWorkspaceDoc("workspace:integrations", integrationDoc),
          loadWorkspaceDoc("workspace:enterprise_controls", controlDoc)
        ]);
        if (cancelled) return;
        if (integrationsRes?.document) setIntegrationDoc((prev) => ({ ...prev, ...integrationsRes.document }));
        if (controlsRes?.document) setControlDoc((prev) => ({ ...prev, ...controlsRes.document }));
      } catch {
        // local fallback
      }
    };
    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveAll = async () => {
    writeLocalJson("zenin_workspace_integrations", integrationDoc);
    writeLocalJson("zenin_workspace_enterprise_controls", controlDoc);
    try {
      await Promise.all([
        saveWorkspaceDoc("workspace:integrations", integrationDoc),
        saveWorkspaceDoc("workspace:enterprise_controls", controlDoc)
      ]);
      setNotice("Integrations and enterprise controls synced.");
    } catch {
      setNotice("Workspace controls saved locally.");
    }
  };

  return (
    <div className="settings-panel">
      <button className="settings-panel-header" type="button">
        <span>Integrations & Enterprise Controls</span>
        <span>•</span>
      </button>
      <div className="settings-panel-body">
        <div className="institutional-grid two-up">
          <div className="institutional-surface">
            <div className="institutional-kicker">Integrations</div>
            <label className="settings-field">
              <span>Primary broker</span>
              <input value={integrationDoc.broker} onChange={(event) => setIntegrationDoc((prev) => ({ ...prev, broker: event.target.value }))} placeholder="Interactive Brokers" />
            </label>
            <label className="settings-field">
              <span>Delivery rail</span>
              <select value={integrationDoc.delivery} onChange={(event) => setIntegrationDoc((prev) => ({ ...prev, delivery: event.target.value }))}>
                <option value="Webhook">Webhook</option>
                <option value="Slack">Slack</option>
                <option value="Discord">Discord</option>
                <option value="Google Sheets">Google Sheets</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Sheets / channel target</span>
              <input value={integrationDoc.slackChannel} onChange={(event) => setIntegrationDoc((prev) => ({ ...prev, slackChannel: event.target.value }))} placeholder="#desk-ops or sheet destination" />
            </label>
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={Boolean(integrationDoc.apiAccess)} onChange={(event) => setIntegrationDoc((prev) => ({ ...prev, apiAccess: event.target.checked }))} />
              <span>Enable customer API access request</span>
            </label>
          </div>

          <div className="institutional-surface">
            <div className="institutional-kicker">Enterprise controls</div>
            <label className="settings-checkbox-row">
              <input type="checkbox" checked={Boolean(controlDoc.approvalWorkflow)} onChange={(event) => setControlDoc((prev) => ({ ...prev, approvalWorkflow: event.target.checked }))} />
              <span>Require approval workflow for report exports</span>
            </label>
            <label className="settings-field">
              <span>Export permission</span>
              <select value={controlDoc.exportPermission} onChange={(event) => setControlDoc((prev) => ({ ...prev, exportPermission: event.target.value }))}>
                <option value="admins">Admins only</option>
                <option value="analysts">Analysts + admins</option>
                <option value="all-members">All members</option>
              </select>
            </label>
            <label className="settings-field">
              <span>SSO / SAML</span>
              <select value={controlDoc.ssoStatus} onChange={(event) => setControlDoc((prev) => ({ ...prev, ssoStatus: event.target.value }))}>
                <option value="Planned">Planned</option>
                <option value="Pilot">Pilot</option>
                <option value="Enabled">Enabled</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Audit retention</span>
              <input value={controlDoc.auditRetention} onChange={(event) => setControlDoc((prev) => ({ ...prev, auditRetention: event.target.value }))} />
            </label>
          </div>
        </div>
        <div className="settings-inline-actions" style={{ marginTop: 12 }}>
          <button className="settings-primary-btn" onClick={() => { void saveAll(); }} disabled={!activeWorkspace}>Save controls</button>
        </div>
        {notice ? <p className="settings-status success">{notice}</p> : null}
      </div>
    </div>
  );
}
