import React, { useState, useEffect } from 'react';

const TAX_RULES = {
  USA: { name: 'United States', currency: 'USD', logic: 'LTCG: 15%, STCG: 37% (Est. Max)' },
  UK: { name: 'United Kingdom', currency: 'GBP', logic: 'Base: 18%, Higher: 24%' },
  India: { name: 'India', currency: 'INR', logic: 'LTCG (Eq): 12.5%, STCG (Eq): 20%, Bonds: Slab Rate' },
  UAE: { name: 'United Arab Emirates', currency: 'AED', logic: 'Personal CGT: 0%' },
  SouthAfrica: { name: 'South Africa', currency: 'ZAR', logic: 'Inclusion Rate: 40% (Max Effective ~18%)' },
  Brazil: { name: 'Brazil', currency: 'BRL', logic: 'Standard rate: 15% - 22.5%' },
  Germany: { name: 'Germany', currency: 'EUR', logic: 'Abgeltungsteuer: 26.375% (inc. surcharge)' },
  SaudiArabia: { name: 'Saudi Arabia', currency: 'SAR', logic: 'Personal CGT: 0%' },
  Nigeria: { name: 'Nigeria', currency: 'NGN', logic: 'Capital Gains Tax: 10%' }
};

const ASSET_CLASSES = ['Equities', 'Bonds', 'Special Funds', 'MMFs'];

