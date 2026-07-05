import { useEffect, useMemo, useRef, useState } from "react";
import { DataTable } from "./data-table/DataTable";
import {
  CompactPageHeader,
  DensePanelHeader,
  GuidedEmptyState,
  InlineControlGroup,
  MetricStrip,
  RightRailDrawer
} from "./CompactWorkspaceUI";
import {
  hasWorkspaceSession,
  loadWorkspaceCollection,
  readLocalJson,
  saveWorkspaceCollection,
  writeLocalJson
} from "../utils/workspacePersistence";
import { zeninFetch, zeninFetchJson } from "../utils/zeninFetch";

const SOURCES_NAMESPACE = "research:knowledge:sources";
const DOCUMENTS_NAMESPACE = "research:knowledge:documents";
const THESES_NAMESPACE = "research:knowledge:theses";
const CATALYSTS_NAMESPACE = "research:knowledge:catalysts";
const TRIGGERS_NAMESPACE = "research:knowledge:triggers";
const DECISIONS_NAMESPACE = "research:knowledge:decisions";
const BRIEFS_NAMESPACE = "research:knowledge:briefs";

const SOURCES_STORAGE_KEY = "zenin_research_knowledge_sources";
const DOCUMENTS_STORAGE_KEY = "zenin_research_knowledge_documents";
const THESES_STORAGE_KEY = "zenin_research_knowledge_theses";
const CATALYSTS_STORAGE_KEY = "zenin_research_knowledge_catalysts";
const TRIGGERS_STORAGE_KEY = "zenin_research_knowledge_triggers";
const DECISIONS_STORAGE_KEY = "zenin_research_knowledge_decisions";
const BRIEFS_STORAGE_KEY = "zenin_research_knowledge_briefs";
const OBSIDIAN_LOCAL_CONFIG_KEY = "zenin_research_obsidian_local_config";
const ACTIVE_VIEW_STORAGE_KEY = "zenin_research_active_view";

const SOURCE_TYPES = [
  {
    type: "notion",
    label: "Notion",
    readiness: "coming_next",
    readinessLabel: "Coming next",
    description: "Track shared desk notes and page references now. OAuth sync is intentionally not live yet."
  },
  {
    type: "obsidian",
    label: "Obsidian",
    readiness: "import_only",
    readinessLabel: "Import only",
    description: "Import Markdown now or pull the active note through Local REST when the local plugin is running."
  },
  {
    type: "manual",
    label: "Manual",
    readiness: "connected",
    readinessLabel: "Connected",
    description: "Paste broker notes, channel checks, earnings reactions, and internal memos directly into Zenin."
  }
];

const RESEARCH_VIEW_GROUPS = [
  {
    id: "capture",
    label: "Intake",
    views: [
      { id: "inbox", label: "Inbox" },
      { id: "sources", label: "Sources" },
      { id: "templates", label: "Templates" }
    ]
  },
  {
    id: "review",
    label: "Review",
    views: [
      { id: "review-queue", label: "Queue" },
      { id: "contradictions", label: "Conflicts" },
      { id: "ownership", label: "Ownership" }
    ]
  },
  {
    id: "coverage",
    label: "Coverage",
    views: [
      { id: "tickers", label: "Tickers" },
      { id: "coverage-map", label: "Map" },
      { id: "library", label: "Library" }
    ]
  },
  {
    id: "conviction",
    label: "Conviction",
    views: [
      { id: "theses", label: "Theses" },
      { id: "catalysts", label: "Catalysts" },
      { id: "triggers", label: "Triggers" }
    ]
  },
  {
    id: "output",
    label: "Handoff",
    views: [
      { id: "briefs", label: "Briefs" },
      { id: "decisions", label: "Decisions" },
      { id: "timeline", label: "Timeline" }
    ]
  }
];

const DOC_STATUS_OPTIONS = ["unread", "reviewed", "linked", "archived"];
const THESIS_STAGE_OPTIONS = ["watching", "active thesis", "in portfolio", "invalidated", "archived"];
const CATALYST_TYPES = ["earnings", "macro", "product", "filing", "token", "custom"];
const CATALYST_STATUS_OPTIONS = ["upcoming", "watching", "complete"];
const DECISION_ACTIONS = ["watch", "increase", "add", "reduce", "pass", "exit", "invalidate"];
const TRIGGER_ACTIONS = ["watch", "increase", "reduce", "review"];
const TRIGGER_SCOPE_OPTIONS = ["asset", "portfolio"];
const ENTITY_RECORD_STATES = ["active", "resolved", "archived"];
const OWNER_OPTIONS = ["Desk", "PM", "Analyst", "Risk", "Ops"];
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"];
const COVERAGE_SCOPE_OPTIONS = ["single_name", "basket", "sector_theme", "macro"];
const BRIEF_APPROVAL_STATES = ["draft", "internal_review", "approved"];
const BRIEF_TEMPLATES = [
  { value: "desk-memo", label: "Desk Memo" },
  { value: "investor-update", label: "Investor Update" },
  { value: "pm-review", label: "PM Review" }
];
const TRIGGER_CONDITION_OPTIONS = [
  { value: "price_above", label: "Price above", thresholdLabel: "Target price", thresholdHint: "Trigger when the asset trades above this level." },
  { value: "price_below", label: "Price below", thresholdLabel: "Support / stop", thresholdHint: "Trigger when the asset trades below this level." },
  { value: "catalyst_within_days", label: "Catalyst within days", thresholdLabel: "Days until event", thresholdHint: "Trigger when the linked catalyst is this close." },
  { value: "position_weight_above", label: "Position weight above", thresholdLabel: "Weight %", thresholdHint: "Trigger when a position exceeds its target weight." }
];
const BRIEF_SECTION_ORDER = ["Thesis", "Catalysts", "Risks", "Position Context", "Recent Decisions", "Commentary"];
const NEGATIVE_RESEARCH_KEYWORDS = ["risk", "warn", "delay", "miss", "cuts", "cut", "guide down", "weak", "pressure", "downgrade", "headwind"];

const COMMON_SYMBOL_STOPWORDS = new Set([
  "A", "AI", "API", "CEO", "CFO", "USD", "US", "UK", "EU", "ETF", "GDP", "CPI", "PCE", "SEC", "FOMC", "EPS", "EBITDA",
  "QOQ", "YOY", "FY", "Q1", "Q2", "Q3", "Q4", "KPIS", "IR", "IPO", "DCF", "WACC", "EV", "PE"
]);

