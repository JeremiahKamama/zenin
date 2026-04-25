import React, { useEffect, useMemo, useState } from "react";
import { zeninFetch } from "./utils/zeninFetch";

const VALID_PLANS = ["starter", "pro", "desk"];

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  return VALID_PLANS.includes(value) ? value : "starter";
}

function readStoredAuthUser() {
  try {
    const raw = localStorage.getItem("zenin_auth_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuthUser(user) {
  if (!user) return;
  try {
    localStorage.setItem("zenin_auth_user", JSON.stringify(user));
    if (user.email) localStorage.setItem("zenin_email", user.email);
  } catch {
    // no-op
  }
}

export default function PublicHomepage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState(() => readStoredAuthUser());
  const [pricingBusyPlan, setPricingBusyPlan] = useState("");
  const [pricingError, setPricingError] = useState("");

  const activePlan = useMemo(
    () => normalizePlan(authUser?.currentPlan),
    [authUser?.currentPlan]
  );

  useEffect(() => {
    document.documentElement.classList.remove("light-theme-active");
  }, []);

  useEffect(() => {
    let mounted = true;
    const token = String(localStorage.getItem("zenin_auth_token") || "").trim();
    if (!token) return;
    zeninFetch("/auth/me")
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (!mounted) return;
        if (data?.authenticated && data?.user) {
          setAuthUser(data.user);
          saveAuthUser(data.user);
        }
      })
      .catch(() => {
        // best-effort sync
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handlePlanSelection = async (plan) => {
    const normalizedPlan = normalizePlan(plan);
    setPricingError("");

    const token = String(localStorage.getItem("zenin_auth_token") || "").trim();
    if (!token) {
      localStorage.setItem("zenin_pending_plan", normalizedPlan);
      window.location.href = `/auth?mode=signup&plan=${encodeURIComponent(normalizedPlan)}`;
      return;
    }

    setPricingBusyPlan(normalizedPlan);
    try {
      const res = await zeninFetch("/account/plan", {
        method: "POST",
        body: JSON.stringify({ plan: normalizedPlan })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update plan.");
      if (data?.user) {
        setAuthUser(data.user);
        saveAuthUser(data.user);
      }
      window.location.href = "/app";
    } catch (error) {
      setPricingError(error?.message || "Could not connect plan to your account.");
    } finally {
      setPricingBusyPlan("");
    }
  };

  return (
    <div className="zc-home">
      <header className="site-header">
        <div className="container nav">
          <a className="brand" href="#top" aria-label="Zenin Capital home">
            <span className="brand-mark"><span>Z</span></span>
            <span className="brand-text">
              <strong>Zenin</strong>
              <small>Capital</small>
            </span>
          </a>

          <nav className={`nav-links ${menuOpen ? "open" : ""}`} aria-label="Primary navigation">
            <a href="#features">Features</a>
            <a href="#screens">Screens</a>
            <a href="#coverage">Coverage</a>
            <a href="#pricing">Pricing</a>
            <a href="#about">About</a>
          </nav>

          <div className={`nav-actions ${menuOpen ? "open" : ""}`}>
            <a className="btn btn-primary" href="/app">Open App →</a>
          </div>

          <button
            className="menu-toggle"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <span className="eyebrow">All-in-one market intelligence</span>
              <h1>
                Everything you need to <span className="gradient-text">analyze, trade,</span> and{" "}
                <span className="gradient-text">outperform.</span>
              </h1>
              <p>
                Zenin Capital is a complete market intelligence platform for investors and traders. Track portfolios,
                discover opportunities, analyze companies, trade options, explore predictions, and estimate taxes — all
                in one place.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="/app">Open App →</a>
                <a className="btn btn-secondary" href="#features">Explore Features</a>
              </div>

            </div>

            <div className="hero-visual" id="screens">
              <div className="dashboard-shell">
                <div className="dashboard">
                  <div className="dashboard-main">
                    <div className="welcome-row">
                      <div>
                        <h3>Welcome back, Alex</h3>
                        <p>Here’s your portfolio overview</p>
                      </div>
                      <div className="status-pill">● Markets Open</div>
                    </div>

                    <div className="stats-grid">
                      <div className="stat-card">
                        <small>Total Balance</small>
                        <strong>$128,542.75</strong>
                        <span className="up">+2.45% today</span>
                      </div>
                      <div className="stat-card">
                        <small>Total Gain/Loss</small>
                        <strong className="up">+11.10%</strong>
                        <span className="up">+11.10%</span>
                      </div>
                      <div className="stat-card">
                        <small>Day Change</small>
                        <strong className="up">+0.98%</strong>
                        <span className="up">+0.98%</span>
                      </div>
                    </div>

                    <div className="main-panels">
                      <div className="panel panel-performance">
                        <div className="panel-head">
                          <h4>Portfolio Performance</h4>
                        </div>
                        <div className="chart">
                          <svg viewBox="0 0 700 260" preserveAspectRatio="none" aria-hidden="true">
                            <defs>
                              <linearGradient id="fillLine" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="rgba(46,108,255,0.45)" />
                                <stop offset="100%" stopColor="rgba(46,108,255,0.03)" />
                              </linearGradient>
                            </defs>
                            <path d="M0 198 C52 176, 88 145, 126 154 S204 210, 246 181 S330 116, 378 126 S478 95, 528 89 S620 70, 700 46 L700 260 L0 260 Z" fill="url(#fillLine)" />
                            <path d="M0 198 C52 176, 88 145, 126 154 S204 210, 246 181 S330 116, 378 126 S478 95, 528 89 S620 70, 700 46" fill="none" stroke="#2e6cff" strokeWidth="5" strokeLinecap="round" />
                          </svg>
                        </div>
                        <div className="axis-labels">
                          <span>Mar</span><span>Apr</span><span>May</span><span>Jun</span>
                        </div>
                        <div className="company-summary-card">
                          <div className="company-summary-head">
                            <strong>Company Snapshot</strong>
                            <span className="up">AAPL +2.15%</span>
                          </div>
                          <div className="company-summary-grid">
                            <div><small>Market Cap</small><b>$2.94T</b></div>
                            <div><small>P/E</small><b>31.4x</b></div>
                            <div><small>EPS (TTM)</small><b>$6.57</b></div>
                            <div><small>Revenue YoY</small><b className="up">+7.8%</b></div>
                          </div>
                        </div>
                      </div>

                      <div className="table-panel">
                        <div className="panel">
                          <div className="panel-head">
                            <h4>Top Positions</h4>
                          </div>
                          <div className="simple-table">
                            <div className="simple-row"><strong>AAPL</strong><span className="up">+2.15%</span></div>
                            <div className="simple-row"><strong>MSFT</strong><span className="up">+1.22%</span></div>
                            <div className="simple-row"><strong>NVDA</strong><span className="up">+3.45%</span></div>
                            <div className="simple-row"><strong>BTC</strong><span className="up">+2.86%</span></div>
                            <div className="simple-row"><strong>GOOGL</strong><span className="down">-0.45%</span></div>
                          </div>
                        </div>

                        <div className="panel">
                          <div className="panel-head">
                            <h4>Top Movers</h4>
                            <span className="tab">Daily</span>
                          </div>
                          <div className="simple-table">
                            <div className="simple-row"><strong>NVDA</strong><span className="up">+5.23%</span></div>
                            <div className="simple-row"><strong>AMD</strong><span className="up">+4.31%</span></div>
                            <div className="simple-row"><strong>SOL</strong><span className="up">+3.85%</span></div>
                            <div className="simple-row"><strong>PDD</strong><span className="up">+3.12%</span></div>
                            <div className="simple-row"><strong>META</strong><span className="up">+2.91%</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="container proof-bar">
            <div className="proof-grid">
              <div className="proof-item">
                <div className="proof-badge">★</div>
                <div><strong>Secure &amp; Private</strong><span>Bank-level security</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">☁</div>
                <div><strong>Real-time Data</strong><span>Live market updates</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">✓</div>
                <div><strong>All-in-One Platform</strong><span>Powerful &amp; integrated</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">🌐</div>
                <div><strong>Global Coverage</strong><span>Markets worldwide</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="features">
          <div className="container">
            <div className="section-head">
              <div className="section-tag">The Zenin Platform</div>
              <h2>Everything you need in one platform</h2>
              <p>Powerful tools and insights across every market and workflow.</p>
            </div>

            <div className="cards-grid">
              <article className="feature-card"><div className="feature-icon icon-watchlist">☆</div><h3>Watchlist</h3><p>Track assets, themes, earnings, and macro in one place.</p></article>
              <article className="feature-card"><div className="feature-icon icon-company">🏛</div><h3>Company Profile</h3><p>Deep stock research with news, insiders, earnings, and leadership context.</p></article>
              <article className="feature-card" id="coverage"><div className="feature-icon icon-portfolio">◔</div><h3>Portfolio</h3><p>Manage holdings, trades, performance, and live P&amp;L.</p></article>
              <article className="feature-card"><div className="feature-icon icon-options">◉</div><h3>Options</h3><p>Analyze chains, simulate strategies, and model payoffs.</p></article>
              <article className="feature-card"><div className="feature-icon icon-predictions">↗</div><h3>Predictions</h3><p>Track markets, whale activity, and position insights.</p></article>
              <article className="feature-card"><div className="feature-icon icon-journal">📘</div><h3>Journal</h3><p>Log trades, review execution, and keep performance notes.</p></article>
              <article className="feature-card"><div className="feature-icon icon-analytics">▥</div><h3>Analytics</h3><p>Measure results with P&amp;L, win rate, and risk metrics.</p></article>
              <article className="feature-card" id="about"><div className="feature-icon icon-tax">⌘</div><h3>Tax Estimator</h3><p>Estimate capital gains across 40+ countries with exports.</p></article>
            </div>

            <section className="pricing-section" id="pricing">
              <div className="pricing-head">
                <div>
                  <div className="section-tag">Pricing</div>
                  <h3>Pick your Zenin plan</h3>
                  <p>Start free, then scale into pro workflows when you need institutional-grade depth.</p>
                </div>
                <div className="pricing-billing-pill" aria-label="Billing cycle">
                  <span className="is-active">Monthly</span>
                  <span>Yearly</span>
                </div>
              </div>

              <div className="pricing-grid">
                <article className="pricing-card">
                  <div className="pricing-card-head">
                    <h4>Starter</h4>
                    <span className="pricing-badge muted">For beginners</span>
                  </div>
                  <p className="pricing-desc">Personal market tracking and portfolio journaling.</p>
                  <div className="pricing-price"><strong>$0</strong><span>/month</span></div>
                  <ul className="pricing-list">
                    <li>1 live portfolio</li>
                    <li>Watchlist + macro alerts</li>
                    <li>Basic journal analytics</li>
                    <li>Email support</li>
                  </ul>
                  <button
                    className="btn btn-secondary pricing-cta"
                    onClick={() => handlePlanSelection("starter")}
                    disabled={pricingBusyPlan === "starter" || activePlan === "starter"}
                  >
                    {pricingBusyPlan === "starter" ? "Saving..." : activePlan === "starter" ? "Current Plan" : "Get Started"}
                  </button>
                </article>

                <article className="pricing-card featured">
                  <div className="pricing-card-head">
                    <h4>Pro</h4>
                    <span className="pricing-badge">Most popular</span>
                  </div>
                  <p className="pricing-desc">Cross-market workflows for active investors and traders.</p>
                  <div className="pricing-price"><strong>$29</strong><span>/month</span></div>
                  <ul className="pricing-list">
                    <li>Unlimited portfolios</li>
                    <li>Company deep-dive module</li>
                    <li>Advanced options strategy lab</li>
                    <li>Prediction market flow tracker</li>
                  </ul>
                  <button
                    className="btn btn-primary pricing-cta"
                    onClick={() => handlePlanSelection("pro")}
                    disabled={pricingBusyPlan === "pro" || activePlan === "pro"}
                  >
                    {pricingBusyPlan === "pro" ? "Saving..." : activePlan === "pro" ? "Current Plan" : "Start Pro"}
                  </button>
                </article>

                <article className="pricing-card">
                  <div className="pricing-card-head">
                    <h4>Desk</h4>
                    <span className="pricing-badge muted">For teams</span>
                  </div>
                  <p className="pricing-desc">Shared workspaces, controls, and premium integrations.</p>
                  <div className="pricing-price"><strong>$99</strong><span>/month</span></div>
                  <ul className="pricing-list">
                    <li>5 team seats included</li>
                    <li>Role-based permissions</li>
                    <li>Priority data refresh</li>
                    <li>Dedicated support channel</li>
                  </ul>
                  <button
                    className="btn btn-secondary pricing-cta"
                    onClick={() => handlePlanSelection("desk")}
                    disabled={pricingBusyPlan === "desk" || activePlan === "desk"}
                  >
                    {pricingBusyPlan === "desk" ? "Saving..." : activePlan === "desk" ? "Current Plan" : "Choose Desk"}
                  </button>
                </article>
              </div>

              {pricingError ? <p className="pricing-error">{pricingError}</p> : null}

              <div className="pricing-compare">
                <div className="pricing-compare-head">
                  <h4>Feature comparison</h4>
                  <span>Built for progression from solo to desk-level workflows.</span>
                </div>
                <div className="pricing-table-wrap">
                  <table className="pricing-table">
                    <thead>
                      <tr>
                        <th>Capability</th>
                        <th>Starter</th>
                        <th>Pro</th>
                        <th>Desk</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Live pricing + watchlist</td>
                        <td>Included</td>
                        <td>Included</td>
                        <td>Included</td>
                      </tr>
                      <tr>
                        <td>Portfolio analytics depth</td>
                        <td>Basic</td>
                        <td>Advanced</td>
                        <td>Advanced + team view</td>
                      </tr>
                      <tr>
                        <td>Options strategy simulator</td>
                        <td>Limited</td>
                        <td>Full</td>
                        <td>Full</td>
                      </tr>
                      <tr>
                        <td>Prediction and whale feed</td>
                        <td>-</td>
                        <td>Included</td>
                        <td>Included</td>
                      </tr>
                      <tr>
                        <td>Team seats</td>
                        <td>1</td>
                        <td>1</td>
                        <td>5 included</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <div className="bottom-cta">
              <div>
                <h3>All the tools. One powerful platform.</h3>
                <p>
                  Whether you’re analyzing markets, building strategies, or optimizing taxes, Zenin brings it all together so you can focus on what matters — performance.
                </p>
                <div className="cta-actions">
                  <a className="btn btn-primary" href="/app">Open App →</a>
                  <a className="btn btn-secondary" href="#screens">See Screens</a>
                </div>
              </div>

              <div className="device-preview">
                <div className="laptop">
                  <div className="laptop-screen">
                    <div className="screen-label">Options</div>
                    <div className="screen-options-grid">
                      <div className="options-pill">Bull Call Spread</div>
                      <div className="options-pill">Iron Condor</div>
                      <div className="options-pill">Straddle</div>
                    </div>
                    <div className="screen-options-bars">
                      <span style={{ width: "72%" }} />
                      <span style={{ width: "54%" }} />
                      <span style={{ width: "88%" }} />
                    </div>
                  </div>
                </div>
                <div className="phone">
                  <div className="phone-screen">
                    <div className="screen-label">Analytics</div>
                    <div className="analytics-kpi-row">
                      <div><small>Win Rate</small><b>62%</b></div>
                      <div><small>Sharpe</small><b>1.38</b></div>
                    </div>
                    <div className="analytics-trend" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-line">
          <span>© 2026 Zenin Capital. All rights reserved.</span>
          <span>Responsive homepage concept built for all screen sizes.</span>
        </div>
      </footer>
    </div>
  );
}
