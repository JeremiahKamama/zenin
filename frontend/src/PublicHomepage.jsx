import React, { useEffect, useMemo, useState } from "react";
import "./public.css";
import { zeninFetch } from "./utils/zeninFetch";
import { ZeninLogo, LineZMark } from "./components/Branding";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applySeo, buildAbsoluteUrl, SITE_URL } from "./utils/seo";
import { clearPostAuthRedirect, getPostAuthRedirectPath, sanitizeInternalPath, storePostAuthRedirect } from "./utils/authRedirect";
import { useRuntimeConfig } from "./hooks/useRuntimeConfig";
import { getPublicRuntimeConfig } from "./config/runtimeConfigStore";
import { ensureZeninSessionFromSupabase } from "./utils/backendAuth";
import { updateAccountPlan } from "./utils/accountPlan";

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
    answer: "Yes. The platform is designed for cross-market research workflows so investors and desks can move from context to decision review without switching tools."
  },
  {
    question: "Who is Zenin built for?",
    answer: "Zenin is built for active investors, analysts, and small research desks that want deeper market context than a basic portfolio tracker without spreading their workflow across multiple apps."
  },
  {
    question: "How does Zenin help with tax workflows?",
    answer: "Zenin includes a tax estimator that helps users review capital-gains exposure across multiple jurisdictions alongside portfolio activity."
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
  const [selectedPlan, setSelectedPlan] = useState("");
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
      const authUrl = new URL("/auth", window.location.origin);
      authUrl.searchParams.set("mode", initialMode || "signin");
      if (queryNext) authUrl.searchParams.set("next", queryNext);
      if (oauthError) authUrl.searchParams.set("error", oauthError);
      window.location.replace(`${authUrl.pathname}${authUrl.search}${authUrl.hash}`);
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
    let mounted = true;
    zeninFetch("/auth/me", { timeoutMs: 3500 })
      .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }))
      .then(async ({ ok, data }) => {
        if (ok && (!data?.authenticated || !data?.user) && mounted) {
          const exchanged = await ensureZeninSessionFromSupabase();
          if (exchanged?.user) {
            return zeninFetch("/auth/me", { timeoutMs: 3500 })
              .then(async (res) => ({ ok: res.ok, data: await res.json().catch(() => ({})) }));
          }
        }
        return { ok, data };
      })
      .then(({ data }) => {
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

  const handleCardSelect = (plan) => {
    setSelectedPlan((prev) => (normalizePlan(prev) === normalizePlan(plan) ? "" : normalizePlan(plan)));
  };

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
      const data = await updateAccountPlan({
        plan: normalizedPlan,
        billingCycle: normalizedBillingCycle
      });
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

  const handleOpenAppClick = async (event) => {
    event.preventDefault();
    if (authUser) {
      window.location.href = postPlanTarget;
    } else {
      storePostAuthRedirect(postPlanTarget, "/app");
      window.location.href = `/auth?mode=signin&next=${encodeURIComponent(postPlanTarget)}`;
    }
  };

  const openAuthModal = (mode) => {
    storePostAuthRedirect(postPlanTarget, "/app");
    window.location.href = `/auth?mode=${encodeURIComponent(mode)}&next=${encodeURIComponent(postPlanTarget)}`;
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
                className="btn btn-secondary btn-halo"
                style={{ background: 'transparent', border: '1px solid var(--color-border-medium)', padding: '0 12px' }}
                onClick={(e) => { e.preventDefault(); openAuthModal("signup"); }}
              >
                Sign Up
              </button>
            )}
            <a className="btn btn-primary btn-halo" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
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
                Track portfolios, <span className="text-white">research stocks,</span> model{" "}
                <span className="text-white">options,</span> and estimate taxes in one place.
              </h1>
              <p>
                Zenin Capital is a multi-asset market intelligence platform for investors and traders. Track portfolios,
                research stocks, monitor crypto and prediction markets, analyze options, and estimate taxes without
                splitting your workflow across multiple tools.
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-halo" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
                  {openAppChecking ? "Checking..." : "Open App →"}
                </a>
                <a className="btn btn-secondary" href="#features">Explore Features</a>
              </div>

            </div>

            <div className="hero-visual" id="screens">
              <div className="product-proof-shell" aria-label="Current Zenin app modules preview">
                <div className="product-proof-topbar">
                  <div>
                    <span>Zenin workspace</span>
                    <strong>Current multi-desk app surface</strong>
                  </div>
                </div>

                <div className="product-proof-workspace">
                  <aside className="product-proof-nav" aria-hidden="true">
                    {["WL", "PF", "EQ", "OP", "PM", "TX"].map((item, index) => (
                      <span key={item} className={index === 1 ? "active" : ""}>{item}</span>
                    ))}
                  </aside>

                  <div className="product-proof-main">
                    <div className="product-proof-command">
                      <span>Portfolio Module</span>
                      <strong>$148,260</strong>
                      <em>+2.8% today</em>
                    </div>

                    <div className="product-proof-chart" aria-hidden="true">
                      <svg viewBox="0 0 320 132" preserveAspectRatio="none">
                        <path d="M0 100 C36 88 56 102 84 72 C118 36 152 74 184 52 C222 26 246 42 274 20 C292 8 306 14 320 6" />
                        <path className="fill" d="M0 100 C36 88 56 102 84 72 C118 36 152 74 184 52 C222 26 246 42 274 20 C292 8 306 14 320 6 L320 132 L0 132 Z" />
                      </svg>
                    </div>

                    <div className="product-proof-module-grid">
                      <article>
                        <span>Watchlist</span>
                        <strong>AAPL · NVDA · BTC</strong>
                        <p>Theme tags, earnings context, and source-aware price states.</p>
                      </article>
                      <article>
                        <span>Options</span>
                        <strong>Flow + max pain</strong>
                        <p>Chains, volatility, whale activity, and scenario presets.</p>
                      </article>
                      <article>
                        <span>Prediction markets</span>
                        <strong>Odds tape</strong>
                        <p>Event prices, mark-to-entry pressure, and wallet activity.</p>
                      </article>
                      <article>
                        <span>Tax desk</span>
                        <strong>40+ jurisdictions</strong>
                        <p>Realized gains, harvesting scenarios, and after-tax outcomes.</p>
                      </article>
                    </div>
                  </div>
                </div>

                <div className="product-proof-rail">
                  <div><span>Analytics</span><strong>Crypto, Options, Equities, Macro, Commodities</strong></div>
                  <div><span>Research</span><strong>Company profile, catalysts, notes, journal</strong></div>
                  <div><span>Account mode</span><strong>Auth, billing, workspace and security controls</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div className="container proof-bar">
            <div className="proof-grid">
              <div className="proof-item">
                <div className="proof-badge">01</div>
                <div><strong>Explicit guest previews</strong><span>No half-working locked modules</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">02</div>
                <div><strong>Source-aware data</strong><span>Live, cached, delayed, or unavailable</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">03</div>
                <div><strong>Unified desk language</strong><span>Portfolio, analytics, options, research</span></div>
              </div>
              <div className="proof-item">
                <div className="proof-badge">04</div>
                <div><strong>Decision workflow</strong><span>Track, research, model, journal</span></div>
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

            <div className="cards-grid platform-workflows">
              <div className="workflow-container workflow-analyze">
                <div className="workflow-label">Analyze</div>
                <div className="workflow-items">
                  <div className="workflow-item"><div className="feature-icon icon-analytics">AN</div><div className="workflow-item-body"><h3>Cross-market Analytics</h3><p>Move across Crypto, Options, Equities, Macro, and Commodities sibling desks.</p></div></div>
                  <div className="workflow-item"><div className="feature-icon icon-options">OP</div><div className="workflow-item-body"><h3>Options Risk Desk</h3><p>Analyze chains, volatility, max-pain, and flow-driven risk in one desk.</p></div></div>
                </div>
              </div>
              <div className="workflow-columns">
                <div className="workflow-container">
                  <div className="workflow-label">Track</div>
                  <div className="workflow-items">
                    <div className="workflow-item"><div className="feature-icon icon-watchlist">WL</div><div className="workflow-item-body"><h3>Watchlist</h3><p>Track assets, themes, earnings, and macro context before opening deeper work.</p></div></div>
                    <div className="workflow-item"><div className="feature-icon icon-company">CO</div><div className="workflow-item-body"><h3>Company Profile</h3><p>Inspect fundamentals, leadership, catalysts, news, and earnings context.</p></div></div>
                    <div className="workflow-item"><div className="feature-icon icon-portfolio">PF</div><div className="workflow-item-body"><h3>Portfolio</h3><p>Review allocation, cash, P/L, risk posture, and rebalance prompts.</p></div></div>
                  </div>
                </div>
                <div className="workflow-container">
                  <div className="workflow-label">Decide</div>
                  <div className="workflow-items">
                    <div className="workflow-item"><div className="feature-icon icon-predictions">PR</div><div className="workflow-item-body"><h3>Probability Desk</h3><p>Track event odds, whale activity, and mark-to-entry pressure.</p></div></div>
                    <div className="workflow-item"><div className="feature-icon icon-journal">JL</div><div className="workflow-item-body"><h3>Decision Ledger</h3><p>Capture the thesis, evidence, outcome, and review queue behind each move.</p></div></div>
                    <div className="workflow-item"><div className="feature-icon icon-tax">TX</div><div className="workflow-item-body"><h3>Tax Scenario Desk</h3><p>Model realized gains, jurisdictions, after-tax outcomes, and export-ready summaries.</p></div></div>
                  </div>
                </div>
              </div>
            </div>

            <section className="coverage-section" id="coverage">
              <div className="coverage-head">
                <div className="section-tag">Coverage</div>
                <h2>Cross-market coverage for stocks, crypto, options, and prediction markets</h2>
                <p>
                  Zenin is built to let you move from macro context to decision review without context switching.
                  Track equities, crypto, options, prediction markets, and tax workflows in one place so research,
                  portfolio context, and review stay connected.
                </p>
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
                <div><strong>5</strong><span>Core Market Modules</span></div>
                <div><strong>40+</strong><span>Tax Jurisdictions</span></div>
                <div><strong>1</strong><span>Unified Workspace</span></div>
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
                <article
                  className={`pricing-card${selectedPlan === "starter" ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedPlan === "starter"}
                  aria-label="Select Starter plan"
                  onClick={() => handleCardSelect("starter")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardSelect("starter"); } }}
                >
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
                    className="btn btn-secondary pricing-cta btn-halo"
                    onClick={() => { window.location.href = "/onboarding?plan=starter"; }}
                    disabled={pricingBusyPlan === "starter" || isCurrentSelection("starter")}
                  >
                    {renderCtaText("starter", "Get Started")}
                  </button>
                </article>

                <article
                  className={`pricing-card featured${selectedPlan === "pro" ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedPlan === "pro"}
                  aria-label="Select Pro plan"
                  onClick={() => handleCardSelect("pro")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardSelect("pro"); } }}
                >
                  <div className="pricing-card-head">
                    <h4>Pro</h4>
                    <span className="pricing-badge">Most popular</span>
                  </div>
                  <p className="pricing-desc">Cross-market workflows for active investors and analysts.</p>
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
                    className="btn btn-primary pricing-cta btn-halo"
                    onClick={() => { window.location.href = "/onboarding?plan=pro"; }}
                    disabled={pricingBusyPlan === "pro" || isCurrentSelection("pro")}
                  >
                    {renderCtaText("pro", "Start Pro")}
                  </button>
                </article>

                <article
                  className={`pricing-card${selectedPlan === "desk" ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selectedPlan === "desk"}
                  aria-label="Select Desk plan"
                  onClick={() => handleCardSelect("desk")}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleCardSelect("desk"); } }}
                >
                  <div className="pricing-card-head">
                    <h4>Desk</h4>
                    <span className="pricing-badge muted">For teams</span>
                  </div>
                  <p className="pricing-desc">Shared workspaces, member controls, and desk operations.</p>
                  <div className="pricing-price">
                    <strong>{toMoney(getPlanPrice("desk", billingCycle).amount)}</strong>
                    <span>{getPlanPrice("desk", billingCycle).periodLabel}</span>
                  </div>
                  {getPlanPrice("desk", billingCycle).helperLabel ? (
                    <p className="pricing-price-helper">{getPlanPrice("desk", billingCycle).helperLabel}</p>
                  ) : null}
                  <ul className="pricing-list">
                    <li>5 team seats included</li>
                    <li>Role-based workspace permissions</li>
                    <li>Shared account sync and desk activity</li>
                    <li>Priority data refresh and source health</li>
                  </ul>
                  <button
                    className="btn btn-secondary pricing-cta btn-halo"
                    onClick={() => { window.location.href = "/onboarding?plan=desk"; }}
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
                        <td>Workspace members and invites</td>
                        <td>-</td>
                        <td>-</td>
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
                <h2 id="faq-title">Questions investors and analysts ask before switching platforms</h2>
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
                  <a className="btn btn-primary btn-halo" href="/app" onClick={handleOpenAppClick} aria-busy={openAppChecking}>
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
    </div>
  );
}