const TEMPLATE_LIBRARY = [
  {
    id: "tmpl-equity-thesis",
    label: "Equity Thesis",
    category: "thesis",
    description: "Catalyst-led long/short setup for single-name coverage.",
    seed: {
      title: "Symbol thesis",
      summary: "Variant perception, earnings setup, and factor context in one paragraph.",
      bullCase: "What the market is underpricing.",
      invalidation: "What breaks the setup."
    }
  },
  {
    id: "tmpl-crypto-thesis",
    label: "Crypto Treasury Thesis",
    category: "thesis",
    description: "Treasury, liquidity, runway, and venue concentration framing.",
    seed: {
      title: "Token treasury thesis",
      summary: "Runway, reserve quality, and token-specific reflexivity.",
      bullCase: "Reserve mix and catalyst path.",
      invalidation: "Liquidity or governance break."
    }
  },
  {
    id: "tmpl-factor-trigger",
    label: "Factor Trigger",
    category: "trigger",
    description: "Trigger for a price or weight threshold tied to the thesis.",
    seed: {
      actionType: "review",
      conditionType: "position_weight_above",
      thresholdValue: "8",
      rationale: "Weight drift should force a review before concentration gets too high."
    }
  },
  {
    id: "tmpl-earnings-catalyst",
    label: "Earnings Catalyst",
    category: "catalyst",
    description: "Date-driven catalyst template for earnings or key prints.",
    seed: {
      title: "Earnings / key print",
      type: "earnings",
      note: "What needs to be true for the thesis to improve after the event."
    }
  },
  {
    id: "tmpl-desk-memo",
    label: "Desk Memo",
    category: "brief",
    description: "Internal operator note with catalysts, risks, and action framing.",
    seed: {
      template: "desk-memo",
      title: "Desk memo"
    }
  }
];

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toSlugLabel(value) {
  return String(value || "")
    .replace(/_/g, "-")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const CONVICTION_LEVELS = ["low", "medium", "high"];
const CONVICTION_DOTS = 5;
function resolveConvictionIndex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const match = CONVICTION_LEVELS.findIndex((level) => level === normalized);
  if (match >= 0) return Math.min(CONVICTION_DOTS, Math.max(1, (match + 1) * 2 - 1));
  return 2;
}
function ConvictionDots({ value, label }) {
  const filled = resolveConvictionIndex(value);
  return (
    <span
      className="research-conviction"
      role="img"
      aria-label={`Conviction: ${label || value || "Medium"}${typeof filled === "number" ? ` (${filled} of ${CONVICTION_DOTS})` : ""}`}
      title={`Conviction: ${label || value || "Medium"}`}
    >
      {Array.from({ length: CONVICTION_DOTS }, (_, idx) => (
        <i key={idx} className={idx < filled ? "filled" : ""} aria-hidden="true" />
      ))}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return "Not synced";
  try {
    return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(value);
  }
}

function formatDateOnly(value) {
  if (!value) return "No date";
  try {
    return new Date(value).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return String(value);
  }
}

function formatCurrency(value) {
  const numeric = numberOrZero(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(numeric);
}

function formatPercent(value, digits = 1) {
  const numeric = numberOrZero(value);
  return `${numeric.toFixed(digits)}%`;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const ms = new Date(dateValue).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

function normalizeStatus(value, allowed, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return SOURCE_TYPES.some((source) => source.type === normalized) ? normalized : "manual";
}

function inferSourceLabel(type) {
  return SOURCE_TYPES.find((source) => source.type === type)?.label || "Manual";
}

function extractTickerLinks(text = "") {
  const matches = String(text || "").match(/\$?[A-Z][A-Z0-9.-]{0,7}\b/g) || [];
  const seen = new Set();
  return matches
    .map((match) => match.replace(/^\$/, "").replace(/\.$/, "").toUpperCase())
    .filter((symbol) => {
      if (symbol.length < 2 || symbol.length > 8) return false;
      if (COMMON_SYMBOL_STOPWORDS.has(symbol)) return false;
      if (/^\d/.test(symbol)) return false;
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    })
    .slice(0, 12);
}

function summarizeDocument(text = "") {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "No summary yet.";
  return cleaned.length > 180 ? `${cleaned.slice(0, 180).trim()}...` : cleaned;
}

function normalizeOwner(value) {
  const trimmed = String(value || "").trim();
  return trimmed || "Desk";
}

function normalizePriority(value) {
  return normalizeStatus(value, PRIORITY_OPTIONS, "medium");
}

function normalizeCoverageScope(value) {
  return normalizeStatus(value, COVERAGE_SCOPE_OPTIONS, "single_name");
}

function normalizeRecordState(value) {
  return normalizeStatus(value, ENTITY_RECORD_STATES, "active");
}

function buildInitialSources() {
  return [
    {
      id: "source-manual-default",
      type: "manual",
      name: "Zenin Research Inbox",
      status: "connected",
      readiness: "connected",
      syncMode: "manual",
      documentCount: 0,
      lastSyncedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      meta: { description: "Manual notes and imported Markdown land here before ticker linking." }
    }
  ];
}

function buildDocumentPayload({ title, body, sourceId, sourceType, sourceName, origin = "manual", url = "", status = "unread" }) {
  const normalizedBody = String(body || "").trim();
  const normalizedTitle = String(title || "").trim() || "Untitled research note";
  const symbols = extractTickerLinks(`${normalizedTitle}\n${normalizedBody}`);
  return {
    id: createId("doc"),
    title: normalizedTitle,
    body: normalizedBody,
    summary: summarizeDocument(normalizedBody),
    sourceId: sourceId || null,
    sourceType: normalizeSourceType(sourceType),
    sourceName: sourceName || inferSourceLabel(sourceType),
    origin,
    url: String(url || "").trim(),
    symbols,
    tags: [],
    status: normalizeStatus(status, DOC_STATUS_OPTIONS, "unread"),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeDocument(document = {}) {
  return {
    ...document,
    sourceType: normalizeSourceType(document.sourceType),
    sourceName: document.sourceName || inferSourceLabel(document.sourceType),
    summary: document.summary || summarizeDocument(document.body || ""),
    symbols: Array.isArray(document.symbols) ? document.symbols : extractTickerLinks(`${document.title || ""}\n${document.body || ""}`),
    status: normalizeStatus(document.status === "indexed" ? "unread" : document.status, DOC_STATUS_OPTIONS, "unread"),
    createdAt: document.createdAt || nowIso(),
    updatedAt: document.updatedAt || document.createdAt || nowIso(),
  };
}

function normalizeThesis(thesis = {}) {
  return {
    id: thesis.id || createId("thesis"),
    symbol: String(thesis.symbol || "").trim().toUpperCase(),
    title: String(thesis.title || thesis.symbol || "Untitled thesis").trim(),
    stage: normalizeStatus(thesis.stage, THESIS_STAGE_OPTIONS, "watching"),
    summary: String(thesis.summary || "").trim(),
    bullCase: String(thesis.bullCase || "").trim(),
    bearCase: String(thesis.bearCase || "").trim(),
    entrySignal: String(thesis.entrySignal || "").trim(),
    invalidation: String(thesis.invalidation || "").trim(),
    mustPlayOut: String(thesis.mustPlayOut || "").trim(),
    riskCondition: String(thesis.riskCondition || "").trim(),
    conviction: String(thesis.conviction || "Medium").trim(),
    coverageScope: normalizeCoverageScope(thesis.coverageScope),
    owner: normalizeOwner(thesis.owner),
    priority: normalizePriority(thesis.priority),
    dueDate: thesis.dueDate || "",
    recordState: normalizeRecordState(thesis.recordState),
    resolvedAt: thesis.resolvedAt || "",
    archivedAt: thesis.archivedAt || "",
    createdAt: thesis.createdAt || nowIso(),
    updatedAt: thesis.updatedAt || thesis.createdAt || nowIso(),
  };
}

function normalizeCatalyst(catalyst = {}) {
  return {
    id: catalyst.id || createId("catalyst"),
    symbol: String(catalyst.symbol || "").trim().toUpperCase(),
    title: String(catalyst.title || "Untitled catalyst").trim(),
    type: normalizeStatus(catalyst.type, CATALYST_TYPES, "custom"),
    eventDate: catalyst.eventDate || "",
    note: String(catalyst.note || "").trim(),
    status: normalizeStatus(catalyst.status, CATALYST_STATUS_OPTIONS, "upcoming"),
    coverageScope: normalizeCoverageScope(catalyst.coverageScope),
    owner: normalizeOwner(catalyst.owner),
    priority: normalizePriority(catalyst.priority),
    dueDate: catalyst.dueDate || catalyst.eventDate || "",
    recordState: normalizeRecordState(catalyst.recordState),
    resolvedAt: catalyst.resolvedAt || "",
    archivedAt: catalyst.archivedAt || "",
    createdAt: catalyst.createdAt || nowIso(),
    updatedAt: catalyst.updatedAt || catalyst.createdAt || nowIso(),
  };
}

function normalizeDecision(decision = {}) {
  return {
    id: decision.id || createId("decision"),
    symbol: String(decision.symbol || "").trim().toUpperCase(),
    action: normalizeStatus(decision.action, DECISION_ACTIONS, "watch"),
    conviction: String(decision.conviction || "Medium").trim(),
    rationale: String(decision.rationale || "").trim(),
    thesisId: decision.thesisId || "",
    coverageScope: normalizeCoverageScope(decision.coverageScope),
    owner: normalizeOwner(decision.owner),
    priority: normalizePriority(decision.priority),
    dueDate: decision.dueDate || "",
    recordState: normalizeRecordState(decision.recordState),
    resolvedAt: decision.resolvedAt || "",
    archivedAt: decision.archivedAt || "",
    createdAt: decision.createdAt || nowIso(),
    updatedAt: decision.updatedAt || decision.createdAt || nowIso(),
  };
}

function normalizeTrigger(trigger = {}) {
  const actionType = normalizeStatus(trigger.actionType, TRIGGER_ACTIONS, "review");
  const conditionType = normalizeStatus(
    trigger.conditionType,
    TRIGGER_CONDITION_OPTIONS.map((item) => item.value),
    "price_below"
  );
  return {
    id: trigger.id || createId("trigger"),
    title: String(trigger.title || `${String(trigger.symbol || "").trim().toUpperCase() || "Portfolio"} ${toSlugLabel(actionType)} trigger`).trim(),
    symbol: String(trigger.symbol || "").trim().toUpperCase(),
    scopeType: normalizeStatus(trigger.scopeType, TRIGGER_SCOPE_OPTIONS, "asset"),
    actionType,
    conditionType,
    thresholdValue: String(trigger.thresholdValue ?? "").trim(),
    linkedThesisId: String(trigger.linkedThesisId || "").trim(),
    linkedCatalystId: String(trigger.linkedCatalystId || "").trim(),
    rationale: String(trigger.rationale || "").trim(),
    cooldownHours: Math.max(1, numberOrZero(trigger.cooldownHours) || 24),
    status: normalizeStatus(trigger.status, ["active", "paused", "archived"], "active"),
    coverageScope: normalizeCoverageScope(trigger.coverageScope),
    owner: normalizeOwner(trigger.owner),
    priority: normalizePriority(trigger.priority),
    dueDate: trigger.dueDate || "",
    recordState: normalizeRecordState(trigger.recordState),
    resolvedAt: trigger.resolvedAt || "",
    archivedAt: trigger.archivedAt || "",
    lastTriggeredAt: trigger.lastTriggeredAt || "",
    lastEvaluatedAt: trigger.lastEvaluatedAt || "",
    createdAt: trigger.createdAt || nowIso(),
    updatedAt: trigger.updatedAt || trigger.createdAt || nowIso(),
  };
}

function normalizeBrief(brief = {}) {
  const templateValues = BRIEF_TEMPLATES.map((item) => item.value);
  return {
    id: brief.id || createId("brief"),
    title: String(brief.title || "Untitled brief").trim(),
    symbol: String(brief.symbol || "").trim().toUpperCase(),
    template: normalizeStatus(brief.template, templateValues, "desk-memo"),
    content: String(brief.content || "").trim(),
    sections: Array.isArray(brief.sections) ? brief.sections : [],
    coverageScope: normalizeCoverageScope(brief.coverageScope),
    owner: normalizeOwner(brief.owner),
    priority: normalizePriority(brief.priority),
    dueDate: brief.dueDate || "",
    approvalState: normalizeStatus(brief.approvalState, BRIEF_APPROVAL_STATES, "draft"),
    commentary: String(brief.commentary || "").trim(),
    recordState: normalizeRecordState(brief.recordState),
    resolvedAt: brief.resolvedAt || "",
    archivedAt: brief.archivedAt || "",
    createdAt: brief.createdAt || nowIso(),
    updatedAt: brief.updatedAt || brief.createdAt || nowIso(),
  };
}

function describeTriggerCondition(trigger = {}) {
  const threshold = trigger.thresholdValue;
  if (trigger.conditionType === "price_above") return `When price trades above ${threshold}`;
  if (trigger.conditionType === "price_below") return `When price trades below ${threshold}`;
  if (trigger.conditionType === "catalyst_within_days") return `When the linked catalyst is within ${threshold} day${Number(threshold) === 1 ? "" : "s"}`;
  if (trigger.conditionType === "position_weight_above") return `When position weight exceeds ${threshold}%`;
  return "Condition not configured";
}

function deriveSourceReadiness(source) {
  const typeMeta = SOURCE_TYPES.find((item) => item.type === source.type);
  if (!typeMeta) return { key: "tracked_only", label: "Tracked only" };
  if (source.type === "manual") return { key: "connected", label: "Connected" };
  if (source.type === "obsidian") {
    if (source.status === "connected" && /local_rest/i.test(String(source.syncMode || ""))) return { key: "connected", label: "Connected" };
    return { key: "import_only", label: "Import only" };
  }
  if (source.type === "notion") {
    if (source.status === "connected") return { key: "tracked_only", label: "Tracked only" };
    return { key: "coming_next", label: "Coming next" };
  }
  return { key: typeMeta.readiness, label: typeMeta.readinessLabel };
}

function getAssetSymbol(asset = {}) {
  return String(asset?.symbol || asset?.ticker || "").trim().toUpperCase();
}

function getPortfolioExposure(asset = {}) {
  const direct =
    asset?.marketValue ??
    asset?.market_value ??
    asset?.currentValue ??
    asset?.current_value ??
    asset?.usdValue ??
    asset?.value ??
    asset?.notional;
  if (Number.isFinite(Number(direct))) return Number(direct);
  const quantity = Number(asset?.quantity ?? asset?.qty ?? asset?.shares);
  const price = Number(asset?.price ?? asset?.currentPrice ?? asset?.mark ?? asset?.marketPrice);
  if (Number.isFinite(quantity) && Number.isFinite(price)) return quantity * price;
  return 0;
}

function getPortfolioWeight(asset = {}, total) {
  const explicit =
    asset?.allocation ??
    asset?.weight ??
    asset?.portfolioWeight ??
    asset?.portfolio_weight ??
    asset?.percentage;
  if (Number.isFinite(Number(explicit))) {
    const raw = Number(explicit);
    return raw > 1 ? raw : raw * 100;
  }
  const exposure = getPortfolioExposure(asset);
  if (total <= 0 || exposure <= 0) return 0;
  return (exposure / total) * 100;
}

function upsertEntity(list, nextItem) {
  const index = list.findIndex((item) => item.id === nextItem.id);
  if (index === -1) return [nextItem, ...list];
  const next = list.slice();
  next[index] = nextItem;
  return next;
}

function keywordMatchesNegative(text = "") {
  const normalized = String(text || "").toLowerCase();
  return NEGATIVE_RESEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function computeCoverageHealth(row) {
  let score = 20;
  if (row.activeThesis) score += 22;
  if (row.activeThesis && !row.thesisStale) score += 15;
  if (row.catalystDueSoon || row.upcomingCatalystCount > 0) score += 12;
  if (row.activeTriggerCount > 0) score += 10;
  if (row.decisionCount > 0) score += 8;
  if (row.briefCount > 0) score += 8;
  if (row.exposure > 0 && !row.unsupportedByThesis) score += 10;
  if (row.unsupportedByThesis) score -= 18;
  if (row.thesisStale) score -= 14;
  if (row.docCount === 0) score -= 10;
  const normalized = Math.max(0, Math.min(100, score));
  const label = normalized >= 75 ? "Strong" : normalized >= 55 ? "Developing" : normalized >= 35 ? "Thin" : "At Risk";
  return { score: normalized, label };
}

function describeDueState(dateValue) {
  if (!dateValue) return "No due date";
  const diff = daysUntil(dateValue);
  if (diff === null) return "No due date";
  if (diff < 0) return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} overdue`;
  if (diff === 0) return "Due today";
  return `Due in ${diff} day${diff === 1 ? "" : "s"}`;
}

function isOverdue(dateValue, recordState) {
  const diff = daysUntil(dateValue);
  return Boolean(dateValue && diff !== null && diff < 0 && recordState === "active");
}

function ResearchObjectControls({ onEdit, onDuplicate, onResolve, onArchive, state }) {
  return (
    <div className="research-action-row">
      <button type="button" className="research-link-btn" onClick={onEdit}>Edit</button>
      <button type="button" className="research-link-btn" onClick={onDuplicate}>Duplicate</button>
      {state !== "resolved" ? <button type="button" className="research-link-btn" onClick={onResolve}>Resolve</button> : null}
      {state !== "archived" ? <button type="button" className="research-link-btn" onClick={onArchive}>Archive</button> : null}
    </div>
  );
}

export function ResearchModule({ portfolio = [], watchlistAssets = [], onOpenWatchlist, onOpenPortfolio, onPromoteToDecisionThread }) {
  const fileInputRef = useRef(null);

  const [sources, setSources] = useState(() => readLocalJson(SOURCES_STORAGE_KEY, buildInitialSources()));
  const [documents, setDocuments] = useState(() => readLocalJson(DOCUMENTS_STORAGE_KEY, []));
  const [theses, setTheses] = useState(() => readLocalJson(THESES_STORAGE_KEY, []));
  const [catalysts, setCatalysts] = useState(() => readLocalJson(CATALYSTS_STORAGE_KEY, []));
  const [triggers, setTriggers] = useState(() => readLocalJson(TRIGGERS_STORAGE_KEY, []));
  const [decisions, setDecisions] = useState(() => readLocalJson(DECISIONS_STORAGE_KEY, []));
  const [briefs, setBriefs] = useState(() => readLocalJson(BRIEFS_STORAGE_KEY, []));

  const [activeView, setActiveView] = useState(() => readLocalJson(ACTIVE_VIEW_STORAGE_KEY, "inbox"));
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [selectedTicker, setSelectedTicker] = useState("");
  const [selectedBriefId, setSelectedBriefId] = useState(null);
  const [activeSourceType, setActiveSourceType] = useState("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncingObsidian, setIsSyncingObsidian] = useState(false);
  const [backendStatus, setBackendStatus] = useState("checking");
  const [editingEntity, setEditingEntity] = useState({ type: "", id: "" });
  const [ownerFilter, setOwnerFilter] = useState("Desk");
  const [ownershipMode, setOwnershipMode] = useState("mine");
  const [pendingPromotion, setPendingPromotion] = useState({ docId: "", draftType: "", scope: "single_name", targetSymbol: "" });

  const [draft, setDraft] = useState({ title: "", body: "", sourceId: "source-manual-default", status: "unread" });
  const [sourceDraft, setSourceDraft] = useState({ type: "notion", name: "", url: "" });
  const [thesisDraft, setThesisDraft] = useState({
    symbol: "",
    title: "",
    stage: "watching",
    summary: "",
    bullCase: "",
    invalidation: "",
    conviction: "Medium",
    mustPlayOut: "",
    riskCondition: "",
    coverageScope: "single_name",
    owner: "Desk",
    priority: "medium",
    dueDate: ""
  });
  const [catalystDraft, setCatalystDraft] = useState({
    symbol: "",
    title: "",
    type: "earnings",
    eventDate: "",
    note: "",
    status: "upcoming",
    coverageScope: "single_name",
    owner: "Desk",
    priority: "medium",
    dueDate: ""
  });
  const [triggerDraft, setTriggerDraft] = useState({
    title: "",
    symbol: "",
    scopeType: "asset",
    actionType: "review",
    conditionType: "price_below",
    thresholdValue: "",
    linkedThesisId: "",
    linkedCatalystId: "",
    rationale: "",
    cooldownHours: 24,
    status: "active",
    coverageScope: "single_name",
    owner: "Desk",
    priority: "medium",
    dueDate: ""
  });
  const [decisionDraft, setDecisionDraft] = useState({
    symbol: "",
    action: "watch",
    conviction: "Medium",
    rationale: "",
    thesisId: "",
    coverageScope: "single_name",
    owner: "Desk",
    priority: "medium",
    dueDate: ""
  });
  const [briefDraft, setBriefDraft] = useState({
    title: "",
    symbol: "",
    template: "desk-memo",
    coverageScope: "single_name",
    owner: "Desk",
    priority: "medium",
    dueDate: "",
    approvalState: "draft",
    commentary: ""
  });
  const [obsidianConfig, setObsidianConfig] = useState(() => readLocalJson(OBSIDIAN_LOCAL_CONFIG_KEY, {
    endpoint: "",
    token: ""
  }));

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const [
          sourceResult,
          documentResult,
          thesisResult,
          catalystResult,
          triggerResult,
          decisionResult,
          briefResult
        ] = await Promise.all([
          loadWorkspaceCollection(SOURCES_NAMESPACE, sources),
          loadWorkspaceCollection(DOCUMENTS_NAMESPACE, documents),
          loadWorkspaceCollection(THESES_NAMESPACE, theses),
          loadWorkspaceCollection(CATALYSTS_NAMESPACE, catalysts),
          loadWorkspaceCollection(TRIGGERS_NAMESPACE, triggers),
          loadWorkspaceCollection(DECISIONS_NAMESPACE, decisions),
          loadWorkspaceCollection(BRIEFS_NAMESPACE, briefs)
        ]);
        if (cancelled) return;

        const nextSources = Array.isArray(sourceResult.items) && sourceResult.items.length ? sourceResult.items : buildInitialSources();
        const nextDocuments = Array.isArray(documentResult.items) ? documentResult.items.map(normalizeDocument) : [];
        const nextTheses = Array.isArray(thesisResult.items) ? thesisResult.items.map(normalizeThesis) : [];
        const nextCatalysts = Array.isArray(catalystResult.items) ? catalystResult.items.map(normalizeCatalyst) : [];
        const nextTriggers = Array.isArray(triggerResult.items) ? triggerResult.items.map(normalizeTrigger) : [];
        const nextDecisions = Array.isArray(decisionResult.items) ? decisionResult.items.map(normalizeDecision) : [];
        const nextBriefs = Array.isArray(briefResult.items) ? briefResult.items.map(normalizeBrief) : [];

        setSources(nextSources);
        setDocuments(nextDocuments);
        setTheses(nextTheses);
        setCatalysts(nextCatalysts);
        setTriggers(nextTriggers);
        setDecisions(nextDecisions);
        setBriefs(nextBriefs);

        writeLocalJson(SOURCES_STORAGE_KEY, nextSources);
        writeLocalJson(DOCUMENTS_STORAGE_KEY, nextDocuments);
        writeLocalJson(THESES_STORAGE_KEY, nextTheses);
        writeLocalJson(CATALYSTS_STORAGE_KEY, nextCatalysts);
        writeLocalJson(TRIGGERS_STORAGE_KEY, nextTriggers);
        writeLocalJson(DECISIONS_STORAGE_KEY, nextDecisions);
        writeLocalJson(BRIEFS_STORAGE_KEY, nextBriefs);
      } catch (error) {
        if (!cancelled) setNotice(`Research workspace is using local storage: ${error?.message || "sync unavailable"}`);
      }
    }
    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { writeLocalJson(SOURCES_STORAGE_KEY, sources); }, [sources]);
  useEffect(() => { writeLocalJson(DOCUMENTS_STORAGE_KEY, documents); }, [documents]);
  useEffect(() => { writeLocalJson(THESES_STORAGE_KEY, theses); }, [theses]);
  useEffect(() => { writeLocalJson(CATALYSTS_STORAGE_KEY, catalysts); }, [catalysts]);
  useEffect(() => { writeLocalJson(TRIGGERS_STORAGE_KEY, triggers); }, [triggers]);
  useEffect(() => { writeLocalJson(DECISIONS_STORAGE_KEY, decisions); }, [decisions]);
  useEffect(() => { writeLocalJson(BRIEFS_STORAGE_KEY, briefs); }, [briefs]);
  useEffect(() => { writeLocalJson(OBSIDIAN_LOCAL_CONFIG_KEY, obsidianConfig); }, [obsidianConfig]);
  useEffect(() => { writeLocalJson(ACTIVE_VIEW_STORAGE_KEY, activeView); }, [activeView]);

  useEffect(() => {
    let cancelled = false;
    async function checkBackend() {
      try {
        await zeninFetchJson("/public/config");
        if (!cancelled) setBackendStatus("online");
      } catch {
        if (!cancelled) setBackendStatus("offline");
      }
    }
    checkBackend();
    return () => { cancelled = true; };
  }, []);

  const sourceById = useMemo(() => {
    const map = new Map();
    sources.forEach((source) => map.set(source.id, source));
    return map;
  }, [sources]);

  const normalizedDocuments = useMemo(() => documents.map(normalizeDocument), [documents]);
  const normalizedTheses = useMemo(() => theses.map(normalizeThesis), [theses]);
  const normalizedCatalysts = useMemo(() => catalysts.map(normalizeCatalyst), [catalysts]);
  const normalizedTriggers = useMemo(() => triggers.map(normalizeTrigger), [triggers]);
  const normalizedDecisions = useMemo(() => decisions.map(normalizeDecision), [decisions]);
  const normalizedBriefs = useMemo(() => briefs.map(normalizeBrief), [briefs]);

  const portfolioPositions = useMemo(() => {
    const map = new Map();
    (Array.isArray(portfolio) ? portfolio : []).forEach((asset) => {
      const symbol = getAssetSymbol(asset);
      if (!symbol) return;
      map.set(symbol, asset);
    });
    return map;
  }, [portfolio]);

  const watchlistSymbols = useMemo(() => {
    const set = new Set();
    (Array.isArray(watchlistAssets) ? watchlistAssets : []).forEach((asset) => {
      const symbol = getAssetSymbol(asset);
      if (symbol) set.add(symbol);
    });
    return set;
  }, [watchlistAssets]);

  const portfolioTotalValue = useMemo(() => {
    return Array.from(portfolioPositions.values()).reduce((sum, asset) => sum + getPortfolioExposure(asset), 0);
  }, [portfolioPositions]);

  const trackedSymbols = useMemo(() => {
    const seen = new Set();
    Array.from(portfolioPositions.keys()).forEach((symbol) => seen.add(symbol));
    Array.from(watchlistSymbols.values()).forEach((symbol) => seen.add(symbol));
    return [...seen];
  }, [portfolioPositions, watchlistSymbols]);

  const documentsWithLinks = useMemo(() => {
    return normalizedDocuments.map((doc) => {
      const linkedTrackedSymbols = (Array.isArray(doc.symbols) ? doc.symbols : []).filter((symbol) => trackedSymbols.includes(symbol));
      return { ...doc, linkedTrackedSymbols };
    });
  }, [normalizedDocuments, trackedSymbols]);

  const symbolOptions = useMemo(() => {
    const set = new Set(trackedSymbols);
    documentsWithLinks.forEach((doc) => (doc.symbols || []).forEach((symbol) => set.add(symbol)));
    normalizedTheses.forEach((item) => item.symbol && set.add(item.symbol));
    normalizedCatalysts.forEach((item) => item.symbol && set.add(item.symbol));
    normalizedTriggers.forEach((item) => item.symbol && set.add(item.symbol));
    normalizedDecisions.forEach((item) => item.symbol && set.add(item.symbol));
    normalizedBriefs.forEach((item) => item.symbol && set.add(item.symbol));
    return [...set].filter(Boolean).sort();
  }, [documentsWithLinks, trackedSymbols, normalizedTheses, normalizedCatalysts, normalizedTriggers, normalizedDecisions, normalizedBriefs]);

  const tickerRows = useMemo(() => {
    const aggregate = new Map();
    const ensure = (symbol) => {
      if (!symbol) return null;
      if (!aggregate.has(symbol)) {
        const position = portfolioPositions.get(symbol);
        const exposure = position ? getPortfolioExposure(position) : 0;
        const weight = position ? getPortfolioWeight(position, portfolioTotalValue) : 0;
        aggregate.set(symbol, {
          symbol,
          docCount: 0,
          unreadCount: 0,
          thesisCount: 0,
          activeThesisCount: 0,
          catalystCount: 0,
          upcomingCatalystCount: 0,
          triggerCount: 0,
          activeTriggerCount: 0,
          decisionCount: 0,
          briefCount: 0,
          tracked: trackedSymbols.includes(symbol),
          inWatchlist: watchlistSymbols.has(symbol),
          exposure,
          weight,
          summary: "",
          lastUpdatedAt: ""
        });
      }
      return aggregate.get(symbol);
    };

    symbolOptions.forEach((symbol) => ensure(symbol));

    documentsWithLinks.forEach((doc) => {
      (doc.symbols || []).forEach((symbol) => {
        const row = ensure(symbol);
        if (!row) return;
        row.docCount += 1;
        if (doc.status === "unread") row.unreadCount += 1;
        if (!row.summary) row.summary = doc.summary;
        if (!row.lastUpdatedAt || new Date(doc.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = doc.updatedAt;
      });
    });

    normalizedTheses.forEach((item) => {
      const row = ensure(item.symbol);
      if (!row) return;
      row.thesisCount += 1;
      if (item.recordState !== "archived" && item.stage !== "archived" && item.stage !== "invalidated") row.activeThesisCount += 1;
      if (!row.lastUpdatedAt || new Date(item.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = item.updatedAt;
    });

    normalizedCatalysts.forEach((item) => {
      const row = ensure(item.symbol);
      if (!row) return;
      row.catalystCount += 1;
      if (item.recordState !== "archived" && item.status === "upcoming") row.upcomingCatalystCount += 1;
      if (!row.lastUpdatedAt || new Date(item.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = item.updatedAt;
    });

    normalizedTriggers.forEach((item) => {
      const row = ensure(item.symbol);
      if (!row) return;
      row.triggerCount += 1;
      if (item.recordState !== "archived" && item.status === "active") row.activeTriggerCount += 1;
      if (!row.lastUpdatedAt || new Date(item.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = item.updatedAt;
    });

    normalizedDecisions.forEach((item) => {
      const row = ensure(item.symbol);
      if (!row) return;
      row.decisionCount += 1;
      if (!row.lastUpdatedAt || new Date(item.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = item.updatedAt;
    });

    normalizedBriefs.forEach((item) => {
      if (!item.symbol) return;
      const row = ensure(item.symbol);
      if (!row) return;
      row.briefCount += 1;
      if (!row.lastUpdatedAt || new Date(item.updatedAt || 0) > new Date(row.lastUpdatedAt || 0)) row.lastUpdatedAt = item.updatedAt;
    });

    return [...aggregate.values()]
      .map((row) => {
        const activeThesis = normalizedTheses.find((item) => item.symbol === row.symbol && item.recordState !== "archived" && item.stage !== "archived");
        const nextCatalyst = normalizedCatalysts
          .filter((item) => item.symbol === row.symbol && item.recordState !== "archived" && item.status === "upcoming")
          .sort((a, b) => new Date(a.eventDate || 0) - new Date(b.eventDate || 0))[0];
        const catalystDays = nextCatalyst ? daysUntil(nextCatalyst.eventDate) : null;
        const thesisAgeDays = activeThesis ? daysUntil(activeThesis.updatedAt) : null;
        return {
          ...row,
          unsupportedByThesis: (row.tracked || row.inWatchlist) && !activeThesis,
          nextCatalyst,
          catalystDueSoon: catalystDays !== null && catalystDays >= 0 && catalystDays <= 7,
          thesisStale: Boolean(activeThesis && Math.abs(thesisAgeDays || 0) > 30),
          activeThesis
        };
      })
      .sort((a, b) => {
        if (b.docCount !== a.docCount) return b.docCount - a.docCount;
        return a.symbol.localeCompare(b.symbol);
      });
  }, [
    documentsWithLinks,
    normalizedBriefs,
    normalizedCatalysts,
    normalizedDecisions,
    normalizedTheses,
    normalizedTriggers,
    portfolioPositions,
    portfolioTotalValue,
    symbolOptions,
    trackedSymbols,
    watchlistSymbols
  ]);

  const coverageRows = useMemo(() => {
    return tickerRows.map((row) => ({
      ...row,
      thesisState: row.activeThesis ? toSlugLabel(row.activeThesis.stage) : "No thesis",
      researchDepth: row.docCount + row.thesisCount + row.catalystCount + row.triggerCount + row.decisionCount + row.briefCount,
      coverageHealth: computeCoverageHealth(row)
    }));
  }, [tickerRows]);

  useEffect(() => {
    if (!selectedTicker && tickerRows.length) setSelectedTicker(tickerRows[0].symbol);
  }, [selectedTicker, tickerRows]);

  const selectedDoc = useMemo(() => documentsWithLinks.find((doc) => doc.id === selectedDocId) || null, [documentsWithLinks, selectedDocId]);
  const selectedBrief = useMemo(() => normalizedBriefs.find((brief) => brief.id === selectedBriefId) || null, [normalizedBriefs, selectedBriefId]);
  const selectedTickerRecord = useMemo(() => coverageRows.find((row) => row.symbol === selectedTicker) || null, [coverageRows, selectedTicker]);
  const selectedTickerDocs = useMemo(() => documentsWithLinks.filter((doc) => (doc.symbols || []).includes(selectedTicker)), [documentsWithLinks, selectedTicker]);
  const selectedTickerTheses = useMemo(() => normalizedTheses.filter((item) => item.symbol === selectedTicker), [normalizedTheses, selectedTicker]);
  const selectedTickerCatalysts = useMemo(() => normalizedCatalysts.filter((item) => item.symbol === selectedTicker), [normalizedCatalysts, selectedTicker]);
  const selectedTickerTriggers = useMemo(() => normalizedTriggers.filter((item) => item.symbol === selectedTicker || (!item.symbol && item.scopeType === "portfolio")), [normalizedTriggers, selectedTicker]);
  const selectedTickerDecisions = useMemo(() => normalizedDecisions.filter((item) => item.symbol === selectedTicker), [normalizedDecisions, selectedTicker]);
  const selectedTickerBriefs = useMemo(() => normalizedBriefs.filter((item) => item.symbol === selectedTicker), [normalizedBriefs, selectedTicker]);

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return documentsWithLinks
      .filter((doc) => activeSourceType === "all" || doc.sourceType === activeSourceType)
      .filter((doc) => {
        if (!normalizedQuery) return true;
        return [doc.title, doc.summary, doc.sourceName, doc.status, ...(doc.symbols || [])]
          .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  }, [activeSourceType, documentsWithLinks, query]);

  const inboxDocuments = useMemo(() => filteredDocuments.filter((doc) => doc.status !== "archived"), [filteredDocuments]);
  const archivedDocuments = useMemo(() => filteredDocuments.filter((doc) => doc.status === "archived"), [filteredDocuments]);
  const activeTheses = useMemo(() => normalizedTheses.filter((item) => item.recordState !== "archived" && item.stage !== "archived"), [normalizedTheses]);
  const activeTriggers = useMemo(() => normalizedTriggers.filter((item) => item.recordState !== "archived"), [normalizedTriggers]);
  const latestDecisions = useMemo(() => normalizedDecisions.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)), [normalizedDecisions]);
  const upcomingCatalysts = useMemo(() => {
    return normalizedCatalysts
      .filter((item) => item.recordState !== "archived" && item.status === "upcoming")
      .sort((a, b) => new Date(a.eventDate || 0) - new Date(b.eventDate || 0));
  }, [normalizedCatalysts]);

  const reviewQueue = useMemo(() => {
    const items = [];
    documentsWithLinks.forEach((doc) => {
      if (doc.status === "unread") {
        items.push({
          id: `doc-${doc.id}`,
          type: "document",
          title: doc.title,
          subtitle: `${doc.sourceName} · ${doc.symbols?.join(", ") || "No linked symbols"}`,
          detail: "Unread research still waiting to be promoted or linked.",
          actionLabel: "Review note",
          onOpen: () => {
            setSelectedDocId(doc.id);
            setActiveView("inbox");
          }
        });
      }
    });
    activeTheses.forEach((item) => {
      const age = Math.abs(daysUntil(item.updatedAt) || 0);
      if (age > 30 && item.recordState === "active" && item.stage !== "invalidated") {
        items.push({
          id: `thesis-${item.id}`,
          type: "thesis",
          title: `${item.symbol} thesis is stale`,
          subtitle: `${toSlugLabel(item.stage)} · ${item.owner}`,
          detail: `Last updated ${age} days ago. Refresh or resolve before it silently drifts.`,
          actionLabel: "Edit thesis",
          onOpen: () => beginEdit("thesis", item)
        });
      }
    });
    upcomingCatalysts.forEach((item) => {
      const days = daysUntil(item.eventDate);
      if (days !== null && days >= 0 && days <= 7) {
        items.push({
          id: `catalyst-${item.id}`,
          type: "catalyst",
          title: `${item.symbol} catalyst due soon`,
          subtitle: `${item.title} · ${days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}`,
          detail: "Review whether the thesis, trigger, and decision plan are aligned before the event lands.",
          actionLabel: "Edit catalyst",
          onOpen: () => beginEdit("catalyst", item)
        });
      }
    });
    activeTriggers.forEach((item) => {
      if (item.recordState === "active" && item.status === "active") {
        items.push({
          id: `trigger-${item.id}`,
          type: "trigger",
          title: item.title,
          subtitle: `${item.symbol || "Portfolio"} · ${describeTriggerCondition(item)}`,
          detail: "Active trigger still unresolved. Confirm the threshold and rationale are still current.",
          actionLabel: "Edit trigger",
          onOpen: () => beginEdit("trigger", item)
        });
      }
    });
    return items;
  }, [activeTheses, activeTriggers, documentsWithLinks, upcomingCatalysts]);

  const contradictions = useMemo(() => {
    const items = [];
    tickerRows.forEach((row) => {
      const latestDecision = normalizedDecisions
        .filter((item) => item.symbol === row.symbol)
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
      const thesis = normalizedTheses.find((item) => item.symbol === row.symbol && item.recordState !== "archived" && item.stage !== "archived");
      const activeTrigger = normalizedTriggers.find((item) => item.symbol === row.symbol && item.recordState !== "archived" && item.status === "active");
      const nextCatalyst = normalizedCatalysts.find((item) => item.symbol === row.symbol && item.recordState !== "archived" && item.status === "upcoming");
      if (thesis && latestDecision && ["exit", "invalidate", "pass"].includes(latestDecision.action) && ["active thesis", "in portfolio"].includes(thesis.stage)) {
        items.push({
          id: `decision-${row.symbol}`,
          symbol: row.symbol,
          title: "Decision conflicts with active thesis",
          detail: `${toSlugLabel(latestDecision.action)} was logged while the thesis still reads ${toSlugLabel(thesis.stage)}.`,
          actionLabel: "Review thesis",
          onOpen: () => beginEdit("thesis", thesis)
        });
      }
      if (thesis && !thesis.invalidation) {
        items.push({
          id: `invalidation-${thesis.id}`,
          symbol: row.symbol,
          title: "Thesis has no invalidation line",
          detail: "The view is active, but the desk still has no explicit falsification condition logged.",
          actionLabel: "Add invalidation",
          onOpen: () => beginEdit("thesis", thesis)
        });
      }
      if (thesis && !thesis.mustPlayOut) {
        items.push({
          id: `must-play-${thesis.id}`,
          symbol: row.symbol,
          title: "Thesis is missing the must-happen condition",
          detail: "The setup has no explicit 'what must happen next' clause, so contradiction checks stay fuzzy.",
          actionLabel: "Refine thesis",
          onOpen: () => beginEdit("thesis", thesis)
        });
      }
      if (thesis && !thesis.riskCondition) {
        items.push({
          id: `risk-condition-${thesis.id}`,
          symbol: row.symbol,
          title: "Thesis has no risk condition",
          detail: "The desk still has no explicit risk state or market condition that should force a harder review.",
          actionLabel: "Add risk condition",
          onOpen: () => beginEdit("thesis", thesis)
        });
      }
      if (thesis && !nextCatalyst && ["active thesis", "in portfolio"].includes(thesis.stage)) {
        items.push({
          id: `catalyst-gap-${thesis.id}`,
          symbol: row.symbol,
          title: "Active thesis has no catalyst path",
          detail: "The desk is carrying the view without a dated event or check-in to validate it.",
          actionLabel: "Add catalyst",
          onOpen: () => primeTickerAction(row.symbol, "catalysts", "catalyst")
        });
      }
      if (thesis && !activeTrigger && ["active thesis", "in portfolio"].includes(thesis.stage)) {
        items.push({
          id: `trigger-gap-${thesis.id}`,
          symbol: row.symbol,
          title: "Active thesis has no trigger guardrail",
          detail: "There is no threshold rule attached to the live view, so action still depends on memory.",
          actionLabel: "Add trigger",
          onOpen: () => primeTickerAction(row.symbol, "triggers", "trigger")
        });
      }
      if (row.unsupportedByThesis && row.exposure > 0) {
        items.push({
          id: `coverage-${row.symbol}`,
          symbol: row.symbol,
          title: "Portfolio exposure without active thesis",
          detail: `${formatCurrency(row.exposure)} of exposure is live without an active thesis object behind it.`,
          actionLabel: "Create thesis",
          onOpen: () => primeTickerAction(row.symbol, "theses", "thesis")
        });
      }
    });
    return items;
  }, [documentsWithLinks, normalizedDecisions, normalizedTheses, tickerRows]);

  const ownershipRows = useMemo(() => {
    const rows = [];
    normalizedTheses.forEach((item) => rows.push({ id: item.id, kind: "Thesis", label: `${item.symbol} · ${item.title}`, owner: item.owner, state: item.recordState, item }));
    normalizedCatalysts.forEach((item) => rows.push({ id: item.id, kind: "Catalyst", label: `${item.symbol} · ${item.title}`, owner: item.owner, state: item.recordState, item }));
    normalizedTriggers.forEach((item) => rows.push({ id: item.id, kind: "Trigger", label: item.title, owner: item.owner, state: item.recordState, item }));
    normalizedDecisions.forEach((item) => rows.push({ id: item.id, kind: "Decision", label: `${item.symbol} · ${toSlugLabel(item.action)}`, owner: item.owner, state: item.recordState, item }));
    normalizedBriefs.forEach((item) => rows.push({ id: item.id, kind: "Brief", label: item.title, owner: item.owner, state: item.recordState, item }));
    return rows
      .filter((row) => ownershipMode === "all" || row.owner === ownerFilter)
      .sort((a, b) => {
        const aDue = new Date(a.item?.dueDate || 0).getTime();
        const bDue = new Date(b.item?.dueDate || 0).getTime();
        if (aDue && bDue && aDue !== bDue) return aDue - bDue;
        return a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label);
      });
  }, [normalizedBriefs, normalizedCatalysts, normalizedDecisions, normalizedTheses, normalizedTriggers, ownerFilter, ownershipMode]);

  const timelineRows = useMemo(() => {
    const rows = [];
    documentsWithLinks.forEach((item) => rows.push({ id: `doc-${item.id}`, at: item.updatedAt, kind: "Research Note", title: item.title, subtitle: `${item.sourceName} · ${toSlugLabel(item.status)}` }));
    normalizedTheses.forEach((item) => rows.push({ id: `thesis-${item.id}`, at: item.updatedAt, kind: "Thesis", title: `${item.symbol} · ${item.title}`, subtitle: `${toSlugLabel(item.stage)} · ${toSlugLabel(item.priority)} priority · ${item.owner}` }));
    normalizedCatalysts.forEach((item) => rows.push({ id: `catalyst-${item.id}`, at: item.updatedAt, kind: "Catalyst", title: `${item.symbol} · ${item.title}`, subtitle: `${formatDateOnly(item.eventDate)} · ${toSlugLabel(item.status)} · ${toSlugLabel(item.priority)} priority` }));
    normalizedTriggers.forEach((item) => rows.push({ id: `trigger-${item.id}`, at: item.updatedAt, kind: "Trigger", title: item.title, subtitle: `${describeTriggerCondition(item)} · ${toSlugLabel(item.priority)} priority` }));
    normalizedDecisions.forEach((item) => rows.push({ id: `decision-${item.id}`, at: item.updatedAt, kind: "Decision", title: `${item.symbol} · ${toSlugLabel(item.action)}`, subtitle: `${item.conviction} conviction · ${toSlugLabel(item.priority)} priority` }));
    normalizedBriefs.forEach((item) => rows.push({ id: `brief-${item.id}`, at: item.updatedAt, kind: "Brief", title: item.title, subtitle: `${BRIEF_TEMPLATES.find((brief) => brief.value === item.template)?.label || "Brief"} · ${toSlugLabel(item.approvalState)}` }));
    return rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  }, [documentsWithLinks, normalizedBriefs, normalizedCatalysts, normalizedDecisions, normalizedTheses, normalizedTriggers]);

  const metrics = useMemo(() => {
    return [
      { label: "Sources", value: sources.length, helper: `${sources.filter((source) => deriveSourceReadiness(source).key === "connected").length} connected` },
      { label: "Documents", value: normalizedDocuments.length, helper: `${inboxDocuments.length} active in triage` },
      { label: "Review Queue", value: reviewQueue.length, helper: `${documentsWithLinks.filter((doc) => doc.status === "unread").length} unread notes` },
      { label: "Coverage", value: coverageRows.length, helper: `${coverageRows.filter((row) => row.exposure > 0).length} tied to live exposure` },
      { label: "Contradictions", value: contradictions.length, helper: contradictions.length ? "Resolve drift before it compounds" : "No active research drift" },
      { label: "Briefs", value: normalizedBriefs.filter((item) => item.recordState !== "archived").length, helper: `${normalizedBriefs.length} total outputs` },
      { label: "Backend", value: backendStatus === "online" ? "Online" : backendStatus === "offline" ? "Offline" : "Checking", helper: hasWorkspaceSession() ? "Workspace APIs available" : "Guest mode still saves locally" }
    ];
  }, [backendStatus, contradictions.length, coverageRows, documentsWithLinks, inboxDocuments.length, normalizedBriefs, normalizedDocuments.length, reviewQueue.length, sources]);

  async function persistResearchBundle(nextState = {}, successMessage = "Research workspace saved.") {
    const nextSources = nextState.sources || sources;
    const nextDocuments = nextState.documents || documents;
    const nextTheses = nextState.theses || theses;
    const nextCatalysts = nextState.catalysts || catalysts;
    const nextTriggers = nextState.triggers || triggers;
    const nextDecisions = nextState.decisions || decisions;
    const nextBriefs = nextState.briefs || briefs;

    setIsSaving(true);
    writeLocalJson(SOURCES_STORAGE_KEY, nextSources);
    writeLocalJson(DOCUMENTS_STORAGE_KEY, nextDocuments);
    writeLocalJson(THESES_STORAGE_KEY, nextTheses);
    writeLocalJson(CATALYSTS_STORAGE_KEY, nextCatalysts);
    writeLocalJson(TRIGGERS_STORAGE_KEY, nextTriggers);
    writeLocalJson(DECISIONS_STORAGE_KEY, nextDecisions);
    writeLocalJson(BRIEFS_STORAGE_KEY, nextBriefs);

    try {
      await Promise.all([
        saveWorkspaceCollection(SOURCES_NAMESPACE, nextSources, 200),
        saveWorkspaceCollection(DOCUMENTS_NAMESPACE, nextDocuments, 1000),
        saveWorkspaceCollection(THESES_NAMESPACE, nextTheses, 500),
        saveWorkspaceCollection(CATALYSTS_NAMESPACE, nextCatalysts, 500),
        saveWorkspaceCollection(TRIGGERS_NAMESPACE, nextTriggers, 500),
        saveWorkspaceCollection(DECISIONS_NAMESPACE, nextDecisions, 500),
        saveWorkspaceCollection(BRIEFS_NAMESPACE, nextBriefs, 300)
      ]);
      setNotice(successMessage);
    } catch (error) {
      setNotice(`Saved locally. Workspace sync skipped: ${error?.message || "unavailable"}`);
    } finally {
      setIsSaving(false);
    }
  }

  function resetEditingIf(type) {
    setEditingEntity((current) => (current.type === type ? { type: "", id: "" } : current));
  }

  function getEditingLabel(type) {
    return editingEntity.type === type ? "Update" : "Save";
  }

  function beginEdit(type, item) {
    if (!item) return;
    setEditingEntity({ type, id: item.id });
    if (type === "thesis") {
      setThesisDraft({
        symbol: item.symbol,
        title: item.title,
        stage: item.stage,
        summary: item.summary,
        bullCase: item.bullCase,
        invalidation: item.invalidation,
        conviction: item.conviction,
        mustPlayOut: item.mustPlayOut,
        riskCondition: item.riskCondition,
        coverageScope: item.coverageScope,
        owner: item.owner,
        priority: item.priority,
        dueDate: item.dueDate
      });
      setActiveView("theses");
    }
    if (type === "catalyst") {
      setCatalystDraft({
        symbol: item.symbol,
        title: item.title,
        type: item.type,
        eventDate: item.eventDate,
        note: item.note,
        status: item.status,
        coverageScope: item.coverageScope,
        owner: item.owner,
        priority: item.priority,
        dueDate: item.dueDate
      });
      setActiveView("catalysts");
    }
    if (type === "trigger") {
      setTriggerDraft({
        title: item.title,
        symbol: item.symbol,
        scopeType: item.scopeType,
        actionType: item.actionType,
        conditionType: item.conditionType,
        thresholdValue: item.thresholdValue,
        linkedThesisId: item.linkedThesisId,
        linkedCatalystId: item.linkedCatalystId,
        rationale: item.rationale,
        cooldownHours: item.cooldownHours,
        status: item.status,
        coverageScope: item.coverageScope,
        owner: item.owner,
        priority: item.priority,
        dueDate: item.dueDate
      });
      setActiveView("triggers");
    }
    if (type === "decision") {
      setDecisionDraft({
        symbol: item.symbol,
        action: item.action,
        conviction: item.conviction,
        rationale: item.rationale,
        thesisId: item.thesisId,
        coverageScope: item.coverageScope,
        owner: item.owner,
        priority: item.priority,
        dueDate: item.dueDate
      });
      setActiveView("decisions");
    }
    if (type === "brief") {
      setBriefDraft({
        title: item.title,
        symbol: item.symbol,
        template: item.template,
        coverageScope: item.coverageScope,
        owner: item.owner,
        priority: item.priority,
        dueDate: item.dueDate,
        approvalState: item.approvalState,
        commentary: item.commentary
      });
      setSelectedBriefId(item.id);
      setActiveView("briefs");
    }
  }

  async function setEntityState(type, item, nextState) {
    const timestamp = nowIso();
    if (type === "thesis") {
      const next = theses.map((entry) => entry.id === item.id ? normalizeThesis({ ...entry, recordState: nextState, resolvedAt: nextState === "resolved" ? timestamp : entry.resolvedAt, archivedAt: nextState === "archived" ? timestamp : entry.archivedAt, updatedAt: timestamp }) : entry);
      setTheses(next);
      await persistResearchBundle({ theses: next }, `${item.title} marked ${toSlugLabel(nextState)}.`);
    }
    if (type === "catalyst") {
      const next = catalysts.map((entry) => entry.id === item.id ? normalizeCatalyst({ ...entry, recordState: nextState, resolvedAt: nextState === "resolved" ? timestamp : entry.resolvedAt, archivedAt: nextState === "archived" ? timestamp : entry.archivedAt, updatedAt: timestamp }) : entry);
      setCatalysts(next);
      await persistResearchBundle({ catalysts: next }, `${item.title} marked ${toSlugLabel(nextState)}.`);
    }
    if (type === "trigger") {
      const next = triggers.map((entry) => entry.id === item.id ? normalizeTrigger({ ...entry, recordState: nextState, status: nextState === "archived" ? "archived" : entry.status, resolvedAt: nextState === "resolved" ? timestamp : entry.resolvedAt, archivedAt: nextState === "archived" ? timestamp : entry.archivedAt, updatedAt: timestamp }) : entry);
      setTriggers(next);
      await persistResearchBundle({ triggers: next }, `${item.title} marked ${toSlugLabel(nextState)}.`);
    }
    if (type === "decision") {
      const next = decisions.map((entry) => entry.id === item.id ? normalizeDecision({ ...entry, recordState: nextState, resolvedAt: nextState === "resolved" ? timestamp : entry.resolvedAt, archivedAt: nextState === "archived" ? timestamp : entry.archivedAt, updatedAt: timestamp }) : entry);
      setDecisions(next);
      await persistResearchBundle({ decisions: next }, `${item.symbol} decision marked ${toSlugLabel(nextState)}.`);
    }
    if (type === "brief") {
      const next = briefs.map((entry) => entry.id === item.id ? normalizeBrief({ ...entry, recordState: nextState, resolvedAt: nextState === "resolved" ? timestamp : entry.resolvedAt, archivedAt: nextState === "archived" ? timestamp : entry.archivedAt, updatedAt: timestamp }) : entry);
      setBriefs(next);
      await persistResearchBundle({ briefs: next }, `${item.title} marked ${toSlugLabel(nextState)}.`);
    }
  }

  function duplicateEntity(type, item) {
    const timestamp = nowIso();
    if (type === "thesis") {
      const next = normalizeThesis({ ...item, id: createId("thesis"), title: `${item.title} copy`, recordState: "active", resolvedAt: "", archivedAt: "", createdAt: timestamp, updatedAt: timestamp });
      const nextState = [next, ...theses];
      setTheses(nextState);
      persistResearchBundle({ theses: nextState }, `${item.title} duplicated.`);
    }
    if (type === "catalyst") {
      const next = normalizeCatalyst({ ...item, id: createId("catalyst"), title: `${item.title} copy`, recordState: "active", resolvedAt: "", archivedAt: "", createdAt: timestamp, updatedAt: timestamp });
      const nextState = [next, ...catalysts];
      setCatalysts(nextState);
      persistResearchBundle({ catalysts: nextState }, `${item.title} duplicated.`);
    }
    if (type === "trigger") {
      const next = normalizeTrigger({ ...item, id: createId("trigger"), title: `${item.title} copy`, recordState: "active", status: "active", resolvedAt: "", archivedAt: "", lastTriggeredAt: "", createdAt: timestamp, updatedAt: timestamp });
      const nextState = [next, ...triggers];
      setTriggers(nextState);
      persistResearchBundle({ triggers: nextState }, `${item.title} duplicated.`);
    }
    if (type === "decision") {
      const next = normalizeDecision({ ...item, id: createId("decision"), recordState: "active", resolvedAt: "", archivedAt: "", createdAt: timestamp, updatedAt: timestamp });
      const nextState = [next, ...decisions];
      setDecisions(nextState);
      persistResearchBundle({ decisions: nextState }, `${item.symbol} decision duplicated.`);
    }
    if (type === "brief") {
      const next = normalizeBrief({ ...item, id: createId("brief"), title: `${item.title} copy`, recordState: "active", resolvedAt: "", archivedAt: "", createdAt: timestamp, updatedAt: timestamp });
      const nextState = [next, ...briefs];
      setBriefs(nextState);
      persistResearchBundle({ briefs: nextState }, `${item.title} duplicated.`);
    }
  }

  async function addSource() {
    const type = normalizeSourceType(sourceDraft.type);
    const trimmedName = sourceDraft.name.trim() || `${inferSourceLabel(type)} source`;
    const readiness = SOURCE_TYPES.find((source) => source.type === type)?.readiness || "tracked_only";
    const nextSource = {
      id: createId("source"),
      type,
      name: trimmedName,
      url: sourceDraft.url.trim(),
      status: type === "manual" ? "connected" : "tracked",
      readiness,
      syncMode: type === "obsidian" ? "markdown_or_local_rest" : type === "notion" ? "url_tracking" : "manual",
      documentCount: 0,
      lastSyncedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      meta: {
        description: SOURCE_TYPES.find((source) => source.type === type)?.description || ""
      }
    };
    const nextSources = [nextSource, ...sources];
    setSources(nextSources);
    setSourceDraft({ type: "notion", name: "", url: "" });
    await persistResearchBundle({ sources: nextSources }, `${trimmedName} added to Research sources.`);
  }

  async function addDocument(payload) {
    const source = sourceById.get(payload.sourceId) || sourceById.get("source-manual-default") || sources[0];
    const nextDoc = buildDocumentPayload({
      ...payload,
      sourceId: source?.id || null,
      sourceType: source?.type || payload.sourceType || "manual",
      sourceName: source?.name || payload.sourceName || "Zenin Research Inbox"
    });
    const nextDocuments = [nextDoc, ...documents];
    const nextSources = sources.map((item) => item.id === nextDoc.sourceId
      ? {
          ...item,
          documentCount: Number(item.documentCount || 0) + 1,
          lastSyncedAt: nowIso(),
          updatedAt: nowIso(),
          status: item.type === "manual" ? "connected" : item.status
        }
      : item
    );
    setDocuments(nextDocuments);
    setSources(nextSources);
    setDraft({ title: "", body: "", sourceId: source?.id || "source-manual-default", status: "unread" });
    setSelectedDocId(nextDoc.id);
    setActiveView("inbox");
    await persistResearchBundle({ sources: nextSources, documents: nextDocuments }, `${nextDoc.title} indexed in Research.`);
  }

  async function saveManualDraft() {
    if (!draft.title.trim() && !draft.body.trim()) {
      setNotice("Add a title or note body before saving research.");
      return;
    }
    await addDocument({
      title: draft.title,
      body: draft.body,
      sourceId: draft.sourceId,
      origin: "manual",
      status: draft.status
    });
  }

  async function updateDocumentStatus(docId, nextStatus) {
    const nextDocuments = documents.map((doc) => doc.id === docId ? normalizeDocument({ ...doc, status: nextStatus, updatedAt: nowIso() }) : doc);
    setDocuments(nextDocuments);
    await persistResearchBundle({ documents: nextDocuments }, `Document moved to ${toSlugLabel(nextStatus)}.`);
  }

  async function removeDocument(docId) {
    const removed = documents.find((doc) => doc.id === docId);
    const nextDocuments = documents.filter((doc) => doc.id !== docId);
    const nextSources = sources.map((source) => source.id === removed?.sourceId
      ? { ...source, documentCount: Math.max(0, Number(source.documentCount || 0) - 1), updatedAt: nowIso() }
      : source
    );
    setDocuments(nextDocuments);
    setSources(nextSources);
    if (selectedDocId === docId) setSelectedDocId(null);
    await persistResearchBundle({ sources: nextSources, documents: nextDocuments }, "Research document removed.");
  }

  async function handleMarkdownFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const manualSource = sourceById.get(draft.sourceId) || sourceById.get("source-manual-default") || sources[0];
    const importedDocs = [];
    for (const file of files) {
      const body = await file.text();
      importedDocs.push(buildDocumentPayload({
        title: file.name.replace(/\.(md|markdown|txt)$/i, ""),
        body,
        sourceId: manualSource?.id,
        sourceType: manualSource?.type || "manual",
        sourceName: manualSource?.name || "Markdown import",
        origin: "markdown_import",
        status: "unread"
      }));
    }
    const nextDocuments = [...importedDocs, ...documents];
    const nextSources = sources.map((source) => source.id === manualSource?.id
      ? {
          ...source,
          documentCount: Number(source.documentCount || 0) + importedDocs.length,
          lastSyncedAt: nowIso(),
          updatedAt: nowIso(),
          status: "connected"
        }
      : source
    );
    setDocuments(nextDocuments);
    setSources(nextSources);
    setSelectedDocId(importedDocs[0]?.id || null);
    setActiveView("inbox");
    await persistResearchBundle({ sources: nextSources, documents: nextDocuments }, `${importedDocs.length} Markdown note${importedDocs.length === 1 ? "" : "s"} imported.`);
  }

  async function fetchActiveObsidianNote() {
    const endpoint = String(obsidianConfig.endpoint || "").replace(/\/+$/, "");
    const token = String(obsidianConfig.token || "").trim();
    if (!endpoint || !token) {
      setNotice("Add your Obsidian Local REST endpoint and API key first. Markdown import is the safest fallback if the local plugin is not running yet.");
      return;
    }
    setIsSyncingObsidian(true);
    try {
      const response = await zeninFetch(`${endpoint}/active/`, {
        credentials: "omit",
        skipSimulationHeaders: true,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/markdown, text/plain, application/vnd.olrapi.note+json, application/json"
        }
      });
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const payload = contentType.includes("json") ? await response.json() : await response.text();
      if (!response.ok) {
        throw new Error(typeof payload === "string" ? payload : payload?.message || "Obsidian request failed");
      }
      const body = typeof payload === "string" ? payload : payload?.content || payload?.markdown || payload?.body || "";
      const title = typeof payload === "object" && payload?.path
        ? String(payload.path).split("/").pop().replace(/\.(md|markdown)$/i, "")
        : "Active Obsidian note";
      let obsidianSource = sources.find((source) => source.type === "obsidian");
      let nextSources = sources;
      if (!obsidianSource) {
        obsidianSource = {
          id: createId("source"),
          type: "obsidian",
          name: "Obsidian Local Vault",
          status: "connected",
          readiness: "connected",
          syncMode: "local_rest",
          documentCount: 0,
          lastSyncedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          meta: { description: "Local REST active note import." }
        };
        nextSources = [obsidianSource, ...sources];
        setSources(nextSources);
      }
      await addDocument({
        title,
        body,
        sourceId: obsidianSource.id,
        sourceType: "obsidian",
        sourceName: obsidianSource.name,
        origin: "obsidian_active",
        status: "unread"
      });
    } catch (error) {
      const message = String(error?.message || "");
      if (/failed to fetch|networkerror|load failed|certificate/i.test(message)) {
        setNotice("Could not reach Obsidian Local REST. Make sure the plugin is running on this machine, the endpoint is correct, and the API key matches. If local HTTPS blocks the request, use Markdown import for now.");
      } else {
        setNotice(`Could not read Obsidian active note: ${message || "local REST unavailable"}`);
      }
    } finally {
      setIsSyncingObsidian(false);
    }
  }

  function clearDrafts(type) {
    if (type === "thesis") {
      setThesisDraft({ symbol: "", title: "", stage: "watching", summary: "", bullCase: "", invalidation: "", conviction: "Medium", mustPlayOut: "", riskCondition: "", coverageScope: "single_name", owner: "Desk", priority: "medium", dueDate: "" });
      resetEditingIf("thesis");
    }
    if (type === "catalyst") {
      setCatalystDraft({ symbol: "", title: "", type: "earnings", eventDate: "", note: "", status: "upcoming", coverageScope: "single_name", owner: "Desk", priority: "medium", dueDate: "" });
      resetEditingIf("catalyst");
    }
    if (type === "trigger") {
      setTriggerDraft({ title: "", symbol: "", scopeType: "asset", actionType: "review", conditionType: "price_below", thresholdValue: "", linkedThesisId: "", linkedCatalystId: "", rationale: "", cooldownHours: 24, status: "active", coverageScope: "single_name", owner: "Desk", priority: "medium", dueDate: "" });
      resetEditingIf("trigger");
    }
    if (type === "decision") {
      setDecisionDraft({ symbol: "", action: "watch", conviction: "Medium", rationale: "", thesisId: "", coverageScope: "single_name", owner: "Desk", priority: "medium", dueDate: "" });
      resetEditingIf("decision");
    }
    if (type === "brief") {
      setBriefDraft({ title: "", symbol: "", template: "desk-memo", coverageScope: "single_name", owner: "Desk", priority: "medium", dueDate: "", approvalState: "draft", commentary: "" });
      resetEditingIf("brief");
    }
  }

  async function saveThesis() {
    if (!thesisDraft.symbol.trim() || !thesisDraft.title.trim()) {
      setNotice("Add a symbol and title before saving a thesis.");
      return;
    }
    const base = editingEntity.type === "thesis" ? theses.find((item) => item.id === editingEntity.id) : null;
    const nextThesis = normalizeThesis({
      ...(base || {}),
      id: base?.id || createId("thesis"),
      symbol: thesisDraft.symbol,
      title: thesisDraft.title,
      stage: thesisDraft.stage,
      summary: thesisDraft.summary,
      bullCase: thesisDraft.bullCase,
      invalidation: thesisDraft.invalidation,
      mustPlayOut: thesisDraft.mustPlayOut,
      riskCondition: thesisDraft.riskCondition,
      conviction: thesisDraft.conviction,
      coverageScope: thesisDraft.coverageScope,
      owner: thesisDraft.owner,
      priority: thesisDraft.priority,
      dueDate: thesisDraft.dueDate,
      recordState: base?.recordState || "active",
      createdAt: base?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    const nextTheses = upsertEntity(theses, nextThesis);
    setTheses(nextTheses);
    setSelectedTicker(nextThesis.symbol);
    clearDrafts("thesis");
    setActiveView("theses");
    await persistResearchBundle({ theses: nextTheses }, `${nextThesis.symbol} thesis ${base ? "updated" : "saved"}.`);
  }

  async function saveCatalyst() {
    if (!catalystDraft.symbol.trim() || !catalystDraft.title.trim()) {
      setNotice("Add a symbol and catalyst title before saving.");
      return;
    }
    const base = editingEntity.type === "catalyst" ? catalysts.find((item) => item.id === editingEntity.id) : null;
    const nextCatalyst = normalizeCatalyst({
      ...(base || {}),
      id: base?.id || createId("catalyst"),
      symbol: catalystDraft.symbol,
      title: catalystDraft.title,
      type: catalystDraft.type,
      eventDate: catalystDraft.eventDate,
      note: catalystDraft.note,
      status: catalystDraft.status,
      coverageScope: catalystDraft.coverageScope,
      owner: catalystDraft.owner,
      priority: catalystDraft.priority,
      dueDate: catalystDraft.dueDate || catalystDraft.eventDate,
      recordState: base?.recordState || "active",
      createdAt: base?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    const nextCatalysts = upsertEntity(catalysts, nextCatalyst);
    setCatalysts(nextCatalysts);
    setSelectedTicker(nextCatalyst.symbol);
    clearDrafts("catalyst");
    setActiveView("catalysts");
    await persistResearchBundle({ catalysts: nextCatalysts }, `${nextCatalyst.title} ${base ? "updated" : "added"} to catalyst calendar.`);
  }

  async function saveTrigger() {
    if (!triggerDraft.symbol.trim() || !triggerDraft.rationale.trim()) {
      setNotice("Add a symbol and why this trigger matters before saving.");
      return;
    }
    if (!String(triggerDraft.thresholdValue).trim()) {
      setNotice("Add the threshold for this trigger first.");
      return;
    }
    if (triggerDraft.conditionType === "catalyst_within_days" && !triggerDraft.linkedCatalystId) {
      setNotice("Link a catalyst when using a catalyst-timing trigger.");
      return;
    }
    const base = editingEntity.type === "trigger" ? triggers.find((item) => item.id === editingEntity.id) : null;
    const nextTrigger = normalizeTrigger({
      ...(base || {}),
      id: base?.id || createId("trigger"),
      title: triggerDraft.title,
      symbol: triggerDraft.symbol,
      scopeType: triggerDraft.scopeType,
      actionType: triggerDraft.actionType,
      conditionType: triggerDraft.conditionType,
      thresholdValue: triggerDraft.thresholdValue,
      linkedThesisId: triggerDraft.linkedThesisId,
      linkedCatalystId: triggerDraft.linkedCatalystId,
      rationale: triggerDraft.rationale,
      cooldownHours: triggerDraft.cooldownHours,
      status: triggerDraft.status,
      coverageScope: triggerDraft.coverageScope,
      owner: triggerDraft.owner,
      priority: triggerDraft.priority,
      dueDate: triggerDraft.dueDate,
      recordState: base?.recordState || "active",
      createdAt: base?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    const nextTriggers = upsertEntity(triggers, nextTrigger);
    setTriggers(nextTriggers);
    setSelectedTicker(nextTrigger.symbol || selectedTicker);
    clearDrafts("trigger");
    setActiveView("triggers");
    await persistResearchBundle({ triggers: nextTriggers }, `${nextTrigger.title} ${base ? "updated" : "saved"} to trigger workflow.`);
  }

  async function saveDecision() {
    if (!decisionDraft.symbol.trim() || !decisionDraft.rationale.trim()) {
      setNotice("Add a symbol and rationale before logging a decision.");
      return;
    }
    const base = editingEntity.type === "decision" ? decisions.find((item) => item.id === editingEntity.id) : null;
    const nextDecision = normalizeDecision({
      ...(base || {}),
      id: base?.id || createId("decision"),
      symbol: decisionDraft.symbol,
      action: decisionDraft.action,
      conviction: decisionDraft.conviction,
      rationale: decisionDraft.rationale,
      thesisId: decisionDraft.thesisId,
      coverageScope: decisionDraft.coverageScope,
      owner: decisionDraft.owner,
      priority: decisionDraft.priority,
      dueDate: decisionDraft.dueDate,
      recordState: base?.recordState || "active",
      createdAt: base?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    const nextDecisions = upsertEntity(decisions, nextDecision);
    setDecisions(nextDecisions);
    setSelectedTicker(nextDecision.symbol);
    clearDrafts("decision");
    setActiveView("decisions");
    await persistResearchBundle({ decisions: nextDecisions }, `${nextDecision.symbol} decision ${base ? "updated" : "logged"}.`);
  }

  function buildBriefSections({ symbol, template, docs, thesis, catalysts: linkedCatalysts, decisions: linkedDecisions, row, commentary }) {
    const sections = [];
    const label = BRIEF_TEMPLATES.find((item) => item.value === template)?.label || "Desk Memo";
    sections.push({
      title: "Thesis",
      body: thesis
        ? `${label} frame: ${thesis.summary || "No summary logged yet."}\nStage: ${toSlugLabel(thesis.stage)} · Conviction: ${thesis.conviction}`
        : "No active thesis is linked. Promote the best research note into a thesis before distributing this brief."
    });
    sections.push({
      title: "Catalysts",
      body: linkedCatalysts.length
        ? linkedCatalysts.slice(0, 4).map((item) => `${formatDateOnly(item.eventDate)} · ${item.title} (${toSlugLabel(item.type)})`).join("\n")
        : "No catalysts logged yet."
    });
    sections.push({
      title: "Risks",
      body: [
        thesis?.invalidation ? `Invalidation: ${thesis.invalidation}` : "No invalidation line logged.",
        docs.find((doc) => keywordMatchesNegative(`${doc.title}\n${doc.body}`))?.summary ? `Negative note: ${docs.find((doc) => keywordMatchesNegative(`${doc.title}\n${doc.body}`))?.summary}` : "No flagged contradiction note.",
        row?.activeTriggerCount ? `${row.activeTriggerCount} active trigger${row.activeTriggerCount === 1 ? "" : "s"} are still governing the name.` : "No active trigger rules logged."
      ].join("\n")
    });
    sections.push({
      title: "Position Context",
      body: row
        ? [
            `Exposure: ${formatCurrency(row.exposure)}`,
            `Portfolio weight: ${formatPercent(row.weight)}`,
            `Watchlist: ${row.inWatchlist ? "Yes" : "No"}`,
            `Unsupported by thesis: ${row.unsupportedByThesis ? "Yes" : "No"}`
          ].join("\n")
        : "Desk-wide brief with no single-symbol position context."
    });
    sections.push({
      title: "Recent Decisions",
      body: linkedDecisions.length
        ? linkedDecisions.slice(0, 4).map((item) => `${formatDateTime(item.createdAt)} · ${toSlugLabel(item.action)} · ${item.rationale || "No rationale logged."}`).join("\n")
        : "No recent decisions logged for this symbol."
    });
    sections.push({
      title: "Commentary",
      body: commentary?.trim()
        ? commentary.trim()
        : docs.length
        ? docs.slice(0, 3).map((item) => `${item.title}: ${item.summary}`).join("\n")
        : "No supporting notes yet. Import source material before distributing this output."
    });
    return sections;
  }

  async function generateBrief() {
    const symbol = briefDraft.symbol.trim().toUpperCase();
    const relatedDocs = symbol ? documentsWithLinks.filter((doc) => (doc.symbols || []).includes(symbol)) : documentsWithLinks.slice(0, 6);
    const relatedThesis = symbol ? normalizedTheses.find((item) => item.symbol === symbol && item.recordState !== "archived" && item.stage !== "archived") : normalizedTheses[0];
    const relatedCatalysts = symbol ? normalizedCatalysts.filter((item) => item.symbol === symbol && item.recordState !== "archived") : normalizedCatalysts.slice(0, 4);
    const relatedDecisions = symbol ? normalizedDecisions.filter((item) => item.symbol === symbol && item.recordState !== "archived") : normalizedDecisions.slice(0, 4);
    const row = symbol ? tickerRows.find((item) => item.symbol === symbol) : null;
    const title = briefDraft.title.trim() || `${symbol || "Desk"} ${BRIEF_TEMPLATES.find((item) => item.value === briefDraft.template)?.label || "Brief"}`;
    const sections = buildBriefSections({
      symbol,
      template: briefDraft.template,
      docs: relatedDocs,
      thesis: relatedThesis || null,
      catalysts: relatedCatalysts,
      decisions: relatedDecisions,
      row,
      commentary: briefDraft.commentary
    });
    const content = sections.map((section) => `${section.title}\n${section.body}`).join("\n\n");
    const base = editingEntity.type === "brief" ? briefs.find((item) => item.id === editingEntity.id) : null;
    const nextBrief = normalizeBrief({
      ...(base || {}),
      id: base?.id || createId("brief"),
      title,
      symbol,
      template: briefDraft.template,
      content,
      sections,
      coverageScope: briefDraft.coverageScope,
      owner: briefDraft.owner,
      priority: briefDraft.priority,
      dueDate: briefDraft.dueDate,
      approvalState: briefDraft.approvalState,
      commentary: briefDraft.commentary,
      recordState: base?.recordState || "active",
      createdAt: base?.createdAt || nowIso(),
      updatedAt: nowIso()
    });
    const nextBriefs = upsertEntity(briefs, nextBrief);
    setBriefs(nextBriefs);
    setSelectedBriefId(nextBrief.id);
    clearDrafts("brief");
    setActiveView("briefs");
    await persistResearchBundle({ briefs: nextBriefs }, `${nextBrief.title} ${base ? "updated" : "generated"}.`);
  }

  const isWorkspaceBacked = hasWorkspaceSession();
  const saveLabel = isWorkspaceBacked ? "Save to Workspace" : "Save Locally";
  const backendMeta = backendStatus === "online"
    ? (isWorkspaceBacked ? "Backend online · workspace-backed" : "Backend online · guest/local mode")
    : backendStatus === "offline"
      ? "Backend offline · local-only mode"
      : "Checking backend reachability";

  function continueDocumentPromotion(doc, draftType, scopeOverride, targetSymbolOverride) {
    const scope = scopeOverride || pendingPromotion.scope || "single_name";
    const symbol = String(targetSymbolOverride || doc?.symbols?.[0] || "").trim().toUpperCase();
    if (!symbol) {
      setNotice("This note has no linked ticker yet. Add one in the note text first.");
      return;
    }
    setSelectedTicker(symbol);
    if (draftType === "thesis") {
      setThesisDraft({
        symbol,
        title: scope === "single_name" ? `${symbol} thesis` : `${symbol} ${toSlugLabel(scope)} thesis`,
        stage: "watching",
        summary: doc.summary,
        bullCase: doc.summary,
        invalidation: "",
        conviction: "Medium",
        mustPlayOut: "",
        riskCondition: "",
        coverageScope: scope,
        owner: "Desk",
        priority: "medium",
        dueDate: ""
      });
      setEditingEntity({ type: "", id: "" });
      setActiveView("theses");
    }
    if (draftType === "trigger") {
      setTriggerDraft({
        title: scope === "single_name" ? `${symbol} review trigger` : `${symbol} ${toSlugLabel(scope)} review trigger`,
        symbol,
        scopeType: "asset",
        actionType: "review",
        conditionType: "price_below",
        thresholdValue: "",
        linkedThesisId: "",
        linkedCatalystId: "",
        rationale: doc.summary,
        cooldownHours: 24,
        status: "active",
        coverageScope: scope,
        owner: "Desk",
        priority: "medium",
        dueDate: ""
      });
      setEditingEntity({ type: "", id: "" });
      setActiveView("triggers");
    }
    if (draftType === "catalyst") {
      setCatalystDraft({
        symbol,
        title: scope === "single_name" ? `${symbol} catalyst` : `${symbol} ${toSlugLabel(scope)} catalyst`,
        type: "custom",
        eventDate: "",
        note: doc.summary,
        status: "upcoming",
        coverageScope: scope,
        owner: "Desk",
        priority: "medium",
        dueDate: ""
      });
      setEditingEntity({ type: "", id: "" });
      setActiveView("catalysts");
    }
    if (draftType === "decision") {
      const thesisMatch = normalizedTheses.find((item) => item.symbol === symbol && item.recordState !== "archived");
      setDecisionDraft({
        symbol,
        action: "watch",
        conviction: thesisMatch?.conviction || "Medium",
        rationale: doc.summary,
        thesisId: thesisMatch?.id || "",
        coverageScope: scope,
        owner: "Desk",
        priority: "medium",
        dueDate: ""
      });
      setEditingEntity({ type: "", id: "" });
      setActiveView("decisions");
    }
    setPendingPromotion({ docId: "", draftType: "", scope: "single_name", targetSymbol: "" });
    updateDocumentStatus(doc.id, "linked");
  }

  function requestDocumentPromotion(doc, draftType) {
    const symbols = Array.isArray(doc?.symbols) ? doc.symbols.filter(Boolean) : [];
    if (symbols.length <= 1) {
      continueDocumentPromotion(doc, draftType, "single_name", symbols[0] || "");
      return;
    }
    setSelectedDocId(doc.id);
    setPendingPromotion({
      docId: doc.id,
      draftType,
      scope: "basket",
      targetSymbol: symbols[0] || ""
    });
  }

  const [promotingDecisionThread, setPromotingDecisionThread] = useState(false);
  async function promoteDocToDecisionThread(doc) {
    if (typeof onPromoteToDecisionThread !== "function") {
      setNotice("Decision threads are not connected in this workspace.");
      return;
    }
    const symbols = Array.isArray(doc?.symbols) ? doc.symbols.filter(Boolean) : [];
    const symbol = symbols[0] || "";
    if (!symbol) {
      setNotice("This note has no linked ticker. Add a symbol before promoting to a decision thread.");
      return;
    }
    setPromotingDecisionThread(true);
    try {
      await onPromoteToDecisionThread({
        docId: doc.id,
        title: doc.title || `${symbol} decision thread`,
        symbol,
        summary: doc.summary || "",
        sourceType: doc.sourceType || "manual",
        sourceName: doc.sourceName || inferSourceLabel(doc.sourceType)
      });
      updateDocumentStatus(doc.id, "linked");
      setNotice(`${symbol} promoted to decision thread.`);
    } catch (error) {
      setNotice(error?.message || "Could not promote to decision thread.");
    } finally {
      setPromotingDecisionThread(false);
    }
  }

  function primeTickerAction(symbol, targetView, draftType) {
    const nextSymbol = String(symbol || "").trim().toUpperCase();
    if (!nextSymbol) return;
    setSelectedTicker(nextSymbol);
    if (draftType === "thesis") {
      setThesisDraft((prev) => ({ ...prev, symbol: nextSymbol, title: prev.title || `${nextSymbol} thesis` }));
      setEditingEntity({ type: "", id: "" });
    }
    if (draftType === "catalyst") {
      setCatalystDraft((prev) => ({ ...prev, symbol: nextSymbol, title: prev.title || `${nextSymbol} catalyst` }));
      setEditingEntity({ type: "", id: "" });
    }
    if (draftType === "decision") {
      const thesisMatch = normalizedTheses.find((item) => item.symbol === nextSymbol && item.recordState !== "archived");
      setDecisionDraft((prev) => ({ ...prev, symbol: nextSymbol, thesisId: prev.thesisId || thesisMatch?.id || "" }));
      setEditingEntity({ type: "", id: "" });
    }
    if (draftType === "brief") {
      setBriefDraft((prev) => ({ ...prev, symbol: nextSymbol, title: prev.title || `${nextSymbol} Desk Memo` }));
      setEditingEntity({ type: "", id: "" });
    }
    if (draftType === "trigger") {
      const thesisMatch = normalizedTheses.find((item) => item.symbol === nextSymbol && item.recordState !== "archived");
      const catalystMatch = normalizedCatalysts.find((item) => item.symbol === nextSymbol && item.recordState !== "archived");
      setTriggerDraft((prev) => ({
        ...prev,
        symbol: nextSymbol,
        title: prev.title || `${nextSymbol} review trigger`,
        linkedThesisId: prev.linkedThesisId || thesisMatch?.id || "",
        linkedCatalystId: prev.linkedCatalystId || catalystMatch?.id || ""
      }));
      setEditingEntity({ type: "", id: "" });
    }
    setActiveView(targetView);
  }

  function applyTemplate(template) {
    if (template.category === "thesis") {
      setThesisDraft((prev) => ({ ...prev, ...template.seed }));
      setActiveView("theses");
    }
    if (template.category === "catalyst") {
      setCatalystDraft((prev) => ({ ...prev, ...template.seed }));
      setActiveView("catalysts");
    }
    if (template.category === "trigger") {
      setTriggerDraft((prev) => ({ ...prev, ...template.seed }));
      setActiveView("triggers");
    }
    if (template.category === "brief") {
      setBriefDraft((prev) => ({ ...prev, ...template.seed }));
      setActiveView("briefs");
    }
  }

  function updateOwner(kind, id, owner) {
    const timestamp = nowIso();
    if (kind === "Thesis") {
      const next = theses.map((item) => item.id === id ? normalizeThesis({ ...item, owner, updatedAt: timestamp }) : item);
      setTheses(next);
      persistResearchBundle({ theses: next }, "Thesis owner updated.");
    }
    if (kind === "Catalyst") {
      const next = catalysts.map((item) => item.id === id ? normalizeCatalyst({ ...item, owner, updatedAt: timestamp }) : item);
      setCatalysts(next);
      persistResearchBundle({ catalysts: next }, "Catalyst owner updated.");
    }
    if (kind === "Trigger") {
      const next = triggers.map((item) => item.id === id ? normalizeTrigger({ ...item, owner, updatedAt: timestamp }) : item);
      setTriggers(next);
      persistResearchBundle({ triggers: next }, "Trigger owner updated.");
    }
    if (kind === "Decision") {
      const next = decisions.map((item) => item.id === id ? normalizeDecision({ ...item, owner, updatedAt: timestamp }) : item);
      setDecisions(next);
      persistResearchBundle({ decisions: next }, "Decision owner updated.");
    }
    if (kind === "Brief") {
      const next = briefs.map((item) => item.id === id ? normalizeBrief({ ...item, owner, updatedAt: timestamp }) : item);
      setBriefs(next);
      persistResearchBundle({ briefs: next }, "Brief owner updated.");
    }
  }

  async function saveSelectedBriefEdits(nextSelectedBrief) {
    const updatedBrief = normalizeBrief({
      ...nextSelectedBrief,
      updatedAt: nowIso()
    });
    const nextBriefs = briefs.map((item) => item.id === updatedBrief.id ? updatedBrief : item);
    setBriefs(nextBriefs);
    setSelectedBriefId(updatedBrief.id);
    setBriefDraft((prev) => ({
      ...prev,
      title: updatedBrief.title,
      symbol: updatedBrief.symbol,
      template: updatedBrief.template,
      coverageScope: updatedBrief.coverageScope,
      owner: updatedBrief.owner,
      priority: updatedBrief.priority,
      dueDate: updatedBrief.dueDate,
      approvalState: updatedBrief.approvalState,
      commentary: updatedBrief.commentary
    }));
    await persistResearchBundle({ briefs: nextBriefs }, `${updatedBrief.title} edits saved.`);
  }

  function updateSelectedBriefSection(sectionTitle, body) {
    if (!selectedBrief) return;
    const nextSections = selectedBrief.sections.map((section) => section.title === sectionTitle ? { ...section, body } : section);
    const nextContent = nextSections.map((section) => `${section.title}\n${section.body}`).join("\n\n");
    const updatedBrief = {
      ...selectedBrief,
      sections: nextSections,
      content: nextContent
    };
    const nextBriefs = briefs.map((item) => item.id === selectedBrief.id ? updatedBrief : item);
    setBriefs(nextBriefs);
  }

  function updateSelectedBriefField(field, value) {
    if (!selectedBrief) return;
    const updatedBrief = normalizeBrief({
      ...selectedBrief,
      [field]: value,
      sections: field === "commentary"
        ? selectedBrief.sections.map((section) => section.title === "Commentary" ? { ...section, body: value } : section)
        : selectedBrief.sections
    });
    updatedBrief.content = updatedBrief.sections.map((section) => `${section.title}\n${section.body}`).join("\n\n");
    const nextBriefs = briefs.map((item) => item.id === selectedBrief.id ? updatedBrief : item);
    setBriefs(nextBriefs);
  }

  function renderViewTabs() {
    const activeGroup = RESEARCH_VIEW_GROUPS.find((group) => group.views.some((view) => view.id === activeView)) || RESEARCH_VIEW_GROUPS[0];

    return (
      <div className="research-view-nav" aria-label="Research workspace navigation">
        <div className="research-view-tabs" role="tablist" aria-label="Research workflows">
          {RESEARCH_VIEW_GROUPS.map((group) => {
            const isActive = group.id === activeGroup.id;
            return (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={isActive ? "active" : ""}
                onClick={() => setActiveView(group.views[0].id)}
              >
                {group.label}
              </button>
            );
          })}
        </div>
        <div className="research-view-subtabs" role="tablist" aria-label={`${activeGroup.label} views`}>
          {activeGroup.views.map((view) => (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={activeView === view.id}
              className={activeView === view.id ? "active" : ""}
              onClick={() => setActiveView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderInboxView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader
            title="Intake Tape"
            subtitle="Capture, classify, and promote notes into the desk workflow."
            actions={(
              <InlineControlGroup>
                <select value={activeSourceType} onChange={(event) => setActiveSourceType(event.target.value)} className="research-inline-select">
                  <option value="all">All sources</option>
                  {SOURCE_TYPES.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
                </select>
                <input className="research-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes, symbols, sources..." />
              </InlineControlGroup>
            )}
          />

          <div className="research-compose">
            <div className="research-compose-head">
              <strong>Capture note</strong>
              <div className="research-compose-toolbar">
                <select value={draft.sourceId} onChange={(event) => setDraft((prev) => ({ ...prev, sourceId: event.target.value }))}>
                  {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                </select>
                <select value={draft.status} onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}>
                  {DOC_STATUS_OPTIONS.filter((status) => status !== "archived").map((status) => <option key={status} value={status}>{toSlugLabel(status)}</option>)}
                </select>
              </div>
            </div>
            <input value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Memo title, e.g. NVDA channel check after COMPUTEX" />
            <textarea value={draft.body} onChange={(event) => setDraft((prev) => ({ ...prev, body: event.target.value }))} placeholder="Paste the desk note. Symbols like $NVDA, AAPL, BTC, SPY are linked automatically." rows={4} />
            <div className="research-compose-actions">
              <span>Detected: {extractTickerLinks(`${draft.title}\n${draft.body}`).join(", ") || "No tickers yet"}</span>
              <button type="button" className="research-btn primary" onClick={saveManualDraft}>Add to tape</button>
            </div>
          </div>

          {inboxDocuments.length ? (
            <div className="research-card-stack">
              {inboxDocuments.map((doc) => (
                <article key={doc.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <button type="button" className="research-doc-title" onClick={() => setSelectedDocId(doc.id)}>
                        {doc.title}
                      </button>
                      <span>{doc.sourceName || inferSourceLabel(doc.sourceType)} · {formatDateTime(doc.updatedAt)}</span>
                    </div>
                    <div className="research-inline-pills">
                      <span className={`research-status-pill ${doc.status}`}>{toSlugLabel(doc.status)}</span>
                      {(doc.symbols || []).slice(0, 4).map((symbol) => (
                        <button key={symbol} type="button" className="research-symbol-chip" onClick={() => {
                          setSelectedTicker(symbol);
                          setActiveView("tickers");
                        }}>
                          {symbol}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p>{doc.summary}</p>
                  <div className="research-action-row">
                    {DOC_STATUS_OPTIONS.filter((status) => status !== doc.status).slice(0, 3).map((status) => (
                      <button key={status} type="button" className="research-link-btn" onClick={() => updateDocumentStatus(doc.id, status)}>
                        {toSlugLabel(status)}
                      </button>
                    ))}
                    {(doc.symbols || []).length > 1 ? <span className="research-pill">{doc.symbols.length} symbols</span> : null}
                    <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(doc, "thesis")}>Promote to Thesis</button>
                    <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(doc, "trigger")}>Create Trigger</button>
                    <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(doc, "catalyst")}>Add Catalyst</button>
                    <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(doc, "decision")}>Log Decision</button>
                    <button
                      type="button"
                      className="research-link-btn primary"
                      disabled={promotingDecisionThread}
                      onClick={() => promoteDocToDecisionThread(doc)}
                    >
                      {promotingDecisionThread ? "Promoting…" : "Promote to Decision Thread"}
                    </button>
                    <button type="button" className="research-link-btn" onClick={() => setSelectedDocId(doc.id)}>Review</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState
              eyebrow="Knowledge base setup"
              title="Import your first research note"
              description="Start with a Markdown memo, an Obsidian active note, or a pasted thesis. Zenin will link symbols and preserve the source trail."
              steps={[
                "Add a source so the note has provenance.",
                "Import Markdown or paste a memo into the inbox.",
                "Promote strong notes directly into theses, catalysts, or triggers."
              ]}
              cta="Import Markdown"
              onAction={() => fileInputRef.current?.click()}
              secondaryCta="Open Sources"
              onSecondaryAction={() => setActiveView("sources")}
            />
          )}
        </section>

        <aside className="research-panel research-rail-panel">
          <DensePanelHeader title="Triage Stack" subtitle="What needs attention next." />
          <div className="research-summary-list">
            <div>
              <strong>{documentsWithLinks.filter((doc) => doc.status === "unread").length}</strong>
              <span>Unread notes</span>
            </div>
            <div>
              <strong>{documentsWithLinks.filter((doc) => doc.status === "linked").length}</strong>
              <span>Linked to workflows</span>
            </div>
            <div>
              <strong>{reviewQueue.length}</strong>
              <span>Queued reviews</span>
            </div>
          </div>

          <div className="research-handoff-box">
            <strong>Next moves</strong>
            <span>Promote high-signal names into Theses, date-sensitive work into Catalysts, and finished thinking into Decisions.</span>
            <button type="button" onClick={() => setActiveView("review-queue")}>Open Review Queue</button>
            <button type="button" onClick={() => setActiveView("theses")}>Open Thesis Tracker</button>
          </div>
        </aside>
      </div>
    );
  }

  function renderReviewQueueView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Review Queue" subtitle="Stale theses, unresolved triggers, near-term catalysts, and unread notes." actions={<span className="research-pill">{reviewQueue.length} items</span>} />
          {reviewQueue.length ? (
            <div className="research-card-stack">
              {reviewQueue.map((item) => (
                <article key={item.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                    </div>
                    <span className="research-status-pill reviewed">{toSlugLabel(item.type)}</span>
                  </div>
                  <p>{item.detail}</p>
                  <div className="research-action-row">
                    <button type="button" className="research-btn secondary" onClick={item.onOpen}>{item.actionLabel}</button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Review Queue" title="Queue is clear" description="Unread notes, stale theses, and time-sensitive catalysts will surface here automatically." />
          )}
        </section>
      </div>
    );
  }

  function renderLibraryView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader
            title="Research Library"
            subtitle="Full note archive with provenance, status, and symbol links."
            actions={(
              <InlineControlGroup>
                <select value={activeSourceType} onChange={(event) => setActiveSourceType(event.target.value)} className="research-inline-select">
                  <option value="all">All sources</option>
                  {SOURCE_TYPES.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
                </select>
                <input className="research-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the library..." />
              </InlineControlGroup>
            )}
          />
          <div className="research-doc-table-wrap">
            <DataTable
              columns={[
                {
                  key: "title",
                  header: "Document",
                  sortable: false,
                  cell: (doc) => (
                    <div>
                      <button type="button" className="research-doc-title" onClick={() => setSelectedDocId(doc.id)}>
                        {doc.title}
                      </button>
                      <span>{doc.summary}</span>
                    </div>
                  ),
                },
                { key: "sourceType", header: "Source", sortable: false, cell: (doc) => doc.sourceName || inferSourceLabel(doc.sourceType) },
                { key: "status", header: "Status", sortable: false, cell: (doc) => <span className={`research-status-pill ${doc.status}`}>{toSlugLabel(doc.status)}</span> },
                {
                  key: "symbols",
                  header: "Tickers",
                  sortable: false,
                  cell: (doc) => (
                    <div className="research-symbol-row">
                      {(doc.symbols || ["Unlinked"]).slice(0, 6).map((symbol) => (
                        <span key={symbol} className={doc.linkedTrackedSymbols?.includes(symbol) ? "tracked" : ""}>{symbol}</span>
                      ))}
                    </div>
                  ),
                },
                { key: "updatedAt", header: "Updated", sortable: false, cell: (doc) => formatDateTime(doc.updatedAt) },
                {
                  key: "action",
                  header: "Action",
                  sortable: false,
                  cell: (doc) => <button type="button" className="research-link-btn" onClick={() => setSelectedDocId(doc.id)}>Review</button>,
                },
              ]}
              data={filteredDocuments}
              getRowId={(doc) => doc.id}
              className="research-doc-table"
            />
          </div>
        </section>
      </div>
    );
  }

  function renderTickersView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel research-ticker-list-panel">
          <DensePanelHeader title="Ticker Dossiers" subtitle="Research, catalysts, decisions, and live book context grouped by symbol." actions={<span className="research-pill">{tickerRows.length} tracked</span>} />
          {tickerRows.length ? (
            <div className="research-ticker-list">
              {tickerRows.map((row) => (
                <button
                  key={row.symbol}
                  type="button"
                  className={`research-ticker-row ${selectedTicker === row.symbol ? "active" : ""}`.trim()}
                  onClick={() => setSelectedTicker(row.symbol)}
                >
                  <div>
                    <strong>{row.symbol}</strong>
                    <span>{row.summary || "No note summary yet."}</span>
                  </div>
                  <div className="research-ticker-meta">
                    <em>{row.docCount} notes</em>
                    {row.exposure > 0 ? <span>{formatCurrency(row.exposure)}</span> : null}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Ticker dossiers" title="No symbols linked yet" description="Import notes with tickers or save a thesis to generate the first dossier." cta="Open Inbox" onAction={() => setActiveView("inbox")} />
          )}
        </section>

        <section className="research-panel">
          <DensePanelHeader
            title={selectedTickerRecord ? `${selectedTickerRecord.symbol} Dossier` : "Select a ticker"}
            subtitle={selectedTickerRecord ? `${selectedTickerRecord.docCount} research notes · ${selectedTickerRecord.upcomingCatalystCount} upcoming catalysts` : "Choose a symbol from the left rail."}
            actions={selectedTickerRecord ? (
              <InlineControlGroup>
                <button type="button" className="research-link-btn" onClick={() => primeTickerAction(selectedTickerRecord.symbol, "theses", "thesis")}>New Thesis</button>
                <button type="button" className="research-link-btn" onClick={() => primeTickerAction(selectedTickerRecord.symbol, "briefs", "brief")}>Generate Brief</button>
              </InlineControlGroup>
            ) : null}
          />
          {selectedTickerRecord ? (
            <div className="research-dossier-grid">
              <article className="research-dossier-card">
                <span>Current exposure</span>
                <strong>{selectedTickerRecord.exposure > 0 ? formatCurrency(selectedTickerRecord.exposure) : "No position"}</strong>
                <em>{selectedTickerRecord.exposure > 0 ? "Live capital tied to the current book." : "Not currently in portfolio."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Portfolio weight</span>
                <strong>{selectedTickerRecord.exposure > 0 ? formatPercent(selectedTickerRecord.weight) : "0.0%"}</strong>
                <em>{selectedTickerRecord.exposure > 0 ? "Weight versus total tracked portfolio value." : "No active allocation logged."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Coverage health</span>
                <strong>{selectedTickerRecord.coverageHealth.label}</strong>
                <em>{selectedTickerRecord.coverageHealth.score}/100 weighted coverage score.</em>
              </article>
              <article className="research-dossier-card">
                <span>Watchlist / book</span>
                <strong>{selectedTickerRecord.inWatchlist ? "In watchlist" : selectedTickerRecord.tracked ? "Tracked in book" : "Off-book"}</strong>
                <em>{selectedTickerRecord.tracked ? "Portfolio or watchlist linked" : "Research-only symbol so far"}</em>
              </article>
              <article className="research-dossier-card">
                <span>Unsupported by thesis</span>
                <strong>{selectedTickerRecord.unsupportedByThesis ? "Yes" : "No"}</strong>
                <em>{selectedTickerRecord.unsupportedByThesis ? "Tracked exposure still lacks an active thesis." : selectedTickerRecord.activeThesis ? `Backed by ${toSlugLabel(selectedTickerRecord.activeThesis.stage)}.` : "No live exposure conflict."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Thesis stale</span>
                <strong>{selectedTickerRecord.thesisStale ? "Yes" : "No"}</strong>
                <em>{selectedTickerRecord.activeThesis ? `Last thesis update ${formatDateOnly(selectedTickerRecord.activeThesis.updatedAt)}` : "No active thesis to age yet."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Catalyst due soon</span>
                <strong>{selectedTickerRecord.catalystDueSoon ? "Yes" : selectedTickerRecord.nextCatalyst ? "Scheduled" : "No catalyst"}</strong>
                <em>{selectedTickerRecord.nextCatalyst ? `${selectedTickerRecord.nextCatalyst.title} · ${formatDateOnly(selectedTickerRecord.nextCatalyst.eventDate)}` : "Add an event to keep timing explicit."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Trigger coverage</span>
                <strong>{selectedTickerRecord.activeTriggerCount} active</strong>
                <em>{selectedTickerTriggers[0] ? describeTriggerCondition(selectedTickerTriggers[0]) : "No trigger rules linked yet."}</em>
              </article>
              <article className="research-dossier-card">
                <span>Decision trail</span>
                <strong>{selectedTickerRecord.decisionCount} logged</strong>
                <em>{selectedTickerDecisions[0] ? `${toSlugLabel(selectedTickerDecisions[0].action)} · ${formatDateTime(selectedTickerDecisions[0].createdAt)}` : "No desk decision logged yet."}</em>
              </article>

              <div className="research-dossier-surface">
                <DensePanelHeader title="Linked Notes" subtitle="Most recent research touching this symbol." />
                <div className="research-mini-list">
                  {selectedTickerDocs.length ? selectedTickerDocs.slice(0, 5).map((doc) => (
                    <button key={doc.id} type="button" className="research-mini-row" onClick={() => setSelectedDocId(doc.id)}>
                      <strong>{doc.title}</strong>
                      <span>{doc.summary}</span>
                    </button>
                  )) : <span className="research-muted-copy">No notes linked to this symbol yet.</span>}
                </div>
              </div>

              <div className="research-dossier-surface">
                <DensePanelHeader title="Research State" subtitle="Theses, catalysts, triggers, decisions, and output coverage." actions={<button type="button" className="research-link-btn" onClick={() => primeTickerAction(selectedTicker, "triggers", "trigger")}>New Trigger</button>} />
                <div className="research-mini-list">
                  {selectedTickerTheses.slice(0, 2).map((item) => (
                    <div key={item.id} className="research-mini-row static">
                      <strong>{item.title}</strong>
                      <span>{toSlugLabel(item.stage)} · {toSlugLabel(item.priority)} priority · {describeDueState(item.dueDate)} · {item.owner}</span>
                    </div>
                  ))}
                  {selectedTickerCatalysts.slice(0, 2).map((item) => (
                    <div key={item.id} className="research-mini-row static">
                      <strong>{item.title}</strong>
                      <span>{formatDateOnly(item.eventDate)} · {toSlugLabel(item.type)} · {toSlugLabel(item.priority)} priority</span>
                    </div>
                  ))}
                  {selectedTickerTriggers.slice(0, 2).map((item) => (
                    <div key={item.id} className="research-mini-row static">
                      <strong>{toSlugLabel(item.actionType)} trigger</strong>
                      <span>{describeTriggerCondition(item)} · {toSlugLabel(item.priority)} priority · {describeDueState(item.dueDate)}</span>
                    </div>
                  ))}
                  {selectedTickerDecisions.slice(0, 2).map((item) => (
                    <div key={item.id} className="research-mini-row static">
                      <strong>{toSlugLabel(item.action)}</strong>
                      <span><ConvictionDots value={item.conviction} label={item.conviction} />{item.conviction} conviction · {toSlugLabel(item.priority)} priority · {describeDueState(item.dueDate)}</span>
                    </div>
                  ))}
                  {selectedTickerBriefs.slice(0, 1).map((item) => (
                    <div key={item.id} className="research-mini-row static">
                      <strong>{item.title}</strong>
                      <span>{BRIEF_TEMPLATES.find((brief) => brief.value === item.template)?.label || "Brief"} · {toSlugLabel(item.approvalState)} · {item.owner}</span>
                    </div>
                  ))}
                  {!selectedTickerTheses.length && !selectedTickerCatalysts.length && !selectedTickerTriggers.length && !selectedTickerDecisions.length && !selectedTickerBriefs.length ? (
                    <span className="research-muted-copy">No thesis, catalyst, trigger, decision, or brief history yet.</span>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="research-panel research-rail-panel">
          <DensePanelHeader title="Desk handoff" subtitle="Push the selected ticker into the next workflow." />
          <div className="research-handoff-box">
            <strong>Context links</strong>
            <span>Jump from dossier work back into portfolio and watchlist without losing the research thread.</span>
            <button type="button" onClick={onOpenPortfolio}>Open Portfolio context</button>
            <button type="button" onClick={onOpenWatchlist}>Open Watchlist context</button>
            {selectedTicker ? <button type="button" onClick={() => primeTickerAction(selectedTicker, "decisions", "decision")}>Log Decision</button> : null}
          </div>
        </aside>
      </div>
    );
  }

  function renderCoverageMapView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Coverage Map" subtitle="Research depth, thesis support, and portfolio linkage across all covered symbols." />
          {coverageRows.length ? (
            <div className="research-doc-table-wrap">
              <DataTable
                columns={[
                  {
                    key: "symbol",
                    header: "Symbol",
                    sortable: false,
                    cell: (row) => (
                      <div>
                        <button type="button" className="research-doc-title" onClick={() => { setSelectedTicker(row.symbol); setActiveView("tickers"); }}>
                          {row.symbol}
                        </button>
                        <span>{row.docCount} notes · {row.catalystCount} catalysts · {row.decisionCount} decisions</span>
                      </div>
                    ),
                  },
                  { key: "exposure", header: "Exposure", sortable: false, cell: (row) => row.exposure > 0 ? formatCurrency(row.exposure) : "—" },
                  { key: "weight", header: "Weight", sortable: false, cell: (row) => row.exposure > 0 ? formatPercent(row.weight) : "—" },
                  { key: "health", header: "Health", sortable: false, cell: (row) => `${row.coverageHealth.label} · ${row.coverageHealth.score}` },
                  { key: "researchDepth", header: "Research Depth", sortable: false },
                  { key: "thesisState", header: "Thesis", sortable: false },
                  {
                    key: "flags",
                    header: "Flags",
                    sortable: false,
                    cell: (row) => (
                      <div className="research-symbol-row">
                        {row.unsupportedByThesis ? <span className="tracked">Unsupported</span> : null}
                        {row.catalystDueSoon ? <span className="tracked">Catalyst soon</span> : null}
                        {row.thesisStale ? <span className="tracked">Thesis stale</span> : null}
                        {row.inWatchlist ? <span className="tracked">Watchlist</span> : null}
                      </div>
                    ),
                  },
                ]}
                data={coverageRows}
                getRowId={(row) => row.symbol}
                className="research-doc-table"
              />
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Coverage Map" title="No coverage yet" description="The map fills in automatically once notes, theses, or watchlist symbols exist." />
          )}
        </section>
      </div>
    );
  }

  function renderContradictionsView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Contradictions" subtitle="Find where the notes, thesis, decisions, and live exposure disagree." actions={<span className="research-pill">{contradictions.length} flags</span>} />
          {contradictions.length ? (
            <div className="research-card-stack">
              {contradictions.map((item) => (
                <article key={item.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{item.symbol} · {item.title}</strong>
                      <span>Research drift flag</span>
                    </div>
                    <button type="button" className="research-link-btn" onClick={item.onOpen}>{item.actionLabel}</button>
                  </div>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Contradictions" title="No active contradictions" description="When the thesis, catalysts, decisions, and exposure diverge, the drift will surface here." />
          )}
        </section>
      </div>
    );
  }

  function renderThesesView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Thesis Tracker" subtitle="Move ideas from watching, to active, to in-book, with explicit invalidation." />
          <div className="research-form-grid">
            <label>
              <span>Symbol</span>
              <input value={thesisDraft.symbol} onChange={(event) => setThesisDraft((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} placeholder="AAPL" />
            </label>
            <label>
              <span>Title</span>
              <input value={thesisDraft.title} onChange={(event) => setThesisDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="AAPL services resilience" />
            </label>
            <label>
              <span>Stage</span>
              <select value={thesisDraft.stage} onChange={(event) => setThesisDraft((prev) => ({ ...prev, stage: event.target.value }))}>
                {THESIS_STAGE_OPTIONS.map((stage) => <option key={stage} value={stage}>{toSlugLabel(stage)}</option>)}
              </select>
            </label>
            <label>
              <span>Conviction</span>
              <select value={thesisDraft.conviction} onChange={(event) => setThesisDraft((prev) => ({ ...prev, conviction: event.target.value }))}>
                {["Low", "Medium", "High"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select value={thesisDraft.owner} onChange={(event) => setThesisDraft((prev) => ({ ...prev, owner: event.target.value }))}>
                {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Coverage scope</span>
              <select value={thesisDraft.coverageScope} onChange={(event) => setThesisDraft((prev) => ({ ...prev, coverageScope: event.target.value }))}>
                {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={thesisDraft.priority} onChange={(event) => setThesisDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={thesisDraft.dueDate} onChange={(event) => setThesisDraft((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Summary</span>
              <textarea value={thesisDraft.summary} onChange={(event) => setThesisDraft((prev) => ({ ...prev, summary: event.target.value }))} rows={3} placeholder="Core view in one compact paragraph." />
            </label>
            <label className="wide">
              <span>Bull case</span>
              <textarea value={thesisDraft.bullCase} onChange={(event) => setThesisDraft((prev) => ({ ...prev, bullCase: event.target.value }))} rows={3} placeholder="What has to go right." />
            </label>
            <label className="wide">
              <span>Invalidation</span>
              <textarea value={thesisDraft.invalidation} onChange={(event) => setThesisDraft((prev) => ({ ...prev, invalidation: event.target.value }))} rows={2} placeholder="What changes your mind." />
            </label>
            <label className="wide">
              <span>Must play out</span>
              <textarea value={thesisDraft.mustPlayOut} onChange={(event) => setThesisDraft((prev) => ({ ...prev, mustPlayOut: event.target.value }))} rows={2} placeholder="What must happen for the setup to stay alive." />
            </label>
            <label className="wide">
              <span>Risk condition</span>
              <textarea value={thesisDraft.riskCondition} onChange={(event) => setThesisDraft((prev) => ({ ...prev, riskCondition: event.target.value }))} rows={2} placeholder="What desk or market condition should force a harder review." />
            </label>
          </div>
          <div className="research-action-row">
            <button type="button" className="research-btn primary" onClick={saveThesis}>{getEditingLabel("thesis")} Thesis</button>
            <button type="button" className="research-btn secondary" onClick={() => clearDrafts("thesis")}>Clear</button>
          </div>
        </section>

        <section className="research-panel">
          <DensePanelHeader title="Active Theses" subtitle="The live map of what the desk is actually working on." />
          {activeTheses.length ? (
            <div className="research-card-stack">
              {activeTheses.map((thesis) => (
                <article key={thesis.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{thesis.symbol} · {thesis.title}</strong>
                      <span>{toSlugLabel(thesis.stage)} · <ConvictionDots value={thesis.conviction} label={thesis.conviction} />{thesis.conviction} conviction · {toSlugLabel(thesis.coverageScope)} · {toSlugLabel(thesis.priority)} priority · {thesis.owner}</span>
                    </div>
                    <div className="research-inline-pills">
                      <span className={`research-status-pill ${thesis.recordState === "resolved" ? "reviewed" : thesis.recordState === "archived" ? "archived" : "linked"}`}>{toSlugLabel(thesis.recordState)}</span>
                      <button type="button" className="research-symbol-chip" onClick={() => { setSelectedTicker(thesis.symbol); setActiveView("tickers"); }}>Dossier</button>
                    </div>
                  </div>
                  <p>{thesis.summary || "No thesis summary logged yet."}</p>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Bull case</span>
                      <strong>{thesis.bullCase || "Not logged yet."}</strong>
                    </div>
                    <div>
                      <span>Invalidation</span>
                      <strong>{thesis.invalidation || "Not logged yet."}</strong>
                    </div>
                  </div>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Must play out</span>
                      <strong>{thesis.mustPlayOut || "Not logged yet."}</strong>
                    </div>
                    <div>
                      <span>Priority / due</span>
                      <strong>{toSlugLabel(thesis.priority)} · {describeDueState(thesis.dueDate)}</strong>
                    </div>
                  </div>
                  <ResearchObjectControls
                    state={thesis.recordState}
                    onEdit={() => beginEdit("thesis", thesis)}
                    onDuplicate={() => duplicateEntity("thesis", thesis)}
                    onResolve={() => setEntityState("thesis", thesis, "resolved")}
                    onArchive={() => setEntityState("thesis", thesis, "archived")}
                  />
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Thesis tracker" title="No theses yet" description="Promote the strongest research from Inbox into a living thesis so the desk can see the actual view, not just the raw notes." />
          )}
        </section>
      </div>
    );
  }

  function renderCatalystsView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Catalyst Calendar" subtitle="Date-sensitive research, earnings, macro prints, product events, and filing checkpoints." />
          <div className="research-form-grid">
            <label>
              <span>Symbol</span>
              <input value={catalystDraft.symbol} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} placeholder="NVDA" />
            </label>
            <label>
              <span>Title</span>
              <input value={catalystDraft.title} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Q3 earnings" />
            </label>
            <label>
              <span>Type</span>
              <select value={catalystDraft.type} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, type: event.target.value }))}>
                {CATALYST_TYPES.map((type) => <option key={type} value={type}>{toSlugLabel(type)}</option>)}
              </select>
            </label>
            <label>
              <span>Date</span>
              <input type="date" value={catalystDraft.eventDate} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, eventDate: event.target.value }))} />
            </label>
            <label>
              <span>Status</span>
              <select value={catalystDraft.status} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, status: event.target.value }))}>
                {CATALYST_STATUS_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select value={catalystDraft.owner} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, owner: event.target.value }))}>
                {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Coverage scope</span>
              <select value={catalystDraft.coverageScope} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, coverageScope: event.target.value }))}>
                {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={catalystDraft.priority} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={catalystDraft.dueDate} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Note</span>
              <textarea value={catalystDraft.note} onChange={(event) => setCatalystDraft((prev) => ({ ...prev, note: event.target.value }))} rows={3} placeholder="Why the event matters and what would change after it prints." />
            </label>
          </div>
          <div className="research-action-row">
            <button type="button" className="research-btn primary" onClick={saveCatalyst}>{getEditingLabel("catalyst")} Catalyst</button>
            <button type="button" className="research-btn secondary" onClick={() => clearDrafts("catalyst")}>Clear</button>
          </div>
        </section>

        <section className="research-panel">
          <DensePanelHeader title="Upcoming Catalysts" subtitle="What the desk says matters next." />
          {upcomingCatalysts.length ? (
            <div className="research-card-stack">
              {upcomingCatalysts.map((item) => (
                <article key={item.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{item.symbol} · {item.title}</strong>
                      <span>{formatDateOnly(item.eventDate)} · {toSlugLabel(item.type)} · {toSlugLabel(item.coverageScope)} · {toSlugLabel(item.priority)} priority · {item.owner}</span>
                    </div>
                    <span className={`research-status-pill ${item.recordState === "resolved" ? "reviewed" : "linked"}`}>{toSlugLabel(item.recordState)}</span>
                  </div>
                  <p>{item.note || "No supporting note yet."}</p>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Due state</span>
                      <strong>{describeDueState(item.dueDate || item.eventDate)}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong>{toSlugLabel(item.status)}</strong>
                    </div>
                  </div>
                  <ResearchObjectControls
                    state={item.recordState}
                    onEdit={() => beginEdit("catalyst", item)}
                    onDuplicate={() => duplicateEntity("catalyst", item)}
                    onResolve={() => setEntityState("catalyst", item, "resolved")}
                    onArchive={() => setEntityState("catalyst", item, "archived")}
                  />
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Catalyst calendar" title="No catalysts yet" description="Use catalysts to time the thesis rather than relying on memory or scattered notes." />
          )}
        </section>
      </div>
    );
  }

  function renderTriggersView() {
    const selectedConditionMeta = TRIGGER_CONDITION_OPTIONS.find((condition) => condition.value === triggerDraft.conditionType) || TRIGGER_CONDITION_OPTIONS[0];
    const linkedThesisOptions = normalizedTheses.filter((item) => !triggerDraft.symbol || item.symbol === triggerDraft.symbol);
    const linkedCatalystOptions = normalizedCatalysts.filter((item) => !triggerDraft.symbol || item.symbol === triggerDraft.symbol);
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Trigger Desk" subtitle="Wire research into review, increase, reduce, and risk-monitoring rules." />
          <div className="research-form-grid">
            <label>
              <span>Symbol</span>
              <input value={triggerDraft.symbol} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} placeholder="NVDA" />
            </label>
            <label>
              <span>Scope</span>
              <select value={triggerDraft.scopeType} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, scopeType: event.target.value }))}>
                {TRIGGER_SCOPE_OPTIONS.map((scope) => <option key={scope} value={scope}>{toSlugLabel(scope)}</option>)}
              </select>
            </label>
            <label>
              <span>Action</span>
              <select value={triggerDraft.actionType} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, actionType: event.target.value }))}>
                {TRIGGER_ACTIONS.map((action) => <option key={action} value={action}>{toSlugLabel(action)}</option>)}
              </select>
            </label>
            <label>
              <span>Condition</span>
              <select value={triggerDraft.conditionType} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, conditionType: event.target.value }))}>
                {TRIGGER_CONDITION_OPTIONS.map((condition) => <option key={condition.value} value={condition.value}>{condition.label}</option>)}
              </select>
            </label>
            <label>
              <span>{selectedConditionMeta.thresholdLabel}</span>
              <input type="number" value={triggerDraft.thresholdValue} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, thresholdValue: event.target.value }))} placeholder={selectedConditionMeta.value === "catalyst_within_days" ? "3" : selectedConditionMeta.value === "position_weight_above" ? "12" : "180"} />
            </label>
            <label>
              <span>Cooldown (hours)</span>
              <input type="number" min="1" value={triggerDraft.cooldownHours} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, cooldownHours: event.target.value }))} placeholder="24" />
            </label>
            <label>
              <span>Linked thesis</span>
              <select value={triggerDraft.linkedThesisId} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, linkedThesisId: event.target.value }))}>
                <option value="">No thesis selected</option>
                {linkedThesisOptions.map((thesis) => <option key={thesis.id} value={thesis.id}>{thesis.symbol} · {thesis.title}</option>)}
              </select>
            </label>
            <label>
              <span>Linked catalyst</span>
              <select value={triggerDraft.linkedCatalystId} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, linkedCatalystId: event.target.value }))}>
                <option value="">No catalyst selected</option>
                {linkedCatalystOptions.map((catalyst) => <option key={catalyst.id} value={catalyst.id}>{catalyst.symbol} · {catalyst.title}</option>)}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select value={triggerDraft.status} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, status: event.target.value }))}>
                {["active", "paused", "archived"].map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select value={triggerDraft.owner} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, owner: event.target.value }))}>
                {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Coverage scope</span>
              <select value={triggerDraft.coverageScope} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, coverageScope: event.target.value }))}>
                {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={triggerDraft.priority} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={triggerDraft.dueDate} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Trigger title</span>
              <input value={triggerDraft.title} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Trim NVDA if weight exceeds 12%" />
            </label>
            <label className="wide">
              <span>Why this matters</span>
              <textarea value={triggerDraft.rationale} onChange={(event) => setTriggerDraft((prev) => ({ ...prev, rationale: event.target.value }))} rows={3} placeholder="Tie the rule back to the thesis, risk, or catalyst timing so it remains understandable when the signal fires." />
            </label>
          </div>
          <div className="research-action-row">
            <span className="research-muted-copy">{selectedConditionMeta.thresholdHint}</span>
            <button type="button" className="research-btn primary" onClick={saveTrigger}>{getEditingLabel("trigger")} Trigger</button>
            <button type="button" className="research-btn secondary" onClick={() => clearDrafts("trigger")}>Clear</button>
          </div>
        </section>

        <section className="research-panel">
          <DensePanelHeader title="Active Triggers" subtitle="These rules feed Home Signal Tape when the live condition is met." />
          {activeTriggers.length ? (
            <div className="research-card-stack">
              {activeTriggers.map((trigger) => (
                <article key={trigger.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{trigger.title}</strong>
                      <span>{trigger.symbol || "Portfolio"} · {toSlugLabel(trigger.actionType)} · {toSlugLabel(trigger.coverageScope)} · {toSlugLabel(trigger.priority)} priority · {trigger.owner}</span>
                    </div>
                    <div className="research-inline-pills">
                      <span className={`research-status-pill ${trigger.recordState === "resolved" ? "reviewed" : trigger.recordState === "archived" ? "archived" : "linked"}`}>{toSlugLabel(trigger.recordState)}</span>
                      {trigger.symbol ? <button type="button" className="research-symbol-chip" onClick={() => { setSelectedTicker(trigger.symbol); setActiveView("tickers"); }}>Dossier</button> : null}
                    </div>
                  </div>
                  <p>{trigger.rationale || "No rationale logged."}</p>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Condition</span>
                      <strong>{describeTriggerCondition(trigger)}</strong>
                    </div>
                    <div>
                      <span>Cooldown</span>
                      <strong>{trigger.cooldownHours}h · {trigger.lastTriggeredAt ? `Last fired ${formatDateTime(trigger.lastTriggeredAt)}` : "Not fired yet"}</strong>
                    </div>
                  </div>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Due state</span>
                      <strong>{describeDueState(trigger.dueDate)}</strong>
                    </div>
                    <div>
                      <span>Status</span>
                      <strong>{toSlugLabel(trigger.status)}</strong>
                    </div>
                  </div>
                  <ResearchObjectControls
                    state={trigger.recordState}
                    onEdit={() => beginEdit("trigger", trigger)}
                    onDuplicate={() => duplicateEntity("trigger", trigger)}
                    onResolve={() => setEntityState("trigger", trigger, "resolved")}
                    onArchive={() => setEntityState("trigger", trigger, "archived")}
                  />
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Trigger desk" title="No triggers wired yet" description="Create a rule from a thesis or catalyst so the desk gets an actionable signal instead of relying on memory." steps={["Set a price, catalyst-timing, or weight threshold.", "Link the rule to a thesis or catalyst when possible.", "Review it from Home Signal Tape when it fires."]} />
          )}
        </section>
      </div>
    );
  }

  function renderSourcesView() {
    const readinessGroups = ["connected", "tracked_only", "import_only", "coming_next"].map((key) => ({
      key,
      label: toSlugLabel(key),
      items: sources.filter((source) => deriveSourceReadiness(source).key === key)
    }));

    return (
      <div className="research-view-grid">
        <aside className="research-panel research-source-panel">
          <DensePanelHeader title="Sources" subtitle="Connector honesty first. Don’t make the user guess what is actually live." actions={<span className="research-pill">{sources.length} sources</span>} />
          <div className="research-source-cards">
            {SOURCE_TYPES.map((source) => (
              <article key={source.type} className={`research-source-card ${source.type}`}>
                <div>
                  <span>{source.readinessLabel}</span>
                  <strong>{source.label}</strong>
                </div>
                <p>{source.description}</p>
              </article>
            ))}
          </div>

          <div className="research-source-form">
            <label>
              <span>Source type</span>
              <select value={sourceDraft.type} onChange={(event) => setSourceDraft((prev) => ({ ...prev, type: event.target.value }))}>
                {SOURCE_TYPES.map((source) => <option key={source.type} value={source.type}>{source.label}</option>)}
              </select>
            </label>
            <label>
              <span>Name</span>
              <input value={sourceDraft.name} onChange={(event) => setSourceDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Q2 earnings notes" />
            </label>
            <label>
              <span>Source URL or vault note</span>
              <input value={sourceDraft.url} onChange={(event) => setSourceDraft((prev) => ({ ...prev, url: event.target.value }))} placeholder="Notion page URL, vault path, or reference" />
            </label>
            <button type="button" className="research-btn secondary full" onClick={addSource}>
              {sourceDraft.type === "notion" ? "Track Notion source" : sourceDraft.type === "obsidian" ? "Track vault source" : "Add source"}
            </button>
          </div>
        </aside>

        <section className="research-panel">
          <DensePanelHeader title="Readiness Map" subtitle="Connected, tracked-only, import-only, and truly not-live-yet surfaces." />
          <div className="research-honesty-grid">
            {readinessGroups.map((group) => (
              <article key={group.key} className="research-dossier-surface">
                <DensePanelHeader title={group.label} subtitle={`${group.items.length} source${group.items.length === 1 ? "" : "s"}`} />
                {group.items.length ? (
                  <div className="research-mini-list">
                    {group.items.map((source) => (
                      <div key={source.id} className="research-mini-row static">
                        <strong>{source.name}</strong>
                        <span>{inferSourceLabel(source.type)} · {toSlugLabel(deriveSourceReadiness(source).key)} · {source.syncMode} · {source.documentCount || 0} docs · {source.lastSyncedAt ? `Last sync ${formatDateTime(source.lastSyncedAt)}` : "Never synced"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="research-muted-copy">No sources in this readiness state yet.</span>
                )}
              </article>
            ))}
          </div>

          <div className="research-obsidian-box">
            <strong>Obsidian Local REST</strong>
            <label>
              <span>Endpoint</span>
              <input value={obsidianConfig.endpoint} onChange={(event) => setObsidianConfig((prev) => ({ ...prev, endpoint: event.target.value }))} placeholder="Paste your local endpoint" />
            </label>
            <label>
              <span>API key</span>
              <input type="password" value={obsidianConfig.token} onChange={(event) => setObsidianConfig((prev) => ({ ...prev, token: event.target.value }))} placeholder="Stored locally only" />
            </label>
            <button type="button" className="research-btn secondary full" onClick={fetchActiveObsidianNote} disabled={isSyncingObsidian}>
              {isSyncingObsidian ? "Reading active note..." : "Import active note"}
            </button>
          </div>
        </section>
      </div>
    );
  }

  function renderBriefsView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Brief Builder" subtitle="Turn notes, theses, catalysts, and desk decisions into actual outputs." />
          <div className="research-form-grid">
            <label>
              <span>Symbol</span>
              <input value={briefDraft.symbol} onChange={(event) => setBriefDraft((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} placeholder="SPY or leave blank for desk-wide" />
            </label>
            <label>
              <span>Output mode</span>
              <select value={briefDraft.template} onChange={(event) => setBriefDraft((prev) => ({ ...prev, template: event.target.value }))}>
                {BRIEF_TEMPLATES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select value={briefDraft.owner} onChange={(event) => setBriefDraft((prev) => ({ ...prev, owner: event.target.value }))}>
                {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Coverage scope</span>
              <select value={briefDraft.coverageScope} onChange={(event) => setBriefDraft((prev) => ({ ...prev, coverageScope: event.target.value }))}>
                {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={briefDraft.priority} onChange={(event) => setBriefDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={briefDraft.dueDate} onChange={(event) => setBriefDraft((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label>
              <span>Approval state</span>
              <select value={briefDraft.approvalState} onChange={(event) => setBriefDraft((prev) => ({ ...prev, approvalState: event.target.value }))}>
                {BRIEF_APPROVAL_STATES.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label className="wide">
              <span>Title</span>
              <input value={briefDraft.title} onChange={(event) => setBriefDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Morning macro risk pack" />
            </label>
            <label className="wide">
              <span>Commentary</span>
              <textarea value={briefDraft.commentary} onChange={(event) => setBriefDraft((prev) => ({ ...prev, commentary: event.target.value }))} rows={3} placeholder="Add the desk framing, distribution context, or PM angle before generating the output." />
            </label>
          </div>
          <div className="research-action-row">
            <button type="button" className="research-btn primary" onClick={generateBrief}>{getEditingLabel("brief")} Brief</button>
            <button type="button" className="research-btn secondary" onClick={() => clearDrafts("brief")}>Clear</button>
          </div>

          {selectedBrief ? (
            <div className="research-brief-preview">
              <DensePanelHeader
                title={selectedBrief.title}
                subtitle={`${selectedBrief.symbol || "Desk-wide"} · ${formatDateTime(selectedBrief.updatedAt)} · ${selectedBrief.owner}`}
                actions={<span className="research-pill">{toSlugLabel(selectedBrief.approvalState)}</span>}
              />
              <div className="research-form-grid">
                <label>
                  <span>Title</span>
                  <input value={selectedBrief.title} onChange={(event) => updateSelectedBriefField("title", event.target.value)} />
                </label>
                <label>
                  <span>Output mode</span>
                  <select value={selectedBrief.template} onChange={(event) => updateSelectedBriefField("template", event.target.value)}>
                    {BRIEF_TEMPLATES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Owner</span>
                  <select value={selectedBrief.owner} onChange={(event) => updateSelectedBriefField("owner", event.target.value)}>
                    {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  <span>Approval state</span>
                  <select value={selectedBrief.approvalState} onChange={(event) => updateSelectedBriefField("approvalState", event.target.value)}>
                    {BRIEF_APPROVAL_STATES.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select value={selectedBrief.priority} onChange={(event) => updateSelectedBriefField("priority", event.target.value)}>
                    {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
                  </select>
                </label>
                <label>
                  <span>Due date</span>
                  <input type="date" value={selectedBrief.dueDate || ""} onChange={(event) => updateSelectedBriefField("dueDate", event.target.value)} />
                </label>
                <label>
                  <span>Coverage scope</span>
                  <select value={selectedBrief.coverageScope} onChange={(event) => updateSelectedBriefField("coverageScope", event.target.value)}>
                    {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
                  </select>
                </label>
                <label className="wide">
                  <span>Commentary</span>
                  <textarea value={selectedBrief.commentary || ""} onChange={(event) => updateSelectedBriefField("commentary", event.target.value)} rows={3} />
                </label>
              </div>
              <div className="research-brief-section-grid">
                {BRIEF_SECTION_ORDER.map((sectionTitle) => {
                  const section = selectedBrief.sections.find((item) => item.title === sectionTitle);
                  if (!section) return null;
                  return (
                    <article key={sectionTitle} className="research-brief-section">
                      <strong>{section.title}</strong>
                      <textarea value={section.body} onChange={(event) => updateSelectedBriefSection(sectionTitle, event.target.value)} rows={section.title === "Commentary" ? 6 : 8} />
                    </article>
                  );
                })}
              </div>
              <div className="research-action-row">
                <button type="button" className="research-btn primary" onClick={() => saveSelectedBriefEdits(selectedBrief)}>Save edits</button>
                <span className="research-muted-copy">{toSlugLabel(selectedBrief.template)} · {toSlugLabel(selectedBrief.priority)} priority · {describeDueState(selectedBrief.dueDate)}</span>
              </div>
              <ResearchObjectControls
                state={selectedBrief.recordState}
                onEdit={() => beginEdit("brief", selectedBrief)}
                onDuplicate={() => duplicateEntity("brief", selectedBrief)}
                onResolve={() => setEntityState("brief", selectedBrief, "resolved")}
                onArchive={() => setEntityState("brief", selectedBrief, "archived")}
              />
            </div>
          ) : null}
        </section>

        <aside className="research-panel research-rail-panel">
          <DensePanelHeader title="Saved Briefs" subtitle="Desk memo, investor update, and PM review outputs." />
          {normalizedBriefs.length ? (
            <div className="research-mini-list">
              {normalizedBriefs.map((brief) => (
                <button key={brief.id} type="button" className={`research-mini-row ${selectedBriefId === brief.id ? "active" : ""}`.trim()} onClick={() => setSelectedBriefId(brief.id)}>
                  <strong>{brief.title}</strong>
                  <span>{brief.symbol || "Desk-wide"} · {BRIEF_TEMPLATES.find((item) => item.value === brief.template)?.label} · {toSlugLabel(brief.approvalState)}</span>
                </button>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Briefs" title="No saved briefs yet" description="Generate a desk memo, investor update, or PM review once a symbol has notes, catalysts, or a thesis." />
          )}
        </aside>
      </div>
    );
  }

  function renderDecisionsView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Decision Log" subtitle="Record what the desk did, why it did it, and which thesis supported the move." />
          <div className="research-form-grid">
            <label>
              <span>Symbol</span>
              <input value={decisionDraft.symbol} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, symbol: event.target.value.toUpperCase() }))} placeholder="BTC" />
            </label>
            <label>
              <span>Action</span>
              <select value={decisionDraft.action} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, action: event.target.value }))}>
                {DECISION_ACTIONS.map((action) => <option key={action} value={action}>{toSlugLabel(action)}</option>)}
              </select>
            </label>
            <label>
              <span>Conviction</span>
              <select value={decisionDraft.conviction} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, conviction: event.target.value }))}>
                {["Low", "Medium", "High"].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Linked thesis</span>
              <select value={decisionDraft.thesisId} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, thesisId: event.target.value }))}>
                <option value="">No thesis selected</option>
                {normalizedTheses.map((thesis) => <option key={thesis.id} value={thesis.id}>{thesis.symbol} · {thesis.title}</option>)}
              </select>
            </label>
            <label>
              <span>Owner</span>
              <select value={decisionDraft.owner} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, owner: event.target.value }))}>
                {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              <span>Coverage scope</span>
              <select value={decisionDraft.coverageScope} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, coverageScope: event.target.value }))}>
                {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select value={decisionDraft.priority} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                {PRIORITY_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
              </select>
            </label>
            <label>
              <span>Due date</span>
              <input type="date" value={decisionDraft.dueDate} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label className="wide">
              <span>Rationale</span>
              <textarea value={decisionDraft.rationale} onChange={(event) => setDecisionDraft((prev) => ({ ...prev, rationale: event.target.value }))} rows={4} placeholder="What changed, what was sized, and what still needs confirmation." />
            </label>
          </div>
          <div className="research-action-row">
            <button type="button" className="research-btn primary" onClick={saveDecision}>{getEditingLabel("decision")} Decision</button>
            <button type="button" className="research-btn secondary" onClick={() => clearDrafts("decision")}>Clear</button>
          </div>
        </section>

        <section className="research-panel">
          <DensePanelHeader title="Decision History" subtitle="A desk-readable audit trail tied back to symbols and thesis work." />
          {latestDecisions.length ? (
            <div className="research-card-stack">
              {latestDecisions.map((decision) => (
                <article key={decision.id} className="research-inbox-card">
                  <div className="research-inbox-head">
                    <div>
                      <strong>{decision.symbol} · {toSlugLabel(decision.action)}</strong>
                      <span><ConvictionDots value={decision.conviction} label={decision.conviction} />{decision.conviction} conviction · {toSlugLabel(decision.coverageScope)} · {toSlugLabel(decision.priority)} priority · {formatDateTime(decision.createdAt)} · {decision.owner}</span>
                    </div>
                    <button type="button" className="research-symbol-chip" onClick={() => { setSelectedTicker(decision.symbol); setActiveView("tickers"); }}>Dossier</button>
                  </div>
                  <p>{decision.rationale}</p>
                  <div className="research-thesis-foot">
                    <div>
                      <span>Due state</span>
                      <strong>{describeDueState(decision.dueDate)}</strong>
                    </div>
                    <div>
                      <span>Linked thesis</span>
                      <strong>{decision.thesisId ? "Attached" : "No thesis linked"}</strong>
                    </div>
                  </div>
                  <ResearchObjectControls
                    state={decision.recordState}
                    onEdit={() => beginEdit("decision", decision)}
                    onDuplicate={() => duplicateEntity("decision", decision)}
                    onResolve={() => setEntityState("decision", decision, "resolved")}
                    onArchive={() => setEntityState("decision", decision, "archived")}
                  />
                </article>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Decision log" title="No desk decisions recorded" description="Log decisions here so research and follow-up reviews stay connected over time." />
          )}
        </section>
      </div>
    );
  }

  function renderTemplatesView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Templates" subtitle="Reusable thesis, trigger, catalyst, and brief starting points by asset class." />
          <div className="research-template-grid">
            {TEMPLATE_LIBRARY.map((template) => (
              <article key={template.id} className="research-dossier-card">
                <span>{toSlugLabel(template.category)}</span>
                <strong>{template.label}</strong>
                <em>{template.description}</em>
                <div className="research-action-row">
                  <button type="button" className="research-btn secondary" onClick={() => applyTemplate(template)}>Use template</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderOwnershipView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader
            title="Ownership"
            subtitle="Who owns the thesis, trigger, catalyst, decision, or brief in small-team workflows."
            actions={(
              <InlineControlGroup>
                <select value={ownershipMode} onChange={(event) => setOwnershipMode(event.target.value)} className="research-inline-select">
                  <option value="mine">My items</option>
                  <option value="all">All items</option>
                </select>
                <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="research-inline-select">
                  {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </InlineControlGroup>
            )}
          />
          {ownershipRows.length ? (
            <div className="research-ownership-list">
              {ownershipRows.map((row) => (
                <div key={`${row.kind}-${row.id}`} className="research-ownership-row">
                  <div>
                    <strong>{row.kind} · {row.label}</strong>
                    <span>{toSlugLabel(row.state)} · {toSlugLabel(row.item.priority || "medium")} priority · {describeDueState(row.item.dueDate)}</span>
                  </div>
                  <div className="research-ownership-actions">
                    {isOverdue(row.item.dueDate, row.state) ? <span className="research-status-pill archived">Overdue</span> : null}
                    <select value={row.owner} onChange={(event) => updateOwner(row.kind, row.id, event.target.value)}>
                      {OWNER_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Ownership" title="Nothing assigned yet" description="Owners will appear here as soon as the desk starts creating theses, catalysts, triggers, decisions, and briefs." />
          )}
        </section>
      </div>
    );
  }

  function renderTimelineView() {
    return (
      <div className="research-view-grid research-view-grid-wide">
        <section className="research-panel">
          <DensePanelHeader title="Timeline" subtitle="A chronological stream of notes, thesis changes, triggers, decisions, and briefs." />
          {timelineRows.length ? (
            <div className="research-timeline-list">
              {timelineRows.slice(0, 80).map((row) => (
                <div key={row.id} className="research-timeline-row">
                  <span>{formatDateTime(row.at)}</span>
                  <div>
                    <strong>{row.kind} · {row.title}</strong>
                    <em>{row.subtitle}</em>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <GuidedEmptyState eyebrow="Timeline" title="No activity yet" description="As notes, theses, catalysts, triggers, decisions, and briefs are created, the desk timeline will fill in." />
          )}
        </section>
      </div>
    );
  }

  function renderActiveView() {
    if (activeView === "inbox") return renderInboxView();
    if (activeView === "review-queue") return renderReviewQueueView();
    if (activeView === "library") return renderLibraryView();
    if (activeView === "tickers") return renderTickersView();
    if (activeView === "coverage-map") return renderCoverageMapView();
    if (activeView === "contradictions") return renderContradictionsView();
    if (activeView === "theses") return renderThesesView();
    if (activeView === "catalysts") return renderCatalystsView();
    if (activeView === "triggers") return renderTriggersView();
    if (activeView === "sources") return renderSourcesView();
    if (activeView === "briefs") return renderBriefsView();
    if (activeView === "decisions") return renderDecisionsView();
    if (activeView === "templates") return renderTemplatesView();
    if (activeView === "ownership") return renderOwnershipView();
    if (activeView === "timeline") return renderTimelineView();
    return renderInboxView();
  }

  return (
    <section className="research-workspace">
      <CompactPageHeader
        eyebrow="Research"
        title="Research Terminal"
        description="Turn source-backed notes into theses, catalysts, triggers, briefs, and decisions without leaving the desk."
        meta={<span>{backendMeta}</span>}
        actions={(
          <InlineControlGroup>
            <button type="button" className="research-btn secondary" onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <button type="button" className="research-btn primary" onClick={() => persistResearchBundle({}, "Research workspace saved.")} disabled={isSaving}>
              {isSaving ? "Saving..." : saveLabel}
            </button>
          </InlineControlGroup>
        )}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt"
        multiple
        className="research-file-input"
        onChange={handleMarkdownFiles}
      />

      <MetricStrip items={metrics} className="research-metric-strip" />

      {notice ? (
        <div className="research-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      ) : null}

      <div className="research-guidance-banner" role="note">
        <strong>Desk Flow</strong>
        <span>Intake → review → coverage → conviction → handoff.</span>
      </div>

      {renderViewTabs()}
      {renderActiveView()}

      <RightRailDrawer
        open={Boolean(selectedDoc)}
        onClose={() => setSelectedDocId(null)}
        title={selectedDoc?.title}
        subtitle={selectedDoc ? `${selectedDoc.sourceName || inferSourceLabel(selectedDoc.sourceType)} · ${formatDateTime(selectedDoc.updatedAt)}` : ""}
        actions={selectedDoc ? (
          <div className="research-drawer-actions">
            <button type="button" className="research-link-btn" onClick={() => updateDocumentStatus(selectedDoc.id, "linked")}>Mark Linked</button>
            <button type="button" className="research-btn danger" onClick={() => removeDocument(selectedDoc.id)}>Remove</button>
          </div>
        ) : null}
        className="research-document-drawer"
      >
        {selectedDoc ? (
          <div className="research-document-detail">
            {pendingPromotion.docId === selectedDoc.id ? (
              <div className="research-promotion-box">
                <strong>{toSlugLabel(pendingPromotion.draftType)} promotion</strong>
                <span>Choose the right research scope and primary symbol before promoting this multi-name note.</span>
                <div className="research-form-grid">
                  <label>
                    <span>Coverage scope</span>
                    <select value={pendingPromotion.scope} onChange={(event) => setPendingPromotion((prev) => ({ ...prev, scope: event.target.value }))}>
                      {COVERAGE_SCOPE_OPTIONS.map((value) => <option key={value} value={value}>{toSlugLabel(value)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Primary symbol</span>
                    <select value={pendingPromotion.targetSymbol} onChange={(event) => setPendingPromotion((prev) => ({ ...prev, targetSymbol: event.target.value }))}>
                      {(selectedDoc.symbols || []).map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
                    </select>
                  </label>
                </div>
                <div className="research-action-row">
                  <button type="button" className="research-btn primary" onClick={() => continueDocumentPromotion(selectedDoc, pendingPromotion.draftType, pendingPromotion.scope, pendingPromotion.targetSymbol)}>
                    Continue promotion
                  </button>
                  <button type="button" className="research-btn secondary" onClick={() => setPendingPromotion({ docId: "", draftType: "", scope: "single_name", targetSymbol: "" })}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div className="research-detail-symbols">
              {(Array.isArray(selectedDoc.symbols) && selectedDoc.symbols.length ? selectedDoc.symbols : ["Unlinked"]).map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  className="research-symbol-chip"
                  onClick={() => {
                    setSelectedTicker(symbol);
                    setActiveView("tickers");
                    setSelectedDocId(null);
                  }}
                >
                  {symbol}
                </button>
              ))}
            </div>
            <div className="research-action-row">
              {DOC_STATUS_OPTIONS.map((status) => (
                <button key={status} type="button" className={`research-link-btn ${selectedDoc.status === status ? "active" : ""}`.trim()} onClick={() => updateDocumentStatus(selectedDoc.id, status)}>
                  {toSlugLabel(status)}
                </button>
              ))}
              <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(selectedDoc, "thesis")}>Promote to Thesis</button>
              <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(selectedDoc, "trigger")}>Create Trigger</button>
              <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(selectedDoc, "catalyst")}>Add Catalyst</button>
              <button type="button" className="research-link-btn" onClick={() => requestDocumentPromotion(selectedDoc, "decision")}>Log Decision</button>
              <button
                type="button"
                className="research-link-btn primary"
                disabled={promotingDecisionThread}
                onClick={() => promoteDocToDecisionThread(selectedDoc)}
              >
                {promotingDecisionThread ? "Promoting…" : "Promote to Decision Thread"}
              </button>
            </div>
            {selectedDoc.url ? <a href={selectedDoc.url} target="_blank" rel="noreferrer">Open source reference</a> : null}
            <pre>{selectedDoc.body || selectedDoc.summary}</pre>
          </div>
        ) : null}
      </RightRailDrawer>
    </section>
  );
}

export default ResearchModule;
