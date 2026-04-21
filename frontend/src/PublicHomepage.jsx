import React, { useEffect, useMemo, useState } from "react";

function useRevealAnimation() {
  useEffect(() => {
    const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));
    if (!revealItems.length) return;

    if (!("IntersectionObserver" in window)) {
      revealItems.forEach((item) => item.classList.add("in-view"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -40px 0px" }
    );

    revealItems.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);
}

export default function PublicHomepage() {
  const prefersDark = useMemo(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, []);

  const [theme, setTheme] = useState(prefersDark ? "dark" : "light");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useRevealAnimation();

  const switchTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  return (
    <div className="zc-home site-shell" data-theme={theme}>
      <a className="skip-link" href="#content">Skip to content</a>

      <header className="site-header">
        <div className="container nav">
          <a href="/" className="brand" aria-label="Zenin Capital home">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 17L12 7l7 10" />
                <path d="M8.5 17h7" />
              </svg>
            </span>
            <span>Zenin Capital</span>
          </a>

          <nav className={`nav-links ${mobileMenuOpen ? "open" : ""}`} aria-label="Primary">
            <a href="#features">Features</a>
            <a href="#signals">Signals</a>
            <a href="#coverage">Coverage</a>
            <a href="#contact">Contact</a>
          </nav>

          <div className={`nav-actions ${mobileMenuOpen ? "open" : ""}`}>
            <button className="theme-toggle" onClick={switchTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
              {theme === "dark" ? "☀" : "◐"}
            </button>
            <a className="btn btn-secondary" href="/auth?mode=signin">Sign in</a>
            <a className="btn btn-primary" href="/app">Open platform</a>
          </div>

          <button
            className="menu-toggle"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      <main id="content">
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy" data-reveal>
              <span className="eyebrow">Institutional market workspace</span>
              <h1>Track markets with conviction.</h1>
              <p>
                Zenin Capital is a <strong>Multi-Asset Portfolio Intelligence Platform</strong> built for disciplined investors.
                Monitor stocks, crypto, bonds, commodities, and macro indicators in one focused workspace with watchlists,
                theme layers, earnings visibility, and faster signal recognition.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="/app">Open platform</a>
                <a className="btn btn-ghost" href="#features">See the workflow</a>
              </div>
              <div className="hero-subgrid" aria-label="Platform highlights">
                <div className="proof-card"><span>Coverage</span><strong>5 market lenses</strong>Cross-asset visibility without switching tools.</div>
                <div className="proof-card"><span>Monitoring</span><strong>Live watchlists</strong>Theme-aware lists tied to events and signals.</div>
                <div className="proof-card"><span>Awareness</span><strong>Macro + earnings</strong>Key catalysts remain visible beside price action.</div>
              </div>
            </div>

            <div className="hero-visual" data-reveal>
              <div className="hero-visual-wrap">
                <div className="hero-orbit" aria-hidden="true" />
                <div className="terminal" aria-label="Zenin platform preview">
                  <div className="window-bar">
                    <div className="dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
                    <span>Zenin Capital / App Preview</span>
                  </div>
                  <div className="dashboard">
                    <div className="panel">
                      <div className="panel-title"><h3>Watchlist</h3><span className="pill">Live</span></div>
                      <div className="tabs">
                        <div className="tab active">Stocks</div><div className="tab">Crypto</div><div className="tab">Bonds</div><div className="tab">Commodities</div><div className="tab">Indicators</div>
                      </div>
                      <div className="list" style={{ marginTop: "1rem" }}>
                        <div className="asset-row"><div><b>NVDA</b><div className="muted">AI infrastructure</div></div><div className="muted">1D</div><div className="pos">+2.81%</div></div>
                        <div className="asset-row"><div><b>BTC</b><div className="muted">Digital reserve</div></div><div className="muted">1D</div><div className="pos">+1.44%</div></div>
                        <div className="asset-row"><div><b>TLT</b><div className="muted">Duration proxy</div></div><div className="muted">1D</div><div className="neg">-0.38%</div></div>
                        <div className="asset-row"><div><b>XAU</b><div className="muted">Gold spot</div></div><div className="muted">1D</div><div className="pos">+0.91%</div></div>
                      </div>
                      <div className="chart" aria-hidden="true" />
                    </div>

                    <div>
                      <div className="panel">
                        <div className="metric-header"><h3>Macro indicators</h3><span className="pill">Updated</span></div>
                        <div className="metric-band">
                          <div className="metric"><span className="muted">US CPI</span><strong>3.1%</strong><span className="muted">Cooling trend</span></div>
                          <div className="metric"><span className="muted">10Y yield</span><strong>4.28%</strong><span className="muted">Range-bound</span></div>
                        </div>
                      </div>
                      <div className="panel" style={{ marginTop: "1rem" }}>
                        <div className="panel-title"><h3>Earnings calendar</h3><span className="pill">Next 7 days</span></div>
                        <div className="list">
                          <div className="calendar-row"><div><b>MSFT</b><div className="muted">Cloud & AI</div></div><div className="muted">Tue</div><div>AMC</div></div>
                          <div className="calendar-row"><div><b>AMZN</b><div className="muted">Retail & cloud</div></div><div className="muted">Thu</div><div>AMC</div></div>
                          <div className="calendar-row"><div><b>COIN</b><div className="muted">Crypto exchange</div></div><div className="muted">Fri</div><div>BMO</div></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features">
          <div className="container">
            <div className="section-head">
              <h2>Designed to feel closer to the live platform.</h2>
              <p>
                This homepage keeps the visual language near the app: charcoal surfaces, thin neutral borders, compact
                modules, and calm teal emphasis where action or state matters.
              </p>
            </div>
            <div className="feature-grid">
              <article className="feature-card" data-reveal><h3>Thematic intelligence</h3><p>Organize assets by narrative, sector, or strategic exposure for watchlist-first monitoring.</p></article>
              <article className="feature-card" data-reveal><h3>Event awareness</h3><p>Keep macro releases and earnings in the same view as current market positioning.</p></article>
              <article className="feature-card" data-reveal><h3>Decision workspace</h3><p>Move from scanning to monitoring inside one command layer built for judgment.</p></article>
            </div>
          </div>
        </section>

        <section id="signals">
          <div className="container">
            <div className="section-head">
              <h2>Signal density without visual noise.</h2>
              <p>Zenin surfaces watchlists, macro readings, and event timing in a disciplined product rhythm.</p>
            </div>
            <div className="signal-grid">
              <article className="signal-card" data-reveal>
                <h3>Morning brief structure</h3>
                <div className="list" style={{ marginTop: "1rem" }}>
                  <div className="signal-row"><div><b>Theme pulse</b><div className="muted">AI, duration, precious metals</div></div><div className="muted">Now</div><div className="pos">Active</div></div>
                  <div className="signal-row"><div><b>Risk tone</b><div className="muted">Equity breadth stabilizing</div></div><div className="muted">Live</div><div className="pos">Firm</div></div>
                  <div className="signal-row"><div><b>Macro watch</b><div className="muted">Inflation and yields</div></div><div className="muted">Today</div><div>2 events</div></div>
                </div>
              </article>
              <article className="signal-card" data-reveal>
                <h3>Production-ready additions</h3>
                <p>Refined hierarchy, strong card structure, and responsive stacking to keep every block readable.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="coverage">
          <div className="container">
            <div className="section-head">
              <h2>Coverage mapped to core categories.</h2>
              <p>Stocks, crypto, bonds, commodities, and indicators in one unified market map.</p>
            </div>
            <div className="coverage-grid">
              <article className="coverage-card" data-reveal><h3>Stocks</h3><p>Monitor leaders, laggards, and thematic baskets.</p></article>
              <article className="coverage-card" data-reveal><h3>Crypto</h3><p>Track digital asset leadership with discipline.</p></article>
              <article className="coverage-card" data-reveal><h3>Bonds</h3><p>Keep rates-sensitive proxies visible.</p></article>
              <article className="coverage-card" data-reveal><h3>Commodities</h3><p>Bring hard-asset context into decisions.</p></article>
              <article className="coverage-card" data-reveal><h3>Indicators</h3><p>Macro context beside market action.</p></article>
            </div>
          </div>
        </section>

        <section id="contact">
          <div className="container">
            <div className="cta-panel" data-reveal>
              <div>
                <h2>Turn fragmented market screens into one coherent workflow.</h2>
                <p>Use Zenin as a focused operating layer for portfolio judgment.</p>
              </div>
              <div className="hero-actions" style={{ justifyContent: "flex-end", margin: 0 }}>
                <a className="btn btn-primary" href="/app">Launch app</a>
                <a className="btn btn-secondary" href="mailto:team@zenincapital.com">Get in touch</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div>
              <div className="brand" style={{ marginBottom: "1rem" }}>
                <span className="brand-mark" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 17L12 7l7 10" /><path d="M8.5 17h7" /></svg>
                </span>
                <span>Zenin Capital</span>
              </div>
              <p>A serious dark-mode market intelligence product built for cross-asset monitoring.</p>
            </div>
            <div><h4>Product</h4><a href="#features">Features</a><a href="#signals">Signals</a><a href="#coverage">Coverage</a></div>
            <div><h4>Company</h4><a href="#contact">Contact</a><a href="/auth?mode=signin">Sign in</a><a href="/app">Platform</a></div>
            <div><h4>Legal</h4><a href="#">Privacy policy</a><a href="#">Terms of use</a><a href="#">Disclosures</a></div>
          </div>
          <div className="footer-bottom"><span>© 2026 Zenin Capital. All rights reserved.</span><span>Multi-Asset Portfolio Intelligence Platform</span></div>
        </div>
      </footer>
    </div>
  );
}
