import React, { useEffect, useMemo, useState } from "react";
import "./public.css";
import { zeninFetch } from "./utils/zeninFetch";
import { ZeninLogo, LineZMark } from "./components/Branding";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applySeo, buildAbsoluteUrl, SITE_URL } from "./utils/seo";
import { clearPostAuthRedirect, getPostAuthRedirectPath, sanitizeInternalPath, storePostAuthRedirect } from "./utils/authRedirect";
import { useRuntimeConfig } from "./hooks/useRuntimeConfig";
import { getPublicRuntimeConfig } from "./config/runtimeConfigStore";

const HOME_URL = `${SITE_URL}/`;
const SOCIAL_IMAGE_URL = buildAbsoluteUrl("/og/zenin-capital-home.svg");
const SEO_TITLE = "Zenin Capital | Portfolio Tracker, Stock Research, Options Analysis, and Tax Estimator";
const SEO_DESCRIPTION = "Zenin Capital is a multi-asset market intelligence platform for portfolio tracking, stock research, options analysis, prediction-market monitoring, and tax estimation.";
const FAQ_ITEMS = [
  {
    question: "What can you track in Zenin Capital?",
    answer: "Zenin brings portfolio tracking, stock research, crypto monitoring, options analysis, prediction-market workflows, and tax estimation into one workspace."
  },
  {
    question: "Does Zenin support stocks, crypto, options, and prediction markets?",
    answer: "Yes. The platform is designed for cross-market workflows so investors and traders can move from research to execution without switching tools."
  },
  {
    question: "Who is Zenin built for?",
    answer: "Zenin is built for active investors, traders, and small desks that want deeper market context than a basic portfolio tracker without spreading their workflow across multiple apps."
  },
  {
    question: "How does Zenin help with tax workflows?",
    answer: "Zenin includes a tax estimator that helps users review capital-gains exposure across multiple jurisdictions alongside portfolio and trade activity."
  }
];

function normalizePlan(plan) {
  const validPlans = Array.isArray(getPublicRuntimeConfig()?.subscription?.validPlans)
    ? getPublicRuntimeConfig().subscription.validPlans
    : ["starter", "pro", "desk"];
  const value = String(plan || "").trim().toLowerCase();
  return validPlans.includes(value) ? value : "starter";
}

function normalizeBillingCycle(cycle) {
  const validBillingCycles = Array.isArray(getPublicRuntimeConfig()?.subscription?.validBillingCycles)
    ? getPublicRuntimeConfig().subscription.validBillingCycles
    : ["monthly", "yearly"];
  const value = String(cycle || "").trim().toLowerCase();
  return validBillingCycles.includes(value) ? value : "monthly";
}

function toMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(amount);
}

