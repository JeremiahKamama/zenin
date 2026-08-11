import { Button } from "../ui/button";
import { getAssetKind, kindSupportsAction } from "../../utils/assetRegistry";

export function ResearchToolbar({
  asset,
  kind,
  isInWatchlist,
  onToggleStar,
  onViewCompanyProfile,
  onClose,
  onCompare,
  onOpenResearch,
  onOpenDesk,
  onJournal,
  onDecisionLedger
}) {
  const isWatched = Boolean(isInWatchlist?.(asset, undefined, { strictStockMeta: true }));

  const copyLink = () => {
    try {
      const link = `${window.location.origin}/?asset=${encodeURIComponent(asset?.symbol || "")}`;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).catch(() => {});
      }
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleCompare = () => {
    if (!asset?.symbol) return;
    // Spec §8/§9: route FX/currency/ETF comparisons with kind so App can branch
    // to the correct workspace (not the indicator-only AssetCompareDrawer).
    onCompare?.({ kind, symbol: asset.symbol });
  };

  // P2.4 — action set is resolved from the asset registry, never hardcoded per kind.
  // Each universal action renders only when (a) the kind supports it and
  // (b) a handler is wired (so optional surfaces degrade gracefully, no dead buttons).
  const kindLabel = getAssetKind(kind)?.displayName || "Asset";
  // Spec §9 — kind-specific CTA labels (profile + compare), never stock-only.
  const profileCta = {
    etf: "Open ETF Profile",
    forex: "Open FX Pair Profile",
    currency: "Open Currency Profile",
    stock: "Open Company Profile",
    crypto: "Open Asset Profile",
    commodity: "Open Commodity Profile",
    indicator: "Open Indicator Profile",
    bond: "Open Bond Profile",
  }[kind] || `Open ${kindLabel} Profile`;
  const compareCta = {
    etf: "Compare ETFs",
    forex: "Compare FX Pair",
    currency: "Compare Currency",
    stock: "Compare Asset",
    crypto: "Compare Asset",
    commodity: "Compare Asset",
    bond: "Compare Asset",
  }[kind] || "Compare Asset";
  const supports = (a) => kindSupportsAction(kind, a);
  const isEtf = kind === "etf";

  const actionDefs = [];
  if (supports("research")) {
    actionDefs.push({
      key: "research",
      label: "Open Research Workspace",
      variant: "primary",
      onClick: () => onOpenResearch?.(asset)
    });
  }
  if (supports("profile")) {
    actionDefs.push({
      key: "profile",
      label: profileCta,
      variant: isEtf ? "primary" : "ghost",
      onClick: () => onViewCompanyProfile?.(asset)
    });
  }
  if (onOpenDesk) {
    actionDefs.push({
      key: "desk",
      label: "Open Desk",
      variant: "ghost",
      onClick: () => onOpenDesk()
    });
  }
  if (supports("watchlist")) {
    actionDefs.push({
      key: "watchlist",
      label: isWatched ? "In Watchlist" : "Add to Watchlist",
      variant: isWatched ? "secondary" : "outline",
      onClick: () => onToggleStar?.(asset),
      active: isWatched
    });
  }
  if (supports("compare")) {
    actionDefs.push({ key: "compare", label: compareCta, variant: "outline", onClick: handleCompare });
  }
  if (supports("copySymbol")) {
    actionDefs.push({ key: "copySymbol", label: "Copy Link", variant: "ghost", onClick: copyLink });
  }
  if (supports("journal") && onJournal) {
    actionDefs.push({ key: "journal", label: "Journal", variant: "ghost", onClick: () => onJournal?.(asset) });
  }
  if (supports("decisionLedger") && onDecisionLedger) {
    actionDefs.push({ key: "decisionLedger", label: "Decision Ledger", variant: "ghost", onClick: () => onDecisionLedger?.(asset) });
  }

  const visibleActions = isEtf
    ? actionDefs.filter((action) => ["profile", "compare"].includes(action.key))
    : actionDefs;
  const overflowActions = isEtf
    ? actionDefs.filter((action) => !["profile", "watchlist", "compare"].includes(action.key))
    : [];

  return (
    <footer className="am-toolbar" aria-label="Research actions">
      <div className="am-toolbar-actions">
        {visibleActions.map((a) => (
          <Button
            key={a.key}
            variant={a.variant}
            size="sm"
            onClick={a.onClick}
            className={a.active ? "am-action-active" : ""}
            aria-pressed={a.active || undefined}
          >
            {a.label}
          </Button>
        ))}
        {overflowActions.length ? (
          <details className="am-toolbar-overflow">
            <summary>More actions</summary>
            <div className="am-toolbar-overflow-menu">
              {overflowActions.map((a) => (
                <Button key={a.key} variant="ghost" size="sm" onClick={a.onClick}>{a.label}</Button>
              ))}
            </div>
          </details>
        ) : null}
      </div>
      {!isEtf ? <Button variant="secondary" size="sm" onClick={onClose} className="am-toolbar-close">Close</Button> : null}
    </footer>
  );
}
