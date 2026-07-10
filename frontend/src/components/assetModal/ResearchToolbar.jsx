import { Button } from "../ui/button";

export function ResearchToolbar({
  asset,
  isInWatchlist,
  onToggleStar,
  onViewCompanyProfile,
  onClose,
  onCompare,
  onOpenResearch
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
    onCompare?.(asset.symbol);
  };

  // v3: Asset Modal becomes a launcher. "Open Research Workspace" is the primary
  // research action; the deep research surfaces live in ARW, not the modal.
  const actions = [
    {
      key: "research",
      label: "Open Research Workspace",
      variant: "primary",
      onClick: () => onOpenResearch?.(asset)
    },
    {
      key: "watchlist",
      label: isWatched ? "In Watchlist" : "Add to Watchlist",
      variant: isWatched ? "secondary" : "outline",
      onClick: () => onToggleStar?.(asset),
      active: isWatched
    },
    { key: "compare", label: "Compare Asset", variant: "outline", onClick: handleCompare },
    { key: "copy", label: "Copy Link", variant: "ghost", onClick: copyLink },
    { key: "profile", label: "Open Company Profile", variant: "ghost", onClick: () => onViewCompanyProfile?.(asset) }
  ];

  return (
    <footer className="am-toolbar" aria-label="Research actions">
      <div className="am-toolbar-actions">
        {actions.map((a) => (
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
      </div>
      <Button variant="secondary" size="sm" onClick={onClose} className="am-toolbar-close">
        Close
      </Button>
    </footer>
  );
}