function getPlanPrice(plan, cycle) {
  const subscriptionConfig = getPublicRuntimeConfig()?.subscription || {};
  const yearlyDiscountRate = Number(subscriptionConfig?.yearlyDiscountRate || 0);
  const monthlyPrices = subscriptionConfig?.monthlyPrices || {};
  const normalizedPlan = normalizePlan(plan);
  const normalizedCycle = normalizeBillingCycle(cycle);
  const monthlyBase = Number(monthlyPrices[normalizedPlan] || 0);
  if (normalizedCycle === "monthly") {
    return {
      amount: monthlyBase,
      periodLabel: "/month",
      helperLabel: null,
      yearlyTotal: Math.round(monthlyBase * 12 * 100) / 100
    };
  }
  const yearlyTotal = Math.round(monthlyBase * 12 * (1 - yearlyDiscountRate) * 100) / 100;
  const monthlyEquivalent = Math.round((yearlyTotal / 12) * 100) / 100;
  const savePercent = Math.round(yearlyDiscountRate * 100);
  return {
    amount: yearlyTotal,
    periodLabel: "/year",
    helperLabel: monthlyBase > 0 ? `${toMoney(monthlyEquivalent)}/mo billed yearly · save ${savePercent}%` : null,
    yearlyTotal
  };
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
  useRuntimeConfig({ enabled: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState(() => readStoredAuthUser());
  const [authSyncing, setAuthSyncing] = useState(true);
  const [openAppChecking, setOpenAppChecking] = useState(false);
  const [pricingBusyPlan, setPricingBusyPlan] = useState("");
  const [pricingError, setPricingError] = useState("");
  const [authModal, setAuthModal] = useState({ open: false, mode: "signup", error: "" });
  const [AuthModalComponent, setAuthModalComponent] = useState(null);
  const [billingCycle, setBillingCycle] = useState(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("zenin_pricing_billing_cycle") : "";
    return normalizeBillingCycle(stored || "monthly");
  });
  const [postPlanTarget] = useState(() => {
    if (typeof window === "undefined") return "/app";
    return getPostAuthRedirectPath({ fallback: "/app" });
  });

  const activePlan = useMemo(
    () => normalizePlan(authUser?.currentPlan),
    [authUser?.currentPlan]
  );
  const activeBillingCycle = useMemo(
    () => normalizeBillingCycle(authUser?.currentBillingCycle || "monthly"),
    [authUser?.currentBillingCycle]
  );
  const hasAuthenticatedPlanContext = !authSyncing && Boolean(authUser?.id);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRootColorScheme = root.style.colorScheme;
    const prevBodyColorScheme = body.style.colorScheme;

    root.classList.remove("light-theme-active");
    body.classList.remove("light-theme-active");
    root.classList.add("page-dark-theme");
    body.classList.add("page-dark-theme");
    root.style.colorScheme = "dark";
    body.style.colorScheme = "dark";

    return () => {
      root.style.colorScheme = prevRootColorScheme;
      body.style.colorScheme = prevBodyColorScheme;
      root.classList.remove("page-dark-theme");
      body.classList.remove("page-dark-theme");
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryNext = sanitizeInternalPath(params.get("next"), "");
    if (queryNext) {
      storePostAuthRedirect(queryNext, "/app");
    }
    const requestedMode = String(params.get("auth") || "").trim().toLowerCase();
    const initialMode = ["signup", "signin", "forgot"].includes(requestedMode) ? requestedMode : "";
    const oauthError = String(params.get("oauthError") || params.get("error") || "").trim();
    if (initialMode || oauthError) {
      setAuthModal({
        open: true,
        mode: initialMode || "signin",
        error: oauthError
      });
    }
  }, []);

  useEffect(() => {
    const schema = [
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Zenin Capital",
        url: HOME_URL,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        description: SEO_DESCRIPTION,
        offers: [
          { "@type": "Offer", name: "Starter", price: "0", priceCurrency: "USD" },
          { "@type": "Offer", name: "Pro", price: "29", priceCurrency: "USD" },
          { "@type": "Offer", name: "Desk", price: "99", priceCurrency: "USD" }
        ],
        featureList: [
          "Portfolio tracking",
          "Stock research",
          "Options analysis",
          "Prediction-market monitoring",
          "Tax estimation"
        ]
      },
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Zenin Capital",
        url: HOME_URL,
        logo: SOCIAL_IMAGE_URL
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQ_ITEMS.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer
          }
        }))
      }
    ];

    applySeo({
      title: SEO_TITLE,
      description: SEO_DESCRIPTION,
      robots: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
      pathname: "/",
      canonicalPath: "/",
      ogTitle: SEO_TITLE,
      ogDescription: "Track portfolios, research stocks, model options, monitor prediction markets, and estimate taxes from one unified workspace.",
      ogImage: SOCIAL_IMAGE_URL,
      schema
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    import("./components/AuthModal")
      .then((mod) => {
        if (!cancelled) setAuthModalComponent(() => mod.default);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    zeninFetch("/auth/me")
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (!mounted) return;
        if (data?.authenticated && data?.user) {
          setAuthUser(data.user);
          saveAuthUser(data.user);
          setBillingCycle(normalizeBillingCycle(data.user.currentBillingCycle || "monthly"));
        } else {
          setAuthUser(null);
          localStorage.removeItem("zenin_auth_user");
          localStorage.removeItem("zenin_auth_expires_at");
        }
      })
      .catch((err) => {
        console.error("Session verification failed:", err);
      })
      .finally(() => {
        if (mounted) setAuthSyncing(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("zenin_pricing_billing_cycle", billingCycle);
  }, [billingCycle]);

  const handlePlanSelection = async (plan) => {
    const normalizedPlan = normalizePlan(plan);
    const normalizedBillingCycle = normalizeBillingCycle(billingCycle);
    setPricingError("");

    if (!authUser?.id) {
      // Allow guest to "select" a plan which will be reflected in the dashboard session
      window.location.href = postPlanTarget;
      return;
    }

    setPricingBusyPlan(normalizedPlan);
    try {
      const res = await zeninFetch("/account/plan", {
        method: "POST",
        body: JSON.stringify({ plan: normalizedPlan, billingCycle: normalizedBillingCycle })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to update plan.");
      if (data?.user) {
        setAuthUser(data.user);
        saveAuthUser(data.user);
      }
      clearPostAuthRedirect();
      window.location.href = postPlanTarget;
    } catch (error) {
      setPricingError(error?.message || "Could not connect plan to your account.");
    } finally {
      setPricingBusyPlan("");
    }
  };

  const isCurrentSelection = (plan) =>
    hasAuthenticatedPlanContext &&
    normalizePlan(plan) === activePlan &&
    activeBillingCycle === normalizeBillingCycle(billingCycle);

  const renderCtaText = (plan, fallback) => {
    if (pricingBusyPlan === plan) return "Saving...";
    if (isCurrentSelection(plan)) return "Current Plan";
    if (hasAuthenticatedPlanContext && activePlan === plan) {
      return billingCycle === "yearly" ? "Switch to Yearly" : "Switch to Monthly";
    }
    if (billingCycle === "yearly" && plan !== "starter") return `${fallback} Yearly`;
    return fallback;
  };

  const coveragePlanRefs = useMemo(() => ([
    {
      key: "starter",
      label: "Starter",
      description: "Core coverage for personal tracking",
      price: `${toMoney(getPlanPrice("starter", billingCycle).amount)}${getPlanPrice("starter", billingCycle).periodLabel}`
    },
    {
      key: "pro",
      label: "Pro",
      description: "Adds advanced analytics and journal depth",
      price: `${toMoney(getPlanPrice("pro", billingCycle).amount)}${getPlanPrice("pro", billingCycle).periodLabel}`
    },
    {
      key: "desk",
      label: "Desk",
      description: "Full multi-desk coverage and premium integrations",
      price: `${toMoney(getPlanPrice("desk", billingCycle).amount)}${getPlanPrice("desk", billingCycle).periodLabel}`
    }
  ]), [billingCycle]);

  const handleOpenAppClick = async (event) => {
    event.preventDefault();
    if (authUser) {
      window.location.href = postPlanTarget;
    } else {
      storePostAuthRedirect(postPlanTarget, "/app");
      setAuthModal({ open: true, mode: "signup", error: "" });
    }
  };

  const openAuthModal = (mode) => {
    storePostAuthRedirect(postPlanTarget, "/app");
    setAuthModal({ open: true, mode, error: "" });
  };

  const closeAuthModal = () => {
    setAuthModal((prev) => ({ ...prev, open: false, error: "" }));
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    url.searchParams.delete("oauthError");
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="zc-home">
      <header className="site-header">
        <div className="container nav">
          <a className="brand" href="#top" aria-label="Zenin Capital home">
            <ZeninLogo size="md" />
          </a>

          <nav className={`nav-links ${menuOpen ? "open" : ""}`} aria-label="Primary navigation">
            <a href="#features">Features</a>
            <a href="#coverage">Coverage</a>
            <a href="#pricing">Pricing</a>
            <a href="#about">About</a>
          </nav>

          <div className={`nav-actions ${menuOpen ? "open" : ""}`}>
            {!authUser && (
              <button 
                className="btn btn-secondary" 
                style={{ background: 'transparent', border: 'none', padding: '0 10px', boxShadow: 'none' }}
                onClick={(e) => { e.preventDefault(); openAuthModal("signin"); }}
              >
                Sign In
              </button>
            )}
            <a className="btn btn-primary" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
              {openAppChecking ? "Checking..." : "Open App →"}
            </a>
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
              <span className="eyebrow">Portfolio tracker and market intelligence</span>
              <h1>
                Track portfolios, <span className="gradient-text">research stocks,</span> model{" "}
                <span className="gradient-text">options,</span> and estimate taxes in one place.
              </h1>
              <p>
                Zenin Capital is a multi-asset market intelligence platform for investors and traders. Track portfolios,
                research stocks, monitor crypto and prediction markets, analyze options, and estimate taxes without
                splitting your workflow across multiple tools.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
                  {openAppChecking ? "Checking..." : "Open App →"}
                </a>
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
              <article className="feature-card"><div className="feature-icon icon-portfolio">◔</div><h3>Portfolio</h3><p>Manage holdings, trades, performance, and live P&amp;L.</p></article>
              <article className="feature-card"><div className="feature-icon icon-options">◉</div><h3>Options</h3><p>Analyze chains, simulate strategies, and model payoffs.</p></article>
              <article className="feature-card"><div className="feature-icon icon-predictions">↗</div><h3>Predictions</h3><p>Track markets, whale activity, and position insights.</p></article>
              <article className="feature-card"><div className="feature-icon icon-journal">📘</div><h3>Journal</h3><p>Log trades, review execution, and keep performance notes.</p></article>
              <article className="feature-card"><div className="feature-icon icon-analytics">▥</div><h3>Analytics</h3><p>Measure results with P&amp;L, win rate, and risk metrics.</p></article>
              <article className="feature-card"><div className="feature-icon icon-tax">⌘</div><h3>Tax Estimator</h3><p>Estimate capital gains across 40+ countries with exports.</p></article>
            </div>

            <section className="coverage-section" id="coverage">
              <div className="coverage-head">
                <div className="section-tag">Coverage</div>
                <h2>Cross-market coverage for stocks, crypto, options, and prediction markets</h2>
                <p>
                  Zenin is built to let you move from macro to execution without context switching.
                  Track equities, crypto, options, prediction markets, and tax workflows in one place so research,
                  execution, and review stay connected.
                </p>
                <div className="coverage-plan-refs">
                  {coveragePlanRefs.map((item) => (
                    <div key={item.key} className="coverage-plan-chip">
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                      <b>{item.price}</b>
                    </div>
                  ))}
                </div>
              </div>

              <div className="coverage-grid">
                <article className="coverage-card">
                  <h4>Markets</h4>
                  <ul>
                    <li>US and global equities</li>
                    <li>Crypto spot and derivatives</li>
                    <li>Options chains and strategy modeling</li>
                    <li>Prediction markets and whale flow</li>
                  </ul>
                </article>
                <article className="coverage-card">
                  <h4>Data Layers</h4>
                  <ul>
                    <li>Live pricing + watchlist snapshots</li>
                    <li>Company intelligence and catalysts</li>
                    <li>Macro indicators by country</li>
                    <li>Execution history and journal analytics</li>
                  </ul>
                </article>
                <article className="coverage-card">
                  <h4>Workflows</h4>
                  <ul>
                    <li>Portfolio tracking and rebalancing</li>
                    <li>Theme-based watchlist management</li>
                    <li>Risk-aware options planning</li>
                    <li>Tax estimation across jurisdictions</li>
                  </ul>
                </article>
              </div>

              <div className="coverage-kpis">
                <div><strong>5</strong><span>core market modules</span></div>
                <div><strong>40+</strong><span>tax jurisdictions</span></div>
                <div><strong>1</strong><span>unified dashboard</span></div>
              </div>
            </section>

            <section className="pricing-section" id="pricing">
              <div className="pricing-head">
                <div>
                  <div className="section-tag">Pricing</div>
                  <h2>Choose a plan for portfolio tracking and market research workflows</h2>
                  <p>Start free, then scale into deeper analytics, options research, and team-ready workflows when you need more coverage.</p>
                </div>
                <div className="pricing-billing-pill" aria-label="Billing cycle">
                  <button
                    type="button"
                    className={billingCycle === "monthly" ? "is-active" : ""}
                    onClick={() => setBillingCycle("monthly")}
                    aria-pressed={billingCycle === "monthly"}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={billingCycle === "yearly" ? "is-active" : ""}
                    onClick={() => setBillingCycle("yearly")}
                    aria-pressed={billingCycle === "yearly"}
                  >
                    Yearly
                  </button>
                </div>
              </div>

              <div className="pricing-grid">
                <article className="pricing-card">
                  <div className="pricing-card-head">
                    <h4>Starter</h4>
                    <span className="pricing-badge muted">For beginners</span>
                  </div>
                  <p className="pricing-desc">Personal market tracking and portfolio journaling.</p>
                  <div className="pricing-price">
                    <strong>{toMoney(getPlanPrice("starter", billingCycle).amount)}</strong>
                    <span>{getPlanPrice("starter", billingCycle).periodLabel}</span>
                  </div>
                  {getPlanPrice("starter", billingCycle).helperLabel ? (
                    <p className="pricing-price-helper">{getPlanPrice("starter", billingCycle).helperLabel}</p>
                  ) : null}
                  <ul className="pricing-list">
                    <li>1 live portfolio</li>
                    <li>Watchlist + macro alerts</li>
                    <li>Basic journal analytics</li>
                    <li>Email support</li>
                  </ul>
                  <button
                    className="btn btn-secondary pricing-cta"
                    onClick={() => handlePlanSelection("starter")}
                    disabled={pricingBusyPlan === "starter" || isCurrentSelection("starter")}
                  >
                    {renderCtaText("starter", "Get Started")}
                  </button>
                </article>

                <article className="pricing-card featured">
                  <div className="pricing-card-head">
                    <h4>Pro</h4>
                    <span className="pricing-badge">Most popular</span>
                  </div>
                  <p className="pricing-desc">Cross-market workflows for active investors and traders.</p>
                  <div className="pricing-price">
                    <strong>{toMoney(getPlanPrice("pro", billingCycle).amount)}</strong>
                    <span>{getPlanPrice("pro", billingCycle).periodLabel}</span>
                  </div>
                  {getPlanPrice("pro", billingCycle).helperLabel ? (
                    <p className="pricing-price-helper">{getPlanPrice("pro", billingCycle).helperLabel}</p>
                  ) : null}
                  <ul className="pricing-list">
                    <li>Unlimited portfolios</li>
                    <li>Company deep-dive module</li>
                    <li>Advanced options strategy lab</li>
                    <li>Prediction market flow tracker</li>
                  </ul>
                  <button
                    className="btn btn-primary pricing-cta"
                    onClick={() => handlePlanSelection("pro")}
                    disabled={pricingBusyPlan === "pro" || isCurrentSelection("pro")}
                  >
                    {renderCtaText("pro", "Start Pro")}
                  </button>
                </article>

                <article className="pricing-card">
                  <div className="pricing-card-head">
                    <h4>Desk</h4>
                    <span className="pricing-badge muted">For teams</span>
                  </div>
                  <p className="pricing-desc">Shared workspaces, controls, and premium integrations.</p>
                  <div className="pricing-price">
                    <strong>{toMoney(getPlanPrice("desk", billingCycle).amount)}</strong>
                    <span>{getPlanPrice("desk", billingCycle).periodLabel}</span>
                  </div>
                  {getPlanPrice("desk", billingCycle).helperLabel ? (
                    <p className="pricing-price-helper">{getPlanPrice("desk", billingCycle).helperLabel}</p>
                  ) : null}
                  <ul className="pricing-list">
                    <li>5 team seats included</li>
                    <li>Role-based permissions</li>
                    <li>Priority data refresh</li>
                    <li>Dedicated support channel</li>
                  </ul>
                  <button
                    className="btn btn-secondary pricing-cta"
                    onClick={() => handlePlanSelection("desk")}
                    disabled={pricingBusyPlan === "desk" || isCurrentSelection("desk")}
                  >
                    {renderCtaText("desk", "Choose Desk")}
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

            <section className="faq-section" id="faq" aria-labelledby="faq-title">
              <div className="about-head">
                <div className="section-tag">FAQ</div>
                <h2 id="faq-title">Questions investors and traders ask before switching platforms</h2>
                <p>
                  These are the most common questions around portfolio tracking, stock research, options analysis,
                  and tax workflows inside Zenin.
                </p>
              </div>

              <div className="faq-grid">
                {FAQ_ITEMS.map((item) => (
                  <article className="faq-card" key={item.question}>
                    <h3>{item.question}</h3>
                    <p>{item.answer}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="about-section" id="about">
              <div className="about-head">
                <div className="section-tag">About</div>
                <h2>Built by Jeremiah Kamama</h2>
                <p>
                  Autodidact focused on AI, crypto privacy, and DeFi research with practical work across machine learning,
                  policy, and on-the-ground ecosystem analysis.
                </p>
              </div>

              <div className="about-grid">
                <article className="about-card">
                  <h4>Focus Areas</h4>
                  <ul>
                    <li>Artificial Intelligence and applied ML systems</li>
                    <li>Crypto privacy and DeFi research</li>
                    <li>African startup and blockchain ecosystem analysis</li>
                  </ul>
                </article>

                <article className="about-card">
                  <h4>Selected Work</h4>
                  <ul>
                    <li>
                      Omdena + World Food Programme disaster-response challenge:
                      worked with 34 ML engineers from 19 countries to help model affected populations and customize relief packages.
                    </li>
                    <li>
                      Collaboration with Blockchain Club at Columbia University on
                      <a href="https://blockchain.mirror.xyz/I2bACAPl83UZ9ScCpYns1wyF1ZazHCdYU2eKe4-Xcuc" target="_blank" rel="noreferrer"> What Crypto Means to Africa</a>.
                    </li>
                    <li>
                      Summer Analyst at Audacity Fund and recipient of a DeFi Education Fund grant
                      for Africa crypto policy research.
                    </li>
                    <li>
                      Panel speaker at ETH Safari (September 2022) on
                      <a href="https://ethsafari2022.sched.com/event/1B2ZR/vc-investments-in-web3-tokens-vs-equity-decentralized-vcs" target="_blank" rel="noreferrer">
                        {" "}VC investments in web3: Tokens vs Equity - Decentralized VCs
                      </a>.
                    </li>
                  </ul>
                </article>
              </div>

              <div className="about-actions">
                <a className="btn btn-secondary" href="https://www.kamama.co/about-me/" target="_blank" rel="noreferrer">Read Full About</a>
                <a className="btn btn-primary" href="https://x.com/JeremiahKamama" target="_blank" rel="noreferrer">Connect on X</a>
              </div>
            </section>

            <div className="bottom-cta">
              <div>
                <h2>One platform for market research, portfolio management, and tax review</h2>
                <p>
                  Whether you are researching stocks, analyzing options, tracking portfolio risk, or reviewing taxes,
                  Zenin keeps the workflow in one place so you can focus on better decisions.
                </p>
                <div className="cta-actions">
                  <a className="btn btn-primary" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
                    {openAppChecking ? "Checking..." : "Open App →"}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-line">
          <span>© 2026 Zenin Capital. All rights reserved.</span>
        </div>

      </footer>
      <SpeedInsights />
      {AuthModalComponent ? (
        <AuthModalComponent
          isOpen={authModal.open}
          initialMode={authModal.mode}
          initialError={authModal.error}
          returnTo={postPlanTarget}
          onClose={closeAuthModal}
        />
      ) : null}
    </div>
  );
}
