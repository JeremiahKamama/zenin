// P4 — Commodity navigation breadcrumbs (Brand v2: monochrome, clickable, context-aware).
// Renders the hierarchy from the spec: [Surface] > [Symbol] > [Group] > Commodity > [Source].
// Each crumb is clickable; `onSource` returns the user to where they came from.
import React from "react";

export function CommodityBreadcrumbs({ symbol, group, view = "research", source = "Watchlist", onOpenView, onSource }) {
  const crumbs = [
    { key: "surface", label: view === "profile" ? "Profile" : "Research", onClick: onOpenView },
    { key: "symbol", label: symbol || "—", onClick: null },
    { key: "group", label: group || "Commodity", onClick: null },
    { key: "commodity", label: "Commodity", onClick: null },
    { key: "source", label: source || "Watchlist", onClick: onSource },
  ];
  return (
    <nav className="commodity-breadcrumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={c.key} className="cb-crumb-wrap">
          {i > 0 ? <span className="cb-sep" aria-hidden="true">›</span> : null}
          {c.onClick ? (
            <button type="button" className="cb-crumb cb-link" onClick={c.onClick}>{c.label}</button>
          ) : (
            <span className={`cb-crumb ${c.key === "symbol" ? "cb-current" : ""}`}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
