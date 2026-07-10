import { useEffect, useMemo, useState } from "react";
import { useComparisonAsset } from "./useComparisonAsset";
import { buildDecisionMatrix, aggregateVerdict } from "./comparisonUtils";
import { ComparisonHeader } from "./ComparisonHeader";
import { ComparisonSidebar } from "./ComparisonSidebar";
import { ComparisonCanvas } from "./ComparisonCanvas";
import { ComparisonInsights } from "./ComparisonInsights";
import { ComparisonPicker } from "./ComparisonPicker";

const SECTIONS = [
  { key: "decision", label: "Decision Matrix" },
  { key: "overview", label: "Overview" },
  { key: "price", label: "Price" },
  { key: "performance", label: "Performance" },
  { key: "fundamentals", label: "Fundamentals" },
  { key: "valuation", label: "Valuation" },
  { key: "financials", label: "Financials" },
  { key: "growth", label: "Growth" },
  { key: "profitability", label: "Profitability" },
  { key: "quality", label: "Quality" },
  { key: "technical", label: "Technical" },
  { key: "macro", label: "Macro" },
  { key: "ownership", label: "Ownership" },
  { key: "news", label: "News" },
  { key: "catalysts", label: "Catalysts" },
  { key: "risks", label: "Risks" },
  { key: "portfolioImpact", label: "Portfolio Impact" },
  { key: "shared", label: "Shared Intelligence" },
  { key: "scenario", label: "Scenario" },
  { key: "ai", label: "AI Analysis" },
  { key: "timeline", label: "Timeline" },
  { key: "journal", label: "Journal" }
];

const SAVE_KEY = "zenin_saved_comparisons";

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(SAVE_KEY) || "[]");
  } catch {
    return [];
  }
}

// Orchestrator. `assets` is an array (spec: engine accepts an array, never
// assume two forever). Renders a full-page workspace, not a modal.
export function ComparisonWorkspace({ assets = [], onBack, onNavigateCompare, onCloseModal }) {
  const [list, setList] = useState(() => (assets.length ? assets : []));
  const [section, setSection] = useState("decision");
  const [picking, setPicking] = useState(null); // "A" | "B" | null
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState(null);

  const assetA = list[0] || null;
  const assetB = list[1] || null;

  const a = useComparisonAsset(assetA?.symbol, assetA?.type);
  const b = useComparisonAsset(assetB?.symbol, assetB?.type);

  useEffect(() => {
    if (onCloseModal) onCloseModal();
  }, [onCloseModal]);

  const flash = (msg) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  const pick = (slot, picked) => {
    setList((prev) => {
      const next = [...prev];
      const idx = slot === "A" ? 0 : 1;
      next[idx] = { symbol: picked.symbol, name: picked.name, type: picked.type || "equity" };
      return next.slice(0, Math.max(2, next.length));
    });
    setPicking(null);
    setSaved(false);
    if (onNavigateCompare && picked?.symbol) {
      const other = slot === "A" ? list[1] : list[0];
      const aSym = slot === "A" ? picked.symbol : (other?.symbol || "");
      const bSym = slot === "B" ? picked.symbol : (other?.symbol || "");
      onNavigateCompare({ a: aSym, b: bSym });
    }
  };

  const swap = () => {
    setList((prev) => [prev[1], prev[0]].filter(Boolean));
    setSaved(false);
  };

  const changeSlot = (slot) => setPicking(slot);

  const save = () => {
    if (!assetA?.symbol || !assetB?.symbol) return;
    const entry = {
      id: `${assetA.symbol}-vs-${assetB.symbol}`,
      a: assetA.symbol,
      b: assetB.symbol,
      savedAt: new Date().toISOString()
    };
    const all = loadSaved().filter((e) => e.id !== entry.id);
    all.unshift(entry);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(all.slice(0, 25)));
      setSaved(true);
      flash("Comparison saved");
    } catch {
      flash("Could not save (storage unavailable)");
    }
  };

  const share = () => flash("Share link copied to clipboard (demo)");
  const exportPdf = () => flash("PDF export is not available in this environment");
  const aiSummary = () => {
    setSection("ai");
    flash("Opened AI Analysis (backend prompt layer not wired in this environment)");
  };

  const matrixRows = useMemo(() => buildDecisionMatrix(a.data, b.data), [a.data, b.data]);
  const verdict = useMemo(
    () => (matrixRows.length ? aggregateVerdict(matrixRows, a.data?.symbol, b.data?.symbol) : null),
    [matrixRows, a.data, b.data]
  );

  const onDecision = (action) => flash(`${action} — wired to Decisions/Journal in a later pass`);

  if (picking) {
    return (
      <div className="cmp-workspace cmp-workspace-picking">
        <ComparisonPicker
          slotLabel={picking === "A" ? "Asset A" : "Asset B"}
          onPick={(p) => pick(picking, { symbol: p.symbol, name: p.name, type: p.type })}
          onCancel={() => setPicking(null)}
        />
      </div>
    );
  }

  if (!assetA || !assetB) {
    return (
      <div className="cmp-workspace cmp-workspace-empty">
        <h2 className="cmp-empty-title">Compare two assets</h2>
        {assetA ? (
          <>
            <p className="cmp-empty-copy">Asset A is <strong>{assetA.symbol}</strong>. Pick Asset B to open the side-by-side workspace.</p>
            <ComparisonPicker
              slotLabel="Asset B"
              onPick={(p) => pick("B", { symbol: p.symbol, name: p.name, type: p.type })}
            />
          </>
        ) : (
          <>
            <p className="cmp-empty-copy">Pick the first asset to begin a side-by-side research workspace.</p>
            <ComparisonPicker
              slotLabel="Asset A"
              onPick={(p) => pick("A", { symbol: p.symbol, name: p.name, type: p.type })}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="cmp-workspace" role="region" aria-label="Asset comparison workspace">
      <ComparisonHeader
        assetA={a.data}
        assetB={b.data}
        onSwap={swap}
        onChangeSlot={changeSlot}
        onBack={onBack}
        onSave={save}
        onShare={share}
        onExport={exportPdf}
        onAiSummary={aiSummary}
        saved={saved}
      />
      <div className="cmp-body">
        <ComparisonSidebar sections={SECTIONS} active={section} onSelect={setSection} />
        <ComparisonCanvas
          section={section}
          assetA={a.data}
          assetB={b.data}
          loadingA={a.loading}
          loadingB={b.loading}
          matrixRows={matrixRows}
          verdict={verdict}
          onOpenSection={setSection}
        />
        <ComparisonInsights assetA={a.data} assetB={b.data} verdict={verdict} onDecision={onDecision} />
      </div>
      {toast ? <div className="cmp-toast" role="status">{toast}</div> : null}
    </div>
  );
}
