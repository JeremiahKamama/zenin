// UpcomingEvents2 — Global Market Calendar (spec §10–§16).
//
// Replaces the simple Upcoming Events list with a true market calendar:
//   • G7 country coverage (filter by country)
//   • Event categories (Macro / Central Banks / Commodity / Energy / Agriculture
//     / FX / Corporate / Crypto / Government / Bond Auctions / ETF)
//   • Filter bar: All / Macro / Corporate / Commodity / FX / Crypto / Country /
//     Importance / Today / Week / Month
//   • Today / Tomorrow / This Week grouping with countdown
//   • Each event: date, title, time, importance, affected assets, Open Workspace
//   • Earnings sub-list (real /earnings-calendar data)
//
// Honest data handling: categories are derived from each event's fields/title
// keywords; events without a recognized country default to "US". Commodity and
// Crypto calendar feeds are NOT fabricated — if the upstream feed provides them
// they appear under their category; otherwise those filter buckets are simply
// empty (the panel explains the feed).

import { useEffect, useMemo, useRef, useState } from "react";

const G7 = ["US", "CA", "GB", "DE", "FR", "IT", "JP"];
const COUNTRY_NAMES = { US: "United States", CA: "Canada", GB: "United Kingdom", DE: "Germany", FR: "France", IT: "Italy", JP: "Japan" };
const FLAGS = { US: "🇺🇸", CA: "🇨🇦", GB: "🇬🇧", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", JP: "🇯🇵" };
const CATEGORY_GROUPS = [
  { label: "Macro & policy", items: ["Macro", "Central Banks", "Government", "Bond Auctions"] },
  { label: "Markets", items: ["FX", "Commodity", "Energy", "Agriculture", "ETF"] },
  { label: "Other", items: ["Corporate", "Crypto", "Weather", "Shipping"] },
];

const CATEGORY_KEYWORDS = [
  { cat: "Central Banks", kw: ["fed", "ecb", "boe", "boj", "rate decision", "speech", "powell", "lagarde", "bailey", "ueda"] },
  { cat: "Commodity", kw: ["opec", "eia", "api", "crude", "oil", "natural gas", "wasde", "crop", "rig", "inventory", "lme", "comex", "iea"] },
  { cat: "Bond Auctions", kw: ["auction", "bond sale", "treasury auction", "bill auction"] },
  { cat: "Government", kw: ["gdp", "payrolls", "unemployment", "cpi", "ppi", "retail sales", "ism", "pmi", "housing", "confidence", "election", "budget"] },
  { cat: "FX", kw: ["usd", "eur", "gbp", "jpy", "cad", "chf", "aud", "dollar", "currency"] },
  { cat: "Corporate", kw: ["earnings", "dividend", "guidance", "investor day", "buyback", "lockup", "m&a", "capital markets"] },
  { cat: "Crypto", kw: ["etf decision", "unlock", "fork", "governance", "bitcoin", "ethereum", "halving"] },
  { cat: "Weather", kw: ["weather", "storm", "hurricane", "freeze", "drought", "heat"] },
  { cat: "Shipping", kw: ["shipping", "canal", "port", "freight", "chokepoint"] },
];

function deriveCategory(ev) {
  const text = String(ev?.title || ev?.event || ev?.category || "").toLowerCase();
  for (const c of CATEGORY_KEYWORDS) {
    if (c.kw.some((k) => text.includes(k))) return c.cat;
  }
  if (ev?.category) return String(ev.category);
  return "Macro";
}

// Transmission path for an event (what moves). Honest: only when we can infer
// from category/title; otherwise null and the UI shows no transmission.
const EVENT_TX = {
  "US CPI": [{ to: "Treasuries", dir: "down" }, { to: "USD", dir: "up" }, { to: "Nasdaq", dir: "down" }, { to: "Growth Stocks", dir: "down" }],
  "OPEC Meeting": [{ to: "Oil", dir: "up" }, { to: "Energy", dir: "up" }, { to: "Inflation", dir: "up" }, { to: "Rates", dir: "up" }],
};
function deriveTransmission(ev) {
  const t = String(ev?.title || "");
  if (EVENT_TX[t]) return EVENT_TX[t];
  if (/cpi|inflation/i.test(t)) return [{ to: "Treasuries", dir: "down" }, { to: "USD", dir: "up" }, { to: "Equities", dir: "down" }];
  if (/opec|oil|crude/i.test(t)) return [{ to: "Energy", dir: "up" }, { to: "Inflation", dir: "up" }];
  if (/fed|rate decision|ecb|boe|boj/i.test(t)) return [{ to: "Rates", dir: "up" }, { to: "USD", dir: "up" }, { to: "Equities", dir: "down" }];
  if (/payrolls|jobs|unemployment/i.test(t)) return [{ to: "USD", dir: "up" }, { to: "Treasuries", dir: "down" }];
  return null;
}

function normalizeEvent(ev, kind) {
  const title = String(ev?.title || ev?.event || ev?.symbol || "Event");
  const dateStr = String(ev?.date || ev?.reportDate || ev?.start || "");
  const countryRaw = String(ev?.country || "US").toUpperCase();
  const country = G7.includes(countryRaw) ? countryRaw : "US";
  // Previous/Forecast/Actual/Surprise: only when the feed provides them.
  // Otherwise explicitly "—" (never fabricated).
  const prev = ev?.previous != null ? String(ev.previous) : "—";
  const forecast = ev?.forecast != null ? String(ev.forecast) : "—";
  const actual = ev?.actual != null ? String(ev.actual) : "—";
  const surprise = ev?.surprise != null ? String(ev.surprise) : "—";
  return {
    id: `${kind}-${title}-${dateStr}`,
    title,
    date: dateStr,
    time: ev?.time || ev?.period || "",
    impact: ev?.impact || "Watch",
    country,
    category: deriveCategory(ev),
    previous: prev,
    forecast,
    actual,
    surprise,
    assets: Array.isArray(ev?.assets) ? ev.assets : (ev?.symbol ? [ev.symbol] : []),
    transmission: deriveTransmission(ev),
    kind,
  };
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function dayDiff(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
}
// Countdown label (spec §15): relative to now.
function countdown(dateStr, timeStr) {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T${timeStr || "00:00"}:00`);
  if (Number.isNaN(d.getTime())) return "—";
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return "Live";
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
function bucketFor(diff) {
  if (diff == null) return "Week";
  if (diff <= 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff <= 7) return "This Week";
  return "Later";
}

export default function UpcomingEvents2({ economicEvents = [], earningsEvents = [], onOpenWorkspace }) {
  const [categoryFilters, setCategoryFilters] = useState([]);
  const [countryFilter, setCountryFilter] = useState("All");
  const [importanceFilter, setImportanceFilter] = useState("All");
  const [rangeFilter, setRangeFilter] = useState("Next 7 Days");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [filterDraft, setFilterDraft] = useState({ country: "All", importance: "All" });
  const categoryTriggerRef = useRef(null);
  const filtersTriggerRef = useRef(null);
  const filtersPanelRef = useRef(null);

  const closeCategoryMenu = () => {
    setCategoryMenuOpen(false);
    setCategoryQuery("");
    requestAnimationFrame(() => categoryTriggerRef.current?.focus());
  };
  const closeFilters = () => {
    setFiltersOpen(false);
    requestAnimationFrame(() => filtersTriggerRef.current?.focus());
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (categoryMenuOpen) closeCategoryMenu();
      if (filtersOpen) closeFilters();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [categoryMenuOpen, filtersOpen]);

  useEffect(() => {
    if (!filtersOpen || !window.matchMedia("(max-width: 640px)").matches) return undefined;
    const panel = filtersPanelRef.current;
    const focusable = panel?.querySelectorAll('button, select, input, [href], [tabindex]:not([tabindex="-1"])');
    const first = focusable?.[0];
    const last = focusable?.[focusable.length - 1];
    first?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab" || !first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    panel?.addEventListener("keydown", trapFocus);
    return () => panel?.removeEventListener("keydown", trapFocus);
  }, [filtersOpen]);

  const all = useMemo(() => {
    const econ = (economicEvents || []).map((e) => normalizeEvent(e, "economic"));
    const earn = (earningsEvents || []).map((e) => normalizeEvent(e, "earnings"));
    return [...econ, ...earn];
  }, [economicEvents, earningsEvents]);

  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (categoryFilters.length && !categoryFilters.includes(e.category)) return false;
      if (countryFilter !== "All" && e.country !== countryFilter) return false;
      if (importanceFilter !== "All" && String(e.impact).toLowerCase() !== importanceFilter.toLowerCase()) return false;
      if (rangeFilter !== "All") {
        const b = bucketFor(dayDiff(e.date));
        const diff = dayDiff(e.date);
        if (rangeFilter === "Today" && b !== "Today") return false;
        if (rangeFilter === "Tomorrow" && b !== "Tomorrow") return false;
        if (rangeFilter === "Next 7 Days" && (diff == null || diff < 0 || diff > 7)) return false;
        if (rangeFilter === "Next 30 Days" && (diff == null || diff < 0 || diff > 30)) return false;
      }
      return true;
    });
  }, [all, categoryFilters, countryFilter, importanceFilter, rangeFilter]);

  const grouped = useMemo(() => {
    const g = { Today: [], Tomorrow: [], "This Week": [], Later: [] };
    for (const e of filtered) {
      const b = bucketFor(dayDiff(e.date));
      (g[b] || g.Later).push(e);
    }
    return g;
  }, [filtered]);

  const activeFilterCount = categoryFilters.length + (countryFilter !== "All" ? 1 : 0) + (importanceFilter !== "All" ? 1 : 0);
  const categoryTriggerLabel = categoryFilters.length === 0 ? "All events" : categoryFilters.length === 1 ? categoryFilters[0] : `${categoryFilters.length} categories`;
  const visibleCategoryGroups = CATEGORY_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.toLowerCase().includes(categoryQuery.trim().toLowerCase())),
  })).filter((group) => group.items.length);
  const toggleCategory = (category) => setCategoryFilters((current) => (
    current.includes(category) ? current.filter((item) => item !== category) : [...current, category]
  ));
  const resetFilters = () => {
    setCategoryFilters([]);
    setCountryFilter("All");
    setImportanceFilter("All");
    setRangeFilter("Next 7 Days");
    setFilterDraft({ country: "All", importance: "All" });
  };
  const emptyFilterSummary = [
    categoryFilters.length ? categoryFilters.join(", ") : "all categories",
    rangeFilter === "Next 7 Days" ? "next 7 days" : rangeFilter.toLowerCase(),
    countryFilter !== "All" ? COUNTRY_NAMES[countryFilter] : null,
    importanceFilter !== "All" ? `${importanceFilter} impact` : null,
  ].filter(Boolean).join(" · ");

  const renderEvent = (e) => (
    <div key={e.id} className="market-event-row ue-row ue-row-inst">
      <span className="ue-flag" title={COUNTRY_NAMES[e.country]}>{FLAGS[e.country] || "🏳️"}</span>
      <div className="ue-main">
        <div className="ue-title-row">
          <strong>{e.title}</strong>
          <span className="ue-countdown">{countdown(e.date, e.time)}</span>
        </div>
        <span className="ue-sub">{e.time || "—"}{e.country !== "US" ? ` · ${COUNTRY_NAMES[e.country] || e.country}` : ""} · {e.category}</span>
        <div className="ue-pfas">
          <span>Prev <em>{e.previous}</em></span>
          <span>FC <em>{e.forecast}</em></span>
          <span>Act <em>{e.actual}</em></span>
          <span>Surp <em>{e.surprise}</em></span>
        </div>
        {e.assets.length ? <span className="ue-assets">Affected: {e.assets.slice(0, 4).join(", ")}</span> : null}
        {e.transmission && e.transmission.length ? (
          <div className="ue-tx">→ {e.transmission.map((t) => `${t.to} ${t.dir === "down" ? "↓" : t.dir === "up" ? "↑" : "→"}`).join(" · ")}</div>
        ) : null}
      </div>
      <em className={`market-event-impact ${String(e.impact).toLowerCase().split(" ")[0]}`}>{e.impact}</em>
      <button type="button" className="market-signal-btn" onClick={() => onOpenWorkspace?.(e)}>Open</button>
    </div>
  );

  return (
    <div className="upcoming-events-2">
      <div className="ue-filter-bar">
        <div className="ue-filter-menu-wrap">
          <button ref={categoryTriggerRef} type="button" className="ue-filter-trigger" aria-expanded={categoryMenuOpen} aria-controls="ue-category-menu" onClick={() => setCategoryMenuOpen((open) => !open)}>
            {categoryTriggerLabel}<span aria-hidden="true">⌄</span>
          </button>
          {categoryMenuOpen ? (
            <div className="ue-filter-popover ue-category-menu" id="ue-category-menu" role="dialog" aria-label="Event categories">
              <div className="ue-filter-popover__head">
                <strong>Categories</strong>
                <button type="button" className="ue-filter-text-action" onClick={() => setCategoryFilters([])} disabled={!categoryFilters.length}>Clear categories</button>
              </div>
              <input className="ue-category-search" autoFocus value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Search categories" aria-label="Search event categories" />
              <div className="ue-category-options">
                {visibleCategoryGroups.map((group) => (
                  <fieldset key={group.label} className="ue-category-group">
                    <legend>{group.label}</legend>
                    {group.items.map((category) => (
                      <label key={category} className="ue-category-option">
                        <input type="checkbox" checked={categoryFilters.includes(category)} onChange={() => toggleCategory(category)} />
                        <span>{category}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
              <button type="button" className="ue-filter-done" onClick={closeCategoryMenu}>Done</button>
            </div>
          ) : null}
        </div>

        <div className="ue-range-control" aria-label="Event timeframe">
          {[{ label: "Today", value: "Today" }, { label: "7D", value: "Next 7 Days" }, { label: "30D", value: "Next 30 Days" }].map(({ label, value }) => (
            <button key={value} type="button" className={rangeFilter === value ? "active" : ""} aria-pressed={rangeFilter === value} onClick={() => setRangeFilter(value)}>{label}</button>
          ))}
        </div>

        <div className="ue-filter-menu-wrap">
          <button ref={filtersTriggerRef} type="button" className="ue-filter-trigger" aria-expanded={filtersOpen} aria-controls="ue-advanced-filters" onClick={() => { setFilterDraft({ country: countryFilter, importance: importanceFilter }); setFiltersOpen(true); }}>
            Filters {activeFilterCount ? activeFilterCount : ""}<span aria-hidden="true">⌄</span>
          </button>
          {filtersOpen ? (
            <>
              <button type="button" className="ue-filter-backdrop" aria-label="Close filters" onClick={closeFilters} />
              <div ref={filtersPanelRef} className="ue-filter-popover ue-advanced-panel" id="ue-advanced-filters" role="dialog" aria-label="Advanced event filters">
                <div className="ue-filter-popover__head"><strong>Filters</strong><button type="button" className="ue-filter-close" aria-label="Close filters" onClick={closeFilters}>×</button></div>
                <label className="ue-filter-field">Country
                  <select value={filterDraft.country} onChange={(event) => setFilterDraft((draft) => ({ ...draft, country: event.target.value }))}>
                    <option value="All">All countries</option>
                    {G7.map((country) => <option key={country} value={country}>{COUNTRY_NAMES[country]}</option>)}
                  </select>
                </label>
                <fieldset className="ue-importance-field"><legend>Importance</legend>{["High", "Medium", "Low"].map((importance) => <button key={importance} type="button" className={filterDraft.importance === importance ? "active" : ""} aria-pressed={filterDraft.importance === importance} onClick={() => setFilterDraft((draft) => ({ ...draft, importance: draft.importance === importance ? "All" : importance }))}>{importance}</button>)}</fieldset>
                <div className="ue-filter-actions"><button type="button" className="ue-filter-text-action" onClick={() => { resetFilters(); closeFilters(); }}>Clear all</button><button type="button" className="ue-filter-apply" onClick={() => { setCountryFilter(filterDraft.country); setImportanceFilter(filterDraft.importance); closeFilters(); }}>Apply</button></div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {activeFilterCount ? <div className="ue-active-filters" aria-label="Active filters">
        {categoryFilters.map((category) => <button key={category} type="button" onClick={() => toggleCategory(category)}>{category}<span aria-hidden="true">×</span></button>)}
        {countryFilter !== "All" ? <button type="button" onClick={() => setCountryFilter("All")}>{COUNTRY_NAMES[countryFilter]}<span aria-hidden="true">×</span></button> : null}
        {importanceFilter !== "All" ? <button type="button" onClick={() => setImportanceFilter("All")}>{importanceFilter} impact<span aria-hidden="true">×</span></button> : null}
        <button type="button" className="ue-clear-all" onClick={resetFilters}>Clear all</button>
      </div> : null}

      {filtered.length === 0 ? (
        <div className="market-empty-row ue-empty">No events match {emptyFilterSummary}. Adjust filters or expand the timeframe to see more catalysts.</div>
      ) : (
        ["Today", "Tomorrow", "This Week", "Later"].map((b) => (
          grouped[b] && grouped[b].length ? (
            <div key={b} className="ue-group">
              <div className="ue-group-head">{b}</div>
              {grouped[b].map(renderEvent)}
            </div>
          ) : null
        ))
      )}
    </div>
  );
}
