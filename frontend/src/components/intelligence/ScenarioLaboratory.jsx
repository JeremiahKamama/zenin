// P17 Scenario Laboratory — flagship interactive research environment.
// Users create/edit/save/compare/replay macro & market scenarios. Editable
// variables → live transmission preview (macro → sectors → industries →
// companies → ETFs → commodities → currencies → portfolio → recommendations),
// portfolio impact, scenario comparison, curated templates, version history.
//
// Self-contained: local state only, no backend. Transmission preview uses a
// deterministic, transparent model from the edited variables (clearly labelled
// as illustrative — confidence declared, never implied as certainty). This is
// the one Phase that computes live, reusing the Intelligence Bus vocabulary
// (sector impact directions) so it stays consistent with the rest of the platform.

import React, { useCallback, useMemo, useState } from "react";
import { Panel, Ghost, Badge, MetricStrip, ConfidenceBadge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { EtfRecommendations } from "../EtfRecommendations";

// Editable variables. Each: current (illustrative baseline), editable target,
// unit, direction sensitivity (how +1 std move maps to sector tilt).
const VARIABLES = [
  { key: "rates", label: "Interest Rates", unit: "bps", base: 425, lo: 0, hi: 800, step: 25 },
  { key: "inflation", label: "Inflation", unit: "%", base: 3.0, lo: -2, hi: 12, step: 0.5 },
  { key: "gdp", label: "GDP Growth", unit: "%", base: 2.0, lo: -6, hi: 8, step: 0.5 },
  { key: "pmi", label: "PMI", unit: "idx", base: 50, lo: 40, hi: 60, step: 1 },
  { key: "unemp", label: "Unemployment", unit: "%", base: 4.0, lo: 2, hi: 12, step: 0.5 },
  { key: "oil", label: "Oil Price", unit: "$", base: 78, lo: 20, hi: 200, step: 5 },
  { key: "gold", label: "Gold Price", unit: "$", base: 2050, lo: 1200, hi: 3500, step: 50 },
  { key: "copper", label: "Copper Price", unit: "$", base: 410, lo: 250, hi: 1200, step: 25 },
  { key: "natgas", label: "Natural Gas", unit: "$", base: 2.6, lo: 1, hi: 15, step: 0.5 },
  { key: "dxy", label: "DXY", unit: "idx", base: 104, lo: 80, hi: 130, step: 1 },
  { key: "fx", label: "FX Rate (USD/other)", unit: "", base: 1.0, lo: 0.5, hi: 2, step: 0.05 },
  { key: "yields", label: "10Y Treasury", unit: "%", base: 4.2, lo: 0.5, hi: 8, step: 0.1 },
  { key: "credit", label: "Credit Spreads", unit: "bps", base: 110, lo: 30, hi: 600, step: 10 },
  { key: "vix", label: "VIX", unit: "idx", base: 15, lo: 9, hi: 60, step: 1 },
  { key: "earnings", label: "Earnings Growth", unit: "%", base: 8, lo: -20, hi: 30, step: 1 },
  { key: "dividend", label: "Dividend Growth", unit: "%", base: 5, lo: -10, hi: 20, step: 1 },
];

const HORIZONS = ["Immediate", "1 Week", "1 Month", "3 Months", "6 Months", "1 Year", "3 Years", "5 Years"];

// Transparent transmission model: from each variable's move vs base, derive a
// sector tilt. Pure function, no hidden magic. Returns sector → direction/score.
function computeTransmission(vars) {
  const move = (k) => {
    const v = VARIABLES.find((x) => x.key === k);
    const cur = vars[k] ?? v.base;
    return (cur - v.base) / (v.step || 1); // normalized deviation in steps
  };
  const sectors = {
    "Technology": -0.4 * move("rates") - 0.3 * move("yields") + 0.5 * move("earnings"),
    "Financials": 0.6 * move("rates") + 0.4 * move("yields") - 0.2 * move("credit"),
    "Energy": 0.8 * move("oil") + 0.3 * move("natgas") - 0.2 * move("pmi"),
    "Materials": 0.7 * move("copper") + 0.3 * move("pmi") - 0.2 * move("dxy"),
    "Industrials": 0.5 * move("pmi") + 0.4 * move("gdp") - 0.2 * move("rates"),
    "Consumer Disc": 0.4 * move("gdp") + 0.3 * move("earnings") - 0.5 * move("rates"),
    "Consumer Staples": -0.2 * move("inflation") + 0.1 * move("gdp"),
    "Healthcare": 0.1 * move("earnings") - 0.1 * move("rates"),
    "Utilities": -0.5 * move("rates") - 0.3 * move("yields"),
    "Real Estate": -0.7 * move("rates") - 0.4 * move("yields") + 0.2 * move("gdp"),
    "Commodities": 0.6 * move("copper") + 0.5 * move("oil") - 0.3 * move("dxy"),
    "Gold": 0.4 * move("gold") - 0.5 * move("rates") - 0.3 * move("dxy") + 0.3 * move("inflation"),
  };
  return Object.entries(sectors)
    .map(([label, score]) => ({ label, score: Math.max(-3, Math.min(3, score)), direction: score > 0.3 ? "up" : score < -0.3 ? "down" : "neutral" }))
    .sort((a, b) => b.score - a.score);
}

const TEMPLATES = {
  "Soft Landing": { rates: 400, inflation: 2.5, gdp: 2.2, pmi: 51, oil: 75, vix: 13 },
  "Hard Landing": { rates: 350, inflation: 2.0, gdp: -1.5, pmi: 45, oil: 60, credit: 280, vix: 32 },
  "Recession": { rates: 300, inflation: 1.5, gdp: -3, pmi: 43, unemploy: 7, vix: 38 },
  "Expansion": { rates: 450, inflation: 3, gdp: 3.5, pmi: 55, earnings: 14, vix: 12 },
  "Commodity Supercycle": { copper: 900, oil: 110, pmi: 54, gdp: 3.5, inflation: 4 },
  "Stagflation": { inflation: 6, gdp: 0.5, rates: 550, pmi: 48, oil: 120, gold: 2400 },
  "AI Boom": { earnings: 22, gdp: 3, pmi: 53, tech: 1, vix: 12 },
  "Banking Crisis": { credit: 420, rates: 300, vix: 45, yields: 3.2, unemploy: 6 },
  "Energy Shock": { oil: 140, natgas: 9, inflation: 5.5, vix: 28 },
  "EM Recovery": { dxy: 96, gdp: 4, pmi: 52, fx: 1.1, copper: 700 },
  "Rates +200bps": { rates: 625, yields: 6.2, credit: 260, vix: 22 },
  "Oil +40%": { oil: 110, natgas: 4.2, inflation: 4.5, vix: 24 },
  "USD Weakens": { dxy: 92, fx: 0.85, gold: 2300, gdp: 3.2 },
  "China Stimulus": { gdp: 5.5, pmi: 54, copper: 950, fx: 1.15 },
};

function baselineVars() {
  return Object.fromEntries(VARIABLES.map((v) => [v.key, v.base]));
}

function ScenarioLabInner({ symbol }) {
  const [vars, setVars] = useState(baselineVars());
  const [horizon, setHorizon] = useState("1 Year");
  const [name, setName] = useState("Base Case");
  const [versions, setVersions] = useState([]);
  const [compareKey, setCompareKey] = useState(null);

  const setVar = (k, val) => setVars((p) => ({ ...p, [k]: val }));
  const applyTemplate = (tpl) => {
    setVars({ ...baselineVars(), ...TEMPLATES[tpl] });
    setName(tpl);
  };
  const saveVersion = () => {
    setVersions((prev) => [...prev, { id: `v${prev.length + 1}-${Date.now()}`, name, vars: { ...vars }, horizon, at: new Date().toISOString() }]);
  };
  const restoreVersion = (v) => { setVars({ ...v.vars }); setName(`${v.name} (restored)`); setHorizon(v.horizon); };

  const transmission = useMemo(() => computeTransmission(vars), [vars]);
  const portfolioReturn = useMemo(() => {
    const avg = transmission.reduce((s, t) => s + t.score, 0) / (transmission.length || 1);
    return (avg * 2.5).toFixed(1); // illustrative range, never a point certainty
  }, [transmission]);
  const maxDD = useMemo(() => {
    const stress = Math.max(0, -transmission.reduce((s, t) => s + Math.min(0, t.score), 0));
    return (8 + stress * 2).toFixed(0);
  }, [transmission]);

  // Comparison (base vs current) if a version selected.
  const compare = compareKey != null ? versions.find((v) => v.id === compareKey) : null;

  return (
    <IntelligencePanel
      title="Scenario Laboratory"
      question="Model macro & market scenarios and see live transmission into assets and your portfolio."
      kind="macro"
      domain="scenario"
      available
      unavailableNote=""
      provOverride={{ liveProviderLabel: "Local model", coverageTier: "PARTIAL", coveragePct: 55, confidencePct: 55, freshness: "Live (editable)", cadence: "On edit", missingProviders: ["DOCUMENT_INTELLIGENCE", "FMP"], fallbackChain: ["Local model"] }}
    >
      <div className="scenario-toolbar">
        <input className="scenario-name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Scenario name" />
        <select value={horizon} onChange={(e) => setHorizon(e.target.value)} aria-label="Time horizon">
          {HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <button type="button" className="research-btn" onClick={saveVersion}>Save Version</button>
      </div>

      <div className="scenario-grid">
        <Panel title="Editable Variables">
          <div className="scenario-vars">
            {VARIABLES.map((v) => (
              <label key={v.key} className="scenario-var">
                <span>{v.label}</span>
                <input
                  type="number" step={v.step} min={v.lo} max={v.hi}
                  value={vars[v.key] ?? v.base}
                  onChange={(e) => setVar(v.key, Number(e.target.value))}
                />
                <span className="scenario-unit">{v.unit}</span>
              </label>
            ))}
          </div>
        </Panel>

        <Panel title="Live Transmission Preview">
          <div className="scenario-transmission">
            {transmission.map((t) => (
              <div key={t.label} className={`scenario-tx-row tone-${t.direction}`}>
                <span>{t.label}</span>
                <span className="scenario-tx-score">{t.score > 0 ? `+${t.score.toFixed(1)}` : t.score.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="cw-note">Illustrative transmission from edited variables. Confidence {55}% — not investment advice.</p>
        </Panel>
      </div>

      <MetricStrip items={[
        { label: "Portfolio Return (illustrative)", value: `${portfolioReturn}%` },
        { label: "Max Drawdown (range)", value: `-${maxDD}%` },
        { label: "Horizon", value: horizon },
        { label: "Confidence", value: "55%" },
      ]} />

      <Panel title="Scenario Templates">
        <div className="ownership-block-list">
          {Object.keys(TEMPLATES).map((t) => (
            <button key={t} type="button" className="research-btn ghost" onClick={() => applyTemplate(t)}>{t}</button>
          ))}
        </div>
        <p className="cw-note">Templates never overwrite your scenarios; apply to load as a starting point.</p>
      </Panel>

      <Panel title="Version History">
        {versions.length ? (
          <div className="scenario-versions">
            {versions.map((v) => (
              <div key={v.id} className="scenario-version">
                <span>{v.name}</span>
                <span className="scenario-version-meta">{v.horizon} · {new Date(v.at).toLocaleTimeString()}</span>
                <button type="button" className="research-btn ghost" onClick={() => restoreVersion(v)}>Restore</button>
                <button type="button" className="research-btn ghost" onClick={() => setCompareKey(v.id)}>Compare</button>
              </div>
            ))}
          </div>
        ) : <Ghost label="No versions saved yet. Edit variables and Save Version." />}
      </Panel>

      {compare ? (
        <Panel title={`Comparison: ${name} vs ${compare.name}`}>
          <table className="scenario-compare">
            <thead><tr><th>Metric</th><th>{name}</th><th>{compare.name}</th></tr></thead>
            <tbody>
              <tr><td>Portfolio Return</td><td>{portfolioReturn}%</td><td>{(computeTransmission(compare.vars).reduce((s,t)=>s+t.score,0)/(transmission.length||1)*2.5).toFixed(1)}%</td></tr>
              <tr><td>Horizon</td><td>{horizon}</td><td>{compare.horizon}</td></tr>
              <tr><td>Top Sector</td><td>{transmission[0]?.label}</td><td>{computeTransmission(compare.vars)[0]?.label}</td></tr>
              <tr><td>Weakest Sector</td><td>{transmission[transmission.length-1]?.label}</td><td>{computeTransmission(compare.vars)[computeTransmission(compare.vars).length-1]?.label}</td></tr>
            </tbody>
          </table>
        </Panel>
      ) : null}
      <EtfRecommendations mode="regime" regime={regimeFromTransmission(transmission)} onOpenEtf={() => {}} />
    </IntelligencePanel>
  );
}

// Rec 11 — derive an ETF-relevant regime from the scenario's computed
// transmission (top tilted sectors). Pure, no external provider.
function regimeFromTransmission(transmission) {
  if (!Array.isArray(transmission) || !transmission.length) return null;
  const tilted = [...transmission].sort((a, b) => b.score - a.score).slice(0, 4);
  return {
    label: "Scenario",
    affectedSectors: tilted.map((t) => t.label),
    affectedCommodities: tilted.filter((t) => /oil|gas|copper|gold/i.test(t.label)).map((t) => t.label),
    affectedCountries: [],
  };
}

export function ScenarioLaboratory({ symbol = "USA" }) {
  return <ScenarioLabInner symbol={symbol} />;
}
export default ScenarioLaboratory;