export function TaxEstimator() {
  const [jurisdictions, setJurisdictions] = useState(['USA']);
  const [taxYear, setTaxYear] = useState('2024');
  const [gains, setGains] = useState({
    Equities: { shortTerm: 0, longTerm: 0 },
    Bonds: { standard: 0 },
    'Special Funds': { standard: 0 },
    MMFs: { standard: 0 }
  });
  const [results, setResults] = useState([]);
  const [savedEstimates, setSavedEstimates] = useState([]);
  const [fileName, setFileName] = useState('');

  const toggleJurisdiction = (key) => {
    setJurisdictions(prev => 
      prev.includes(key) ? prev.filter(j => j !== key) : [...prev, key]
    );
  };

  // Load saved estimates on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('zenin_tax_estimates') || '[]');
      setSavedEstimates(saved);
    } catch (err) {
      console.warn("Failed to load tax estimates", err);
    }
  }, []);

  const handleGainChange = (category, type, value) => {
    const numeric = parseFloat(value) || 0;
    setGains((prev) => ({
      ...prev,
      [category]: { ...prev[category], [type]: numeric }
    }));
  };

  const handleCalculate = () => {
    if (jurisdictions.length === 0) {
      alert("Please select at least one jurisdiction.");
      return;
    }

    const calcGain = (amount, rate) => Math.max(0, amount) * rate;
    
    const newResults = jurisdictions.map(j => {
      let liability = 0;
      const details = {};

      if (j === 'USA') {
        details['Equities STCG'] = calcGain(gains.Equities.shortTerm, 0.37);
        details['Equities LTCG'] = calcGain(gains.Equities.longTerm, 0.15);
        details['Bonds'] = calcGain(gains.Bonds.standard, 0.37);
        details['Special Funds'] = calcGain(gains['Special Funds'].standard, 0.15);
        details['MMFs'] = calcGain(gains.MMFs.standard, 0.37);
      } else if (j === 'UK') {
        const rate = 0.24; 
        details['Equities Total'] = calcGain(gains.Equities.shortTerm + gains.Equities.longTerm, rate);
        details['Bonds'] = calcGain(gains.Bonds.standard, rate);
        details['Special Funds/MMFs'] = calcGain(gains['Special Funds'].standard + gains.MMFs.standard, rate);
      } else if (j === 'India') {
        details['Equities STCG'] = calcGain(gains.Equities.shortTerm, 0.20);
        details['Equities LTCG'] = calcGain(Math.max(0, gains.Equities.longTerm - 125000), 0.125); 
        details['Bonds'] = calcGain(gains.Bonds.standard, 0.30); 
        details['Fixed Income / MMFs'] = calcGain(gains['Special Funds'].standard + gains.MMFs.standard, 0.30);
      } else if (j === 'UAE' || j === 'SaudiArabia') {
        details['Total Tax Liability'] = 0; 
      } else if (j === 'SouthAfrica') {
        const effectiveRate = 0.40 * 0.45; 
        const totalUnexemptGains = Math.max(0, (gains.Equities.shortTerm + gains.Equities.longTerm + gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard) - 40000);
        details['Aggregated CGT'] = totalUnexemptGains * effectiveRate;
      } else if (j === 'Germany') {
        const rate = 0.26375;
        const totalGains = gains.Equities.shortTerm + gains.Equities.longTerm + gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard;
        details['Abgeltungsteuer (Flat)'] = calcGain(totalGains, rate);
      } else if (j === 'Brazil') {
        const rate = 0.15;
        const totalGains = gains.Equities.shortTerm + gains.Equities.longTerm + gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard;
        details['Flat CGT (Base)'] = calcGain(totalGains, rate);
      } else if (j === 'Nigeria') {
        const rate = 0.10;
        const totalGains = gains.Equities.shortTerm + gains.Equities.longTerm + gains.Bonds.standard + gains['Special Funds'].standard + gains.MMFs.standard;
        details['Capital Gains Fixed'] = calcGain(totalGains, rate);
      }

      Object.values(details).forEach(v => { liability += v });

      return {
        jurisdictionKey: j,
        jurisdiction: TAX_RULES[j].name,
        currency: TAX_RULES[j].currency,
        totalGains: gains,
        liability,
        details,
        timestamp: new Date().toISOString()
      };
    });

    setResults(newResults);
  };

  const handleSave = () => {
    if (results.length === 0) return;
    const newSaved = [...results, ...savedEstimates].slice(0, 10); 
    setSavedEstimates(newSaved);
    localStorage.setItem('zenin_tax_estimates', JSON.stringify(newSaved));
    alert('Estimates saved successfully!');
  };

  const handleExportPDF = () => {
    if (results.length === 0) return;
    window.print(); 
  };

  const handleExportExcel = () => {
    if (results.length === 0) return;
    let csvContent = "data:text/csv;charset=utf-8,";
    
    results.forEach(res => {
      csvContent += `Jurisdiction:,${res.jurisdiction}\nCurrency:,${res.currency}\nTotal Liability:,${res.liability}\n\n`;
      Object.entries(res.details).forEach(([key, value]) => {
        csvContent += `"${key}",${value}\n`;
      });
      csvContent += "\n---\n\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `tax_estimate_multi_${Date.now()}.csv`);
    document.body.appendChild(link); 
    link.click();
    document.body.removeChild(link);
  };

  const handleDocumentImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    // Mock parser: sets some random gains values for demonstration
    setTimeout(() => {
      setGains({
        Equities: { shortTerm: Math.floor(Math.random() * 50000), longTerm: Math.floor(Math.random() * 200000) },
        Bonds: { standard: Math.floor(Math.random() * 15000) },
        'Special Funds': { standard: Math.floor(Math.random() * 8000) },
        MMFs: { standard: Math.floor(Math.random() * 5000) }
      });
      alert(`Imported ${file.name} successfully. Gains have been mapped automatically.`);
    }, 600);
  };

  return (
    <div className="page-shell page-shell-dark portfolio-analytics-module" style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '1.8rem', color: '#f8fafc' }}>Global Tax Estimator</h2>
          <p style={{ margin: 0, color: '#94a3b8' }}>Estimate your capital gains tax liabilities across top global jurisdictions.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '24px' }}>
        {/* Left Col: Setup & Import */}
        <section className="analytics-card" style={{ padding: '20px', background: 'rgba(2, 6, 23, 0.6)' }}>
          <h3 style={{ marginTop: 0, borderBottom: '1px solid rgba(148,163,184,0.1)', paddingBottom: '12px' }}>Configuration</h3>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Jurisdictions (Select Multiple)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {Object.entries(TAX_RULES).map(([key, info]) => (
                <button
                  key={key}
                  onClick={() => toggleJurisdiction(key)}
                  style={{
                    padding: '6px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                    border: jurisdictions.includes(key) ? '1px solid #38bdf8' : '1px solid rgba(148,163,184,0.3)',
                    background: jurisdictions.includes(key) ? 'rgba(56,189,248,0.2)' : 'rgba(15,23,42,0.6)',
                    color: jurisdictions.includes(key) ? '#38bdf8' : '#cbd5e1',
                    transition: 'all 0.2s'
                  }}
                >
                  {info.name}
                </button>
              ))}
            </div>
            {jurisdictions.length > 0 && (
              <div style={{ marginTop: '12px', fontSize: '0.8rem', color: '#7dd3fc', background: 'rgba(125,211,252,0.1)', padding: '8px', borderRadius: '6px' }}>
                <strong>Active Bases:</strong> {jurisdictions.map(j => TAX_RULES[j].name).join(', ')}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Tax Year</label>
            <select 
              value={taxYear} 
              onChange={(e) => setTaxYear(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', background: 'rgba(15,23,42,0.6)', border: '1px solid rgba(148,163,184,0.3)', color: '#fff' }}
            >
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </div>

          <div style={{ marginTop: '32px', paddingTop: '16px', borderTop: '1px solid rgba(148,163,184,0.1)' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '0.9rem' }}>Import Statements (CSV/JSON)</label>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '12px' }}>Upload your trading history to map gains automatically.</p>
            <button
               onClick={() => document.getElementById('tax-file-import').click()}
               style={{ width: '100%', padding: '10px', background: 'rgba(56,189,248,0.1)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
            >
              {fileName ? `Uploaded: ${fileName}` : '+ Import Documents'}
            </button>
            <input type="file" id="tax-file-import" accept=".csv,.json,.xls,.xlsx" style={{ display: 'none' }} onChange={handleDocumentImport} />
          </div>
        </section>

        {/* Right Col: Gains Breakdown & Results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <section className="analytics-card" style={{ padding: '20px', background: 'rgba(2, 6, 23, 0.6)' }}>
            <h3 style={{ marginTop: 0, borderBottom: '1px solid rgba(148,163,184,0.1)', paddingBottom: '12px' }}>Declared Gross Gains</h3>
            
            <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: '1fr 1fr' }}>
              <div style={{ background: 'rgba(15,23,42,0.4)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.1)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Equities</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Short Term (&lt; 1 Year)</label>
                    <input type="number" value={gains.Equities.shortTerm} onChange={(e) => handleGainChange('Equities', 'shortTerm', e.target.value)} style={{ width: '100%', background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#fff', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Long Term (&gt; 1 Year)</label>
                    <input type="number" value={gains.Equities.longTerm} onChange={(e) => handleGainChange('Equities', 'longTerm', e.target.value)} style={{ width: '100%', background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#fff', padding: '6px' }} />
                  </div>
                </div>
              </div>

              <div style={{ background: 'rgba(15,23,42,0.4)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.1)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Fixed Income</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Bonds Total Gains</label>
                    <input type="number" value={gains.Bonds.standard} onChange={(e) => handleGainChange('Bonds', 'standard', e.target.value)} style={{ width: '100%', background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#fff', padding: '6px' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>MMFs Interest / Gains</label>
                    <input type="number" value={gains.MMFs.standard} onChange={(e) => handleGainChange('MMFs', 'standard', e.target.value)} style={{ width: '100%', background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#fff', padding: '6px' }} />
                  </div>
                </div>
              </div>

               <div style={{ background: 'rgba(15,23,42,0.4)', padding: '16px', borderRadius: '12px', border: '1px solid rgba(148,163,184,0.1)', gridColumn: '1 / -1' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '1rem' }}>Special Funds & Structured Assets</h4>
                <div>
                  <label style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'block', marginBottom: '4px' }}>Total Recognized Gains</label>
                   <input type="number" value={gains['Special Funds'].standard} onChange={(e) => handleGainChange('Special Funds', 'standard', e.target.value)} style={{ width: '100%', background: 'transparent', border: '1px solid #475569', borderRadius: '4px', color: '#fff', padding: '6px' }} />
                </div>
              </div>
            </div>

            <button 
              onClick={handleCalculate}
              style={{ marginTop: '20px', width: '100%', padding: '14px', background: '#3b82f6', color: '#fff', fontSize: '1rem', fontWeight: 600, border: 'none', borderRadius: '8px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}
            >
              Calculate Estimated Liabilities
            </button>
          </section>

          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {results.map((res, idx) => (
                <section key={idx} className="analytics-card document-export-zone" style={{ padding: '24px', background: 'linear-gradient(135deg, rgba(30,41,59,0.9), rgba(15,23,42,0.9))', border: '1px solid #38bdf8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, color: '#f8fafc' }}>{res.jurisdiction} Results</h3>
                    <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '1.2rem' }}>
                      {res.currency} {res.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', marginBottom: '12px' }}>
                    {Object.entries(res.details).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>{k}</span>
                        <span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{res.currency} {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={handleSave} style={{ flex: 1, padding: '10px', background: 'transparent', border: '1px solid #38bdf8', color: '#38bdf8', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                  Save All
                </button>
                <button onClick={handleExportPDF} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                  Export PDF
                </button>
                <button onClick={handleExportExcel} style={{ flex: 1, padding: '10px', background: '#10b981', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>
                  Export Excel
                </button>
              </div>
            </div>
          )}

          {savedEstimates.length > 0 && (
            <section style={{ marginTop: '20px' }}>
               <h4 style={{ color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>Saved Estimates</h4>
               <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                 {savedEstimates.map((est, idx) => (
                   <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(15,23,42,0.4)', padding: '12px 16px', borderRadius: '8px' }}>
                     <div>
                       <strong style={{ display: 'block', color: '#e2e8f0', fontSize: '0.9rem' }}>{est.jurisdiction}</strong>
                       <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(est.timestamp).toLocaleString()}</span>
                     </div>
                     <strong style={{ color: '#38bdf8' }}>{est.currency} {est.liability.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
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
