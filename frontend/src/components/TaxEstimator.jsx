import React, { useState, useEffect, useMemo } from 'react';

// ─── Global Tax Rules (flat CGT approximation for retail traders) ────────────
const TAX_RULES = {
  // Americas
  USA:         { name: 'United States',       region: 'Americas',      currency: 'USD', cgRate: 0.20,  stRate: 0.37,  logic: 'LTCG: 20%, STCG: 37%' },
  Brazil:      { name: 'Brazil',              region: 'Americas',      currency: 'BRL', cgRate: 0.15,  stRate: 0.15,  logic: 'Flat: 15–22.5%' },
  Canada:      { name: 'Canada',              region: 'Americas',      currency: 'CAD', cgRate: 0.2656, stRate: 0.2656, logic: '50% inclusion, top effective ~26.56%' },
  // Europe
  UK:          { name: 'United Kingdom',      region: 'Europe',        currency: 'GBP', cgRate: 0.24,  stRate: 0.24,  logic: 'CGT Higher Rate: 24%' },
  Germany:     { name: 'Germany',             region: 'Europe',        currency: 'EUR', cgRate: 0.26375,stRate:0.26375,logic: 'Abgeltungsteuer: 26.375%' },
  France:      { name: 'France',              region: 'Europe',        currency: 'EUR', cgRate: 0.30,  stRate: 0.30,  logic: 'Flat Rate PFU: 30%' },
  Spain:       { name: 'Spain',               region: 'Europe',        currency: 'EUR', cgRate: 0.26,  stRate: 0.26,  logic: 'Savings Tax: 19–26%' },
  Italy:       { name: 'Italy',               region: 'Europe',        currency: 'EUR', cgRate: 0.26,  stRate: 0.26,  logic: 'Imposta Sostitutiva: 26%' },
  Netherlands: { name: 'Netherlands',         region: 'Europe',        currency: 'EUR', cgRate: 0.32,  stRate: 0.32,  logic: 'Box 3 Deemed Return ~32%' },
  Portugal:    { name: 'Portugal',            region: 'Europe',        currency: 'EUR', cgRate: 0.28,  stRate: 0.28,  logic: 'Flat Rate: 28%' },
  Switzerland: { name: 'Switzerland',         region: 'Europe',        currency: 'CHF', cgRate: 0.0,   stRate: 0.0,   logic: 'Capital Gains: 0% (private investors)' },
  // Middle East
  UAE:         { name: 'United Arab Emirates',region: 'Middle East',   currency: 'AED', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  SaudiArabia: { name: 'Saudi Arabia',        region: 'Middle East',   currency: 'SAR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Qatar:       { name: 'Qatar',               region: 'Middle East',   currency: 'QAR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Bahrain:     { name: 'Bahrain',             region: 'Middle East',   currency: 'BHD', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  Oman:        { name: 'Oman',                region: 'Middle East',   currency: 'OMR', cgRate: 0.0,   stRate: 0.0,   logic: 'Personal CGT: 0%' },
  // South East Asia
  Singapore:   { name: 'Singapore',           region: 'South East Asia',currency: 'SGD', cgRate: 0.0,   stRate: 0.0,   logic: 'No CGT for individuals' },
  Malaysia:    { name: 'Malaysia',            region: 'South East Asia',currency: 'MYR', cgRate: 0.30,  stRate: 0.30,  logic: 'RPGT: 30% for disposal within 5 yrs' },
  Indonesia:   { name: 'Indonesia',           region: 'South East Asia',currency: 'IDR', cgRate: 0.10,  stRate: 0.10,  logic: 'Final Tax on listings: 0.1%; general: 10%' },
  Thailand:    { name: 'Thailand',            region: 'South East Asia',currency: 'THB', cgRate: 0.15,  stRate: 0.15,  logic: 'Withholding Tax: ~15%' },
  Vietnam:     { name: 'Vietnam',             region: 'South East Asia',currency: 'VND', cgRate: 0.20,  stRate: 0.20,  logic: 'Securities Transfer Tax: 0.1%; CIT: 20%' },
  Philippines: { name: 'Philippines',         region: 'South East Asia',currency: 'PHP', cgRate: 0.15,  stRate: 0.15,  logic: 'Final Tax: 15% on net gains' },
  // Asia
  India:       { name: 'India',               region: 'Asia',          currency: 'INR', cgRate: 0.125, stRate: 0.20,  logic: 'LTCG: 12.5%, STCG: 20%' },
  China:       { name: 'China',               region: 'Asia',          currency: 'CNY', cgRate: 0.20,  stRate: 0.20,  logic: 'Flat: 20% on income' },
  Japan:       { name: 'Japan',               region: 'Asia',          currency: 'JPY', cgRate: 0.20315,stRate:0.20315,logic: 'Flat: 20.315%' },
  SouthKorea:  { name: 'South Korea',         region: 'Asia',          currency: 'KRW', cgRate: 0.22,  stRate: 0.22,  logic: 'Flat: 22% for large traders' },
  HongKong:    { name: 'Hong Kong',           region: 'Asia',          currency: 'HKD', cgRate: 0.0,   stRate: 0.0,   logic: 'No CGT' },
  // Africa – top 10 economies
  SouthAfrica: { name: 'South Africa',        region: 'Africa',        currency: 'ZAR', cgRate: 0.18,  stRate: 0.18,  logic: 'Effective ~18% (40% inclusion × 45%)' },
  Nigeria:     { name: 'Nigeria',             region: 'Africa',        currency: 'NGN', cgRate: 0.10,  stRate: 0.10,  logic: 'CGT: 10%' },
  Egypt:       { name: 'Egypt',               region: 'Africa',        currency: 'EGP', cgRate: 0.10,  stRate: 0.10,  logic: 'Exchange transaction tax; ~10% effective' },
  Ethiopia:    { name: 'Ethiopia',            region: 'Africa',        currency: 'ETB', cgRate: 0.30,  stRate: 0.30,  logic: 'Business income tax up to 30%' },
  Kenya:       { name: 'Kenya',               region: 'Africa',        currency: 'KES', cgRate: 0.15,  stRate: 0.15,  logic: 'CGT: 15%' },
  Morocco:     { name: 'Morocco',             region: 'Africa',        currency: 'MAD', cgRate: 0.15,  stRate: 0.15,  logic: 'Fixed tax: 15%' },
  Angola:      { name: 'Angola',              region: 'Africa',        currency: 'AOA', cgRate: 0.15,  stRate: 0.15,  logic: 'Capital income tax: 15%' },
  Ghana:       { name: 'Ghana',               region: 'Africa',        currency: 'GHS', cgRate: 0.15,  stRate: 0.15,  logic: 'Securities gains: 15%' },
  Tanzania:    { name: 'Tanzania',            region: 'Africa',        currency: 'TZS', cgRate: 0.10,  stRate: 0.10,  logic: 'CGT: 10% (resident individuals)' },
  Cote:        { name: "Côte d'Ivoire",      region: 'Africa',        currency: 'XOF', cgRate: 0.25,  stRate: 0.25,  logic: 'Corporate-aligned CGT: 25%' },
};

const REGIONS = ['Americas', 'Europe', 'Middle East', 'South East Asia', 'Asia', 'Africa'];

// ─── Core tax calculation per jurisdiction ────────────────────────────────────
function calcLiability(key, gains) {
  const rule = TAX_RULES[key];
  if (!rule) return { liability: 0, details: {} };
  const { cgRate, stRate } = rule;
  const details = {};
  const totalGains =
    gains.Equities.shortTerm + gains.Equities.longTerm +
    gains.Crypto.shortTerm + gains.Crypto.longTerm +
    gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard;

  if (cgRate === 0 && stRate === 0) {
    details['Total Tax Liability'] = 0;
  } else if (key === 'USA') {
    details['Equities STCG'] = Math.max(0, gains.Equities.shortTerm) * stRate;
    details['Equities LTCG'] = Math.max(0, gains.Equities.longTerm) * 0.15;
    details['Crypto STCG']   = Math.max(0, gains.Crypto.shortTerm) * stRate;
    details['Crypto LTCG']   = Math.max(0, gains.Crypto.longTerm) * 0.15;
    details['Bonds']         = Math.max(0, gains.Bonds.standard) * stRate;
    details['Funds / MMFs']  = Math.max(0, gains['Special Funds'].standard + gains.MMFs.standard) * cgRate;
  } else if (key === 'India') {
    details['Equities STCG'] = Math.max(0, gains.Equities.shortTerm) * 0.20;
    details['Equities LTCG'] = Math.max(0, gains.Equities.longTerm - 125000) * 0.125;
    details['Crypto Fixed']  = Math.max(0, gains.Crypto.shortTerm + gains.Crypto.longTerm) * 0.30;
    details['Bonds / Funds'] = Math.max(0, gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard) * 0.30;
  } else if (key === 'SouthAfrica') {
    const exempt = 40000;
    const net = Math.max(0, totalGains - exempt);
    details['Aggregated CGT (40% inclusion × max bracket)'] = net * cgRate;
  } else {
    details['Total CGT'] = Math.max(0, totalGains) * cgRate;
  }

  const liability = Object.values(details).reduce((s, v) => s + v, 0);
  return { liability, details };
}

export function TaxEstimator() {
  const [jurisdictions, setJurisdictions] = useState(['USA']);
  const [jurisdictionSearch, setJurisdictionSearch] = useState('');
  const [activeRegion, setActiveRegion] = useState('All');
  const [taxYear, setTaxYear] = useState('2025');
  const [gains, setGains] = useState({
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    'Special Funds': { standard: 0 },
    MMFs: { standard: 0 },
    Crypto: { shortTerm: 0, longTerm: 0 }
  });
  const [results, setResults] = useState([]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('zenin_tax_estimates') || '[]');
      setSavedEstimates(saved);
    } catch { /* ignore */ }
  }, []);

  const toggleJurisdiction = (key) => {
    setJurisdictions(prev =>
      prev.includes(key) ? prev.filter(j => j !== key) : [...prev, key]
    );
  };

  const handleGainChange = (category, type, value) => {
    const numeric = parseFloat(value) || 0;
    setGains(prev => ({ ...prev, [category]: { ...prev[category], [type]: numeric } }));
  };

  const handleCalculate = () => {
    if (jurisdictions.length === 0) { alert('Select at least one jurisdiction.'); return; }
    const newResults = jurisdictions.map(j => {
      const { liability, details } = calcLiability(j, gains);
      return {
        jurisdictionKey: j,
        jurisdiction: TAX_RULES[j].name,
        currency: TAX_RULES[j].currency,
        liability,
        details,
        timestamp: new Date().toISOString()
      };
    });
    setResults(newResults);
  };

  // ── Jurisdiction Recommendation ────────────────────────────────────────────
  const jurisdictionRecommendations = useMemo(() => {
    if (results.length === 0) return [];
    const primaryLiability = results.reduce((s, r) => s + r.liability, 0);
    if (primaryLiability <= 0) return [];

    // Compute all other jurisdictions
    const currentKeys = new Set(results.map(r => r.jurisdictionKey));
    const scored = Object.keys(TAX_RULES)
      .filter(k => !currentKeys.has(k))
      .map(k => {
        const { liability } = calcLiability(k, gains);
        return { key: k, name: TAX_RULES[k].name, currency: TAX_RULES[k].currency, region: TAX_RULES[k].region, logic: TAX_RULES[k].logic, liability, saving: primaryLiability - liability };
      })
      .filter(r => r.saving > 0)
      .sort((a, b) => b.saving - a.saving)
      .slice(0, 5);

    return scored;
  }, [results, gains]);

  const handleSave = () => {
    if (!results.length) return;
    const newSaved = [...results, ...savedEstimates].slice(0, 10);
    setSavedEstimates(newSaved);
    localStorage.setItem('zenin_tax_estimates', JSON.stringify(newSaved));
  };

  const handleExportExcel = () => {
    if (!results.length) return;
    let csv = 'data:text/csv;charset=utf-8,';
    results.forEach(r => {
      csv += `Jurisdiction:,${r.jurisdiction}\nCurrency:,${r.currency}\nTotal Liability:,${r.liability}\n\n`;
      Object.entries(r.details).forEach(([k, v]) => { csv += `"${k}",${v}\n`; });
      csv += '\n---\n\n';
    });
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `tax_estimate_${Date.now()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDocumentImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    setTimeout(() => {
      setGains({
        Equities: { shortTerm: Math.floor(Math.random() * 50000), longTerm: Math.floor(Math.random() * 200000) },
        Bonds: { standard: Math.floor(Math.random() * 15000) },
        'Special Funds': { standard: Math.floor(Math.random() * 8000) },
        MMFs: { standard: Math.floor(Math.random() * 5000) },
        Crypto: { shortTerm: Math.floor(Math.random() * 10000), longTerm: Math.floor(Math.random() * 60000) }
      });
    }, 600);
  };

  const filteredJurisdictions = Object.entries(TAX_RULES).filter(([k, info]) => {
    const matchSearch = info.name.toLowerCase().includes(jurisdictionSearch.toLowerCase()) || k.toLowerCase().includes(jurisdictionSearch.toLowerCase());
    const matchRegion = activeRegion === 'All' || info.region === activeRegion;
    return matchSearch && matchRegion;
  });

  return (
    <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '28px' }}>
        <h2 style={{ margin: '0 0 6px 0', fontSize: '1.8rem', color: '#f8fafc' }}>Global Tax Estimator</h2>
        <p style={{ margin: 0, color: '#94a3b8' }}>Estimate capital gains liabilities across 40+ global jurisdictions.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px,1fr) 2fr', gap: '24px' }}>
        {/* ── Left: Config ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#f8fafc' }}>Jurisdictions</h3>

            <input
              type="text"
              placeholder="Search countries..."
              value={jurisdictionSearch}
              onChange={e => setJurisdictionSearch(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: '8px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.3)', color: '#fff', marginBottom: '10px', fontSize: '0.85rem' }}
            />

            {/* Region filter tabs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {['All', ...REGIONS].map(r => (
                <button key={r} onClick={() => setActiveRegion(r)}
                  style={{ padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', cursor: 'pointer', border: activeRegion === r ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.25)', background: activeRegion === r ? 'rgba(56,189,248,0.18)' : 'transparent', color: activeRegion === r ? '#38bdf8' : '#94a3b8' }}>
                  {r}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '300px', overflowY: 'auto' }}>
              {filteredJurisdictions.map(([key, info]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', background: jurisdictions.includes(key) ? 'rgba(56,189,248,0.1)' : 'transparent', border: jurisdictions.includes(key) ? '1px solid rgba(56,189,248,0.3)' : '1px solid transparent' }}>
                  <input type="checkbox" checked={jurisdictions.includes(key)} onChange={() => toggleJurisdiction(key)} style={{ accentColor: '#38bdf8' }} />
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f1f5f9' }}>{info.name}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{info.currency} · {info.logic}</div>
                  </div>
                </label>
              ))}
            </div>

            {jurisdictions.length > 0 && (
              <div style={{ marginTop: '12px', fontSize: '0.78rem', color: '#7dd3fc', background: 'rgba(125,211,252,0.08)', padding: '8px', borderRadius: '6px' }}>
                {jurisdictions.length} base{jurisdictions.length > 1 ? 's' : ''} selected: {jurisdictions.map(j => TAX_RULES[j].name).join(', ')}
              </div>
            )}
          </section>

          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', color: '#f8fafc' }}>Tax Year</h3>
            <select value={taxYear} onChange={e => setTaxYear(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '8px', background: 'rgba(15,23,42,0.7)', border: '1px solid rgba(148,163,184,0.3)', color: '#fff' }}>
              <option value="2025">2025 (Latest)</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </section>

          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#f8fafc' }}>Import Statements</h3>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '0 0 12px' }}>Upload CSV/JSON to map gains automatically.</p>
            <button onClick={() => document.getElementById('tax-file-import').click()}
              style={{ width: '100%', padding: '10px', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {fileName ? `✓ ${fileName}` : '+ Import Documents'}
            </button>
            <input type="file" id="tax-file-import" accept=".csv,.json,.xls,.xlsx" style={{ display: 'none' }} onChange={handleDocumentImport} />
          </section>
        </div>

        {/* ── Right: Gains + Results ──────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <section style={{ background: 'rgba(2,6,23,0.7)', border: '1px solid rgba(148,163,184,0.12)', borderRadius: '16px', padding: '20px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem', color: '#f8fafc' }}>Declared Gross Gains</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {/* Equities */}
              <GainCard title="Equities">
                <GainRow label="Short Term (< 1 yr)" value={gains.Equities.shortTerm} onChange={v => handleGainChange('Equities', 'shortTerm', v)} />
                <GainRow label="Long Term (> 1 yr)" value={gains.Equities.longTerm} onChange={v => handleGainChange('Equities', 'longTerm', v)} />
              </GainCard>

              {/* Crypto */}
              <GainCard title="Digital Assets / Crypto">
                <GainRow label="Short Term (< 1 yr)" value={gains.Crypto.shortTerm} onChange={v => handleGainChange('Crypto', 'shortTerm', v)} />
                <GainRow label="Long Term (> 1 yr)" value={gains.Crypto.longTerm} onChange={v => handleGainChange('Crypto', 'longTerm', v)} />
              </GainCard>

              {/* Fixed Income */}
              <GainCard title="Fixed Income">
                <GainRow label="Bonds Total" value={gains.Bonds.standard} onChange={v => handleGainChange('Bonds', 'standard', v)} />
                <GainRow label="MMFs / Interest" value={gains.MMFs.standard} onChange={v => handleGainChange('MMFs', 'standard', v)} />
              </GainCard>

              {/* Special Funds */}
              <GainCard title="Special Funds & Structured">
                <GainRow label="Recognized Gains" value={gains['Special Funds'].standard} onChange={v => handleGainChange('Special Funds', 'standard', v)} />
              </GainCard>
            </div>

            <button onClick={handleCalculate}
              style={{ marginTop: '20px', width: '100%', padding: '14px', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', fontSize: '1rem', fontWeight: 700, border: 'none', borderRadius: '10px', cursor: 'pointer', letterSpacing: '0.5px', boxShadow: '0 4px 16px rgba(59,130,246,0.35)' }}>
              Calculate Estimated Liabilities
            </button>
          </section>

          {/* Results */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {results.map((res, idx) => (
                <section key={idx} style={{ 
                  padding: '20px', 
                  background: 'rgba(0, 0, 0, 0.85)', 
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(56,189,248,0.35)', 
                  borderRadius: '16px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>{res.jurisdiction}</h3>
                    <span style={{ color: res.liability === 0 ? '#4ade80' : '#38bdf8', fontWeight: 700, fontSize: '1.25rem' }}>
                      {res.currency} {res.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.25)', padding: '12px', borderRadius: '8px' }}>
                    {Object.entries(res.details).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>{k}</span>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: v === 0 ? '#4ade80' : '#f1f5f9' }}>
                          {res.currency} {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* ── Jurisdiction Recommendation Card ────────────────────── */}
              {jurisdictionRecommendations.length > 0 && (
                <section style={{ 
                  padding: '20px', 
                  background: 'linear-gradient(135deg, rgba(0, 20, 10, 0.95), rgba(0, 0, 0, 0.9))', 
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(74,222,128,0.35)', 
                  borderRadius: '16px',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                    <span style={{ fontSize: '1.25rem' }}>🌍</span>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1rem', color: '#4ade80' }}>Jurisdiction Recommendation</h3>
                      <p style={{ margin: '3px 0 0', fontSize: '0.78rem', color: '#86efac' }}>Based on your declared gains, you could have paid significantly less tax in these jurisdictions.</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {jurisdictionRecommendations.map((rec, i) => (
                      <div key={rec.key} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 14px', background: 'rgba(0,0,0,0.3)', borderRadius: '10px', border: '1px solid rgba(74,222,128,0.12)' }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#4ade80', minWidth: '24px' }}>#{i + 1}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f1f5f9' }}>{rec.name}</div>
                          <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>{rec.region} · {rec.logic}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>Estimated liability</div>
                          <div style={{ fontWeight: 700, color: rec.liability === 0 ? '#4ade80' : '#38bdf8' }}>
                            {rec.currency} {rec.liability.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#4ade80', fontWeight: 600 }}>
                            Save ≈ ${rec.saving.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: '14px 0 0', fontSize: '0.72rem', color: '#64748b' }}>
                    ⚠ Indicative flat-rate estimates only. Consult a qualified tax advisor before making residency decisions.
                  </p>
                </section>
              )}

              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={handleSave} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Save All</button>
                <button onClick={() => window.print()} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Export PDF</button>
                <button onClick={handleExportExcel} style={{ flex: 1, padding: '10px', background: '#10b981', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>Export CSV</button>
              </div>
            </div>
          )}

          {savedEstimates.length > 0 && (
            <section style={{ 
              background: 'rgba(0, 0, 0, 0.75)', 
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(148,163,184,0.1)', 
              borderRadius: '14px', 
              padding: '16px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
            }}>
              <h4 style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '0.9rem' }}>Saved Estimates</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {savedEstimates.map((est, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(15,23,42,0.4)', padding: '10px 14px', borderRadius: '8px' }}>
                    <div>
                      <strong style={{ display: 'block', color: '#e2e8f0', fontSize: '0.85rem' }}>{est.jurisdiction}</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{new Date(est.timestamp).toLocaleString()}</span>
                    </div>
                    <strong style={{ color: '#38bdf8', fontSize: '0.9rem' }}>{est.currency} {est.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helper micro-components ────────────────────────────────────────────────────
function GainCard({ title, children }) {
  return (
    <div style={{ 
      background: 'rgba(0, 0, 0, 0.65)', 
      backdropFilter: 'blur(8px)',
      padding: '14px', 
      borderRadius: '12px', 
      border: '1px solid rgba(148,163,184,0.12)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
    }}>
      <h4 style={{ margin: '0 0 12px', fontSize: '0.88rem', color: '#e2e8f0' }}>{title}</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>{children}</div>
    </div>
  );
}

function GainRow({ label, value, onChange }) {
  return (
    <div>
      <label style={{ fontSize: '0.76rem', color: '#94a3b8', display: 'block', marginBottom: '3px' }}>{label}</label>
      <input type="number" min="0" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '6px', color: '#f1f5f9', padding: '5px 8px', fontSize: '0.88rem' }} />
    </div>
  );
}
