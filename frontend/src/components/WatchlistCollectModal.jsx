// Universal Asset Collection modal (Add to Watchlist, Brand v2).
//
// Registry-driven, kind-agnostic: the asset summary, kind label, and actions all
// resolve through utils/assetRegistry — no `if (stock) … if (commodity) …`.
//
// Honesty (Brand v2): only real, derivable data is rendered. Theme asset-counts
// and "last added" come from the live watchlist entries (date_added). Sector /
// exchange / price rows render only when present on the asset. Nothing is faked —
// no placeholder icons, no invented "updated today", no synthetic counts.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAssetKind } from "../utils/assetRegistry.js";
import { AssetLogo } from "./AssetLogo";

const THEME_CARD_THRESHOLD = 12; // < this many themes → cards, else searchable list

function normalizeSymbol(value) {
  return String(value || "").trim().toUpperCase();
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function relativeDay(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Monogram (never a fabricated icon) — first two significant chars of the theme. */
function themeMonogram(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || "?").trim().slice(0, 2).toUpperCase();
}

/**
 * @param {Object} props
 * @param {Object} props.asset            The asset being collected.
 * @param {string} [props.kind]           Registry kind (stock/commodity/…). Falls back to asset.type.
 * @param {string[]} props.themes         Known theme names.
 * @param {string[]} props.categories     Category options (optional grouping layer).
 * @param {Array}  props.watchlistAssets  Live watchlist entries (for counts/membership/duplicates).
 * @param {string} [props.initialTheme]
 * @param {string} [props.initialCategory]
 * @param {boolean} props.submitting
 * @param {string} [props.error]
 * @param {Function} props.onCancel
 * @param {Function} props.onConfirm      ({ theme, category, mode }) => void   mode: "add" | "addOpen"
 * @param {Function} [props.onOpenTheme]  (category, theme) => void
 */
export default function WatchlistCollectModal({
  asset,
  kind,
  themes = [],
  categories = [],
  watchlistAssets = [],
  initialTheme = "",
  initialCategory = "",
  submitting = false,
  error = "",
  onCancel,
  onConfirm,
  onOpenTheme,
}) {
  const registryEntry = getAssetKind(kind || asset?.kind || asset?.type);
  const kindLabel = registryEntry?.displayName || titleCase(asset?.type || asset?.kind || "Asset");

  const symbol = normalizeSymbol(asset?.symbol);
  const displayName = asset?.name || asset?.displayName || "";

  const [search, setSearch] = useState("");
  const [selectedTheme, setSelectedTheme] = useState(initialTheme || "");
  const [category, setCategory] = useState(
    String(initialCategory || asset?.category || categories[0] || "").toLowerCase()
  );
  const [creating, setCreating] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);

  const searchRef = useRef(null);
  const bodyRef = useRef(null);

  // ---- Derived, honest metadata from live watchlist entries -----------------
  const themeMeta = useMemo(() => {
    const meta = new Map();
    for (const entry of Array.isArray(watchlistAssets) ? watchlistAssets : []) {
      const t = String(entry?.theme || "").trim();
      if (!t) continue;
      const key = t.toLowerCase();
      const prev = meta.get(key) || { name: t, count: 0, lastAdded: null };
      prev.count += 1;
      const added = entry?.date_added || entry?.dateAdded || null;
      if (added && (!prev.lastAdded || new Date(added) > new Date(prev.lastAdded))) {
        prev.lastAdded = added;
      }
      meta.set(key, prev);
    }
    return meta;
  }, [watchlistAssets]);

  const themeList = useMemo(() => {
    const seen = new Set();
    return (Array.isArray(themes) ? themes : [])
      .map((t) => String(t || "").trim())
      .filter((t) => {
        const k = t.toLowerCase();
        if (!t || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((t) => {
        const m = themeMeta.get(t.toLowerCase());
        return { name: t, count: m?.count || 0, lastAdded: m?.lastAdded || null };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [themes, themeMeta]);

  const filteredThemes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return themeList;
    return themeList.filter((t) => t.name.toLowerCase().includes(q));
  }, [themeList, search]);

  // Existing membership for THIS asset (by symbol) — real, from watchlist.
  const currentMemberships = useMemo(() => {
    if (!symbol) return [];
    const found = new Set();
    for (const entry of Array.isArray(watchlistAssets) ? watchlistAssets : []) {
      if (normalizeSymbol(entry?.symbol) !== symbol) continue;
      const t = String(entry?.theme || "").trim();
      if (t) found.add(t);
    }
    return [...found];
  }, [watchlistAssets, symbol]);

  // Smart suggestions from real registry/asset metadata only (never invented).
  const suggestedThemes = useMemo(() => {
    const raw = [
      asset?.sector,
      asset?.industry,
      asset?.group,
      asset?.subgroup,
      asset?.assetClass,
      asset?.country,
      ...(Array.isArray(asset?.tags) ? asset.tags : []),
    ];
    const seen = new Set(currentMemberships.map((t) => t.toLowerCase()));
    const out = [];
    for (const v of raw) {
      const label = titleCase(v);
      if (!label) continue;
      const k = label.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(label);
      if (out.length >= 6) break;
    }
    return out;
  }, [asset, currentMemberships]);

  const effectiveTheme = (creating ? titleCase(newThemeName) : selectedTheme).trim();

  const isDuplicate = useMemo(() => {
    if (!effectiveTheme) return false;
    return currentMemberships.some((t) => t.toLowerCase() === effectiveTheme.toLowerCase());
  }, [currentMemberships, effectiveTheme]);

  const destinationCount = useMemo(() => {
    if (!effectiveTheme) return null;
    const existing = themeMeta.get(effectiveTheme.toLowerCase())?.count || 0;
    return isDuplicate ? existing : existing + 1;
  }, [effectiveTheme, themeMeta, isDuplicate]);

  const useCards = themeList.length > 0 && themeList.length < THEME_CARD_THRESHOLD;

  // ---- Keyboard: Esc close, Enter submit, ↑/↓ theme navigation --------------
  const handleConfirm = useCallback(
    (mode) => {
      if (submitting || !effectiveTheme || isDuplicate) return;
      onConfirm?.({ theme: effectiveTheme, category, mode });
    },
    [submitting, effectiveTheme, isDuplicate, onConfirm, category]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm("add");
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, handleConfirm]);

  useEffect(() => {
    // Autofocus theme search on open for keyboard-first flow.
    const id = window.setTimeout(() => searchRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
  }, []);

  const onSearchKeyDown = (e) => {
    if (!filteredThemes.length) {
      if (e.key === "Enter" && search.trim()) {
        e.preventDefault();
        setCreating(true);
        setNewThemeName(search.trim());
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filteredThemes.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filteredThemes[activeIdx] || filteredThemes[0];
      if (pick) {
        setSelectedTheme(pick.name);
        setCreating(false);
      }
    }
  };

  const selectTheme = (name) => {
    setSelectedTheme(name);
    setCreating(false);
    setNewThemeName("");
  };

  if (!asset) return null;

  return (
    <div className="wc-overlay" onClick={onCancel} role="presentation">
      <div
        className="wc-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${symbol || "asset"} to a watchlist theme`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="wc-header">
          <h3>Add to Watchlist</h3>
          <button className="wc-close" onClick={onCancel} aria-label="Close">&times;</button>
        </div>

        {/* Asset summary — pinned while the body scrolls */}
        <div className="wc-summary">
          <div className="wc-summary-id">
            <AssetLogo asset={{ symbol: symbol, ...asset }} size="md" />
            <span className="wc-summary-symbol">{symbol || "—"}</span>
            <span className="wc-summary-kind">{kindLabel}</span>
          </div>
          {displayName ? <div className="wc-summary-name">{displayName}</div> : null}
          <div className="wc-summary-meta">
            {asset?.sector ? <span>{titleCase(asset.sector)}</span> : null}
            {asset?.industry ? <span>{titleCase(asset.industry)}</span> : null}
            {asset?.exchange ? <span>{String(asset.exchange).toUpperCase()}</span> : null}
            {asset?.country ? <span>{titleCase(asset.country)}</span> : null}
            {typeof asset?.price === "number"
              ? <span className="wc-summary-price">${asset.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              : null}
          </div>
          {currentMemberships.length ? (
            <div className="wc-membership">
              <span className="wc-membership-label">Currently in</span>
              <div className="wc-membership-chips">
                {currentMemberships.map((t) => (
                  <span key={t} className="wc-chip wc-chip--muted">{t}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Scrollable body */}
        <div className="wc-body" ref={bodyRef}>
          {/* Theme — primary */}
          <section className="wc-section">
            <div className="wc-section-head">
              <label className="wc-label" htmlFor="wc-theme-search">Theme <span className="wc-req">*</span></label>
              <button
                type="button"
                className="wc-inline-action"
                onClick={() => { setCreating((v) => !v); setNewThemeName(search.trim()); }}
              >
                {creating ? "Cancel" : "+ Create theme"}
              </button>
            </div>

            {suggestedThemes.length ? (
              <div className="wc-suggested">
                <span className="wc-suggested-label">Suggested</span>
                {suggestedThemes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`wc-chip wc-chip--suggest ${effectiveTheme.toLowerCase() === t.toLowerCase() ? "is-active" : ""}`}
                    onClick={() => selectTheme(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}

            {creating ? (
              <div className="wc-create">
                <input
                  className="wc-input"
                  type="text"
                  placeholder="New theme name"
                  value={newThemeName}
                  autoFocus
                  onChange={(e) => setNewThemeName(e.target.value)}
                />
                <p className="wc-hint">New themes appear in the Stocks filters.</p>
              </div>
            ) : (
              <>
                <input
                  id="wc-theme-search"
                  ref={searchRef}
                  className="wc-input"
                  type="text"
                  placeholder="Search themes…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setActiveIdx(-1); }}
                  onKeyDown={onSearchKeyDown}
                  autoComplete="off"
                />

                {themeList.length === 0 ? (
                  <div className="wc-empty">
                    <strong>No themes yet</strong>
                    <span>Create your first investment theme.</span>
                  </div>
                ) : useCards ? (
                  <div className="wc-theme-grid" role="listbox" aria-label="Themes">
                    {filteredThemes.map((t, i) => (
                      <button
                        key={t.name}
                        type="button"
                        role="option"
                        aria-selected={selectedTheme.toLowerCase() === t.name.toLowerCase()}
                        className={`wc-theme-card ${selectedTheme.toLowerCase() === t.name.toLowerCase() ? "is-active" : ""} ${i === activeIdx ? "is-cursor" : ""}`}
                        onClick={() => selectTheme(t.name)}
                      >
                        <span className="wc-theme-mono">{themeMonogram(t.name)}</span>
                        <span className="wc-theme-name">{t.name}</span>
                        <span className="wc-theme-sub">
                          {t.count} asset{t.count === 1 ? "" : "s"}
                          {t.lastAdded ? ` · ${relativeDay(t.lastAdded)}` : ""}
                        </span>
                      </button>
                    ))}
                    {filteredThemes.length === 0 ? (
                      <div className="wc-empty wc-empty--inline">
                        <span>No match. Press Enter to create “{titleCase(search)}”.</span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="wc-theme-list" role="listbox" aria-label="Themes">
                    {filteredThemes.map((t, i) => (
                      <button
                        key={t.name}
                        type="button"
                        role="option"
                        aria-selected={selectedTheme.toLowerCase() === t.name.toLowerCase()}
                        className={`wc-theme-row ${selectedTheme.toLowerCase() === t.name.toLowerCase() ? "is-active" : ""} ${i === activeIdx ? "is-cursor" : ""}`}
                        onClick={() => selectTheme(t.name)}
                      >
                        <span className="wc-theme-name">{t.name}</span>
                        <span className="wc-theme-sub">
                          {t.count} asset{t.count === 1 ? "" : "s"}
                          {t.lastAdded ? ` · ${relativeDay(t.lastAdded)}` : ""}
                        </span>
                      </button>
                    ))}
                    {filteredThemes.length === 0 ? (
                      <div className="wc-empty wc-empty--inline">
                        <span>No match. Press Enter to create “{titleCase(search)}”.</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Category — secondary, optional grouping */}
          <section className="wc-section">
            <label className="wc-label" htmlFor="wc-category">Category <span className="wc-optional">optional</span></label>
            <select
              id="wc-category"
              className="wc-input wc-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {categories.length === 0 ? <option value="">Uncategorized</option> : null}
              {categories.map((c) => (
                <option key={c} value={c}>{titleCase(c)}</option>
              ))}
            </select>
          </section>

          {/* Destination preview — real counts */}
          <section className="wc-section wc-destination">
            <span className="wc-label">Destination</span>
            {effectiveTheme ? (
              isDuplicate ? (
                <div className="wc-dest-dup">
                  <span className="wc-dest-path">
                    {titleCase(category) || "Uncategorized"} <span className="wc-dest-arrow">›</span> {effectiveTheme}
                  </span>
                  <span className="wc-dest-warn">Already in this theme.</span>
                  {onOpenTheme ? (
                    <button
                      type="button"
                      className="wc-inline-action"
                      onClick={() => onOpenTheme(category, effectiveTheme)}
                    >
                      Open theme instead
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="wc-dest-ok">
                  <span className="wc-dest-path">
                    {titleCase(category) || "Uncategorized"} <span className="wc-dest-arrow">›</span> {effectiveTheme}
                  </span>
                  {destinationCount != null ? (
                    <span className="wc-dest-count">{destinationCount} asset{destinationCount === 1 ? "" : "s"} after add</span>
                  ) : null}
                </div>
              )
            ) : (
              <span className="wc-hint">Pick or create a theme to preview the destination.</span>
            )}
          </section>

          {error ? <p className="wc-error">{error}</p> : null}
        </div>

        {/* Sticky footer */}
        <div className="wc-footer">
          <button type="button" className="wc-btn wc-btn--ghost" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className="wc-btn wc-btn--secondary"
            onClick={() => handleConfirm("addOpen")}
            disabled={submitting || !effectiveTheme || isDuplicate}
          >
            Add &amp; Open
          </button>
          <button
            type="button"
            className="wc-btn wc-btn--primary"
            onClick={() => handleConfirm("add")}
            disabled={submitting || !effectiveTheme || isDuplicate}
          >
            {submitting ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
