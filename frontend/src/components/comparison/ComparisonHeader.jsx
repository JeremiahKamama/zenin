import { Button } from "../ui/button";

// Monochrome lettermark tile (no logo asset exists). First letter of symbol.
function Lettermark({ symbol }) {
  const ch = (symbol || "?").toString().charAt(0).toUpperCase();
  return <span className="cmp-header-mark" aria-hidden="true">{ch}</span>;
}

// Header for the comparison workspace: Asset A · VS · Asset B, swap, change,
// and the research-mode actions (Save / Share / Export PDF / AI Summary / Back).
export function ComparisonHeader({ assetA, assetB, onSwap, onChangeSlot, onBack, onSave, onShare, onExport, onAiSummary, saved }) {
  const upA = assetA?.changePct != null ? Number(assetA.changePct) >= 0 : null;
  const upB = assetB?.changePct != null ? Number(assetB.changePct) >= 0 : null;
  return (
    <header className="cmp-header">
      <div className="cmp-header-assets">
        <div className="cmp-header-asset">
          <Lettermark symbol={assetA?.symbol} />
          <div className="cmp-header-asset-copy">
            <span className="cmp-header-sym">{assetA?.symbol || "—"}</span>
            <span className="cmp-header-name">{assetA?.name || "Select asset"}</span>
            {assetA?.price != null ? (
              <span className="cmp-header-quote">
                <strong className="font-mono">${Number(assetA.price).toFixed(2)}</strong>
                {upA != null ? (
                  <span className={`cmp-header-change ${upA ? "up" : "down"}`}>
                    {upA ? "▲" : "▼"} {Math.abs(Number(assetA.changePct)).toFixed(2)}%
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        <span className="cmp-header-vs">VS</span>
        <div className="cmp-header-asset">
          <Lettermark symbol={assetB?.symbol} />
          <div className="cmp-header-asset-copy">
            <span className="cmp-header-sym">{assetB?.symbol || "—"}</span>
            <span className="cmp-header-name">{assetB?.name || "Select asset"}</span>
            {assetB?.price != null ? (
              <span className="cmp-header-quote">
                <strong className="font-mono">${Number(assetB.price).toFixed(2)}</strong>
                {upB != null ? (
                  <span className={`cmp-header-change ${upB ? "up" : "down"}`}>
                    {upB ? "▲" : "▼"} {Math.abs(Number(assetB.changePct)).toFixed(2)}%
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="cmp-header-actions">
        <Button variant="ghost" size="sm" onClick={onSwap} disabled={!assetA || !assetB}>Swap</Button>
        <Button variant="ghost" size="sm" onClick={() => onChangeSlot("A")}>Change A</Button>
        <Button variant="ghost" size="sm" onClick={() => onChangeSlot("B")}>Change B</Button>
        <Button variant="outline" size="sm" onClick={onSave}>{saved ? "Saved ✓" : "Save Comparison"}</Button>
        <Button variant="ghost" size="sm" onClick={onShare}>Share</Button>
        <Button variant="ghost" size="sm" onClick={onExport}>Export PDF</Button>
        <Button variant="ghost" size="sm" onClick={onAiSummary}>Generate AI Summary</Button>
        <Button variant="secondary" size="sm" onClick={onBack}>Back to Research</Button>
      </div>
    </header>
  );
}
