// Asset Modal "Research" tab — v3 launcher surface.
// The modal is a launcher, not a research destination. This tab hands off to
// the Asset Research Workspace (the canonical research experience for an asset).
export function ResearchTab({ asset, onOpenResearch }) {
  const symbol = asset?.symbol;
  return (
    <div className="am-research-launch" role="region" aria-label="Open research workspace">
      <div className="am-research-launch-copy">
        <h4>Deep research lives in the workspace</h4>
        <p>
          The Asset Research Workspace is where theses, catalysts, notes, and conviction
          are tracked for {symbol ? <strong>{symbol}</strong> : "this asset"}.
        </p>
      </div>
      <button
        type="button"
        className="journal-btn primary"
        onClick={() => onOpenResearch?.(asset)}
      >
        Open Research Workspace
      </button>
    </div>
  );
}
