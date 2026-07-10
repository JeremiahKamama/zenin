import { Button } from "../ui/button";

// Header for the comparison workspace: Asset A · VS · Asset B, swap, change,
// and the research-mode actions (Save / Share / Export PDF / AI Summary / Back).
export function ComparisonHeader({ assetA, assetB, onSwap, onChangeSlot, onBack, onSave, onShare, onExport, onAiSummary, saved }) {
  return (
    <header className="cmp-header">
      <div className="cmp-header-assets">
        <div className="cmp-header-asset">
          <span className="cmp-header-sym">{assetA?.symbol || "—"}</span>
          <span className="cmp-header-name">{assetA?.name || "Select asset"}</span>
        </div>
        <span className="cmp-header-vs">VS</span>
        <div className="cmp-header-asset">
          <span className="cmp-header-sym">{assetB?.symbol || "—"}</span>
          <span className="cmp-header-name">{assetB?.name || "Select asset"}</span>
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
