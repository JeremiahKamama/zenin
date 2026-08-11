// components/PlanLockOverlay.jsx
// Reusable, monochrome "upgrade to access" overlay for tier-gated features.
// (Brandv2: monochrome surfaces, white primary text, gray secondary text,
//  subtle borders, shadows reserved for modals.)
//
// The card is contextual: the heading, description, feature list, and price
// adapt to the locked section so every tier gate shows the right value prop.
import React, { useState } from "react";
import { getAppRuntimeConfig } from "@/config/runtimeConfigStore";

function tierLabel(plan) {
  const v = String(plan || "").trim().toLowerCase();
  if (v === "premium" || v === "desk") return "Premium";
  if (v === "plus" || v === "pro") return "Plus";
  return "Starter";
}

const SECTION_UPGRADE_CONTEXT = {
  Analytics: {
    title: "Unlock analytics",
    description: "Advanced analytics and commodity intelligence are a Pro feature. Upgrade to unlock the full analytics workspace.",
    features: [
      "Cross-asset macro indicators and sentiment feeds",
      "Commodity supply/demand curves",
      "Enterprise-grade charting and export",
      "Event probability tape and flow blotter"
    ],
    notIncluded: [
      "Dedicated data science workstation"
    ],
    requiredTierKey: "plus",
    icon: "📊"
  },
  Research: {
    title: "Unlock research",
    description: "Catalyst and research context is a Pro feature. Upgrade to unlock the research workspace.",
    features: [
      "Catalyst timeline for tracked assets",
      "Cross-referenced news and filing links",
      "Custom research notebooks",
      "AI-summarized earnings call transcripts"
    ],
    notIncluded: [
      "Real-time whale pressure tracking"
    ],
    requiredTierKey: "plus",
    icon: "📚"
  },
  Journal: {
    title: "Unlock the journal",
    description: "The decision journal and trade review workflow is a Pro feature. Upgrade to capture and review your decisions.",
    features: [
      "Timestamped decision entries with notes",
      "Trade execution vs. plan replay",
      "Performance attribution reports",
      "Export to PDF / CSV"
    ],
    notIncluded: [
      "Automated trade ingestion"
    ],
    requiredTierKey: "plus",
    icon: "📓"
  },
  Options: {
    title: "Unlock options",
    description: "Options analytics and the strategy simulator are a Premium feature. Upgrade to unlock options trading intelligence.",
    features: [
      "Live options chain analysis",
      "Strategy simulator with backtesting",
      "Volatility surface heatmaps",
      "Real-time options flow alerts"
    ],
    notIncluded: [
      "Brokerage order routing"
    ],
    requiredTierKey: "premium",
    icon: "📈"
  },
  Predictions: {
    title: "Unlock predictions",
    description: "Prediction markets are a Premium feature. Upgrade to unlock Polymarket and Kalshi integration.",
    features: [
      "Event probability tape and flow blotter",
      "Real-time whale pressure tracking",
      "Unlimited market categories",
      "Priority data feeds and API access"
    ],
    notIncluded: [
      "Enterprise audit logs and SSO"
    ],
    requiredTierKey: "premium",
    icon: "🎯"
  }
};

const PRICE_MAP = {
  plus: 29,
  premium: 99
};

export function PlanLockOverlay({
  locked = false,
  requiredPlan = "premium",
  title,
  description,
  features,
  notIncluded,
  children,
  onUpgrade,
  upgradeLabel = "Upgrade now",
  section
}) {
  if (!locked) return <>{children}</>;

  const ctx = section && SECTION_UPGRADE_CONTEXT[section] ? SECTION_UPGRADE_CONTEXT[section] : null;
  const config = getAppRuntimeConfig();
  const tierLabelStr = tierLabel(requiredPlan || "plus");
  const yearlyDiscount = config?.subscription?.yearlyDiscountRate ?? 0.2;
  const monthlyPrice = PRICE_MAP[requiredPlan === "premium" ? "premium" : "plus"] ?? 29;
  const yearlyPrice = Math.round(monthlyPrice * 12 * (1 - yearlyDiscount));

  const [billingCycle, setBillingCycle] = useState("monthly");

  const displayTitle = title || (ctx ? ctx.title : `Available on ${tierLabel}`);
  const displayDescription = description || (ctx ? ctx.description : `This feature requires the ${tierLabel} plan. Upgrade to unlock advanced capabilities.`);
  const displayFeatures = features || (ctx ? ctx.features : []);
  const displayNotIncluded = notIncluded || (ctx ? ctx.notIncluded : []);

  return (
    <div className="plan-lock" aria-label={`${tierLabelStr} plan required`}>
      <div className="plan-lock__content" aria-hidden="true">{children}</div>
      <div className="plan-lock__scrim" role="alertdialog" aria-modal="true" aria-label={`${tierLabelStr} plan required`}>
        <div className="plan-lock__card">
          {/* Top icons */}
          <div className="plan-lock__card-header">
            <span className="plan-lock__card-icon">{ctx ? ctx.icon : tierLabelStr}</span>
            <span className="plan-lock__badge">{tierLabelStr}</span>
            <span className="plan-lock__card-icon">{ctx ? ctx.icon : tierLabelStr}</span>
          </div>

          {/* Heading */}
          <h3 className="plan-lock__title">{displayTitle}</h3>
          <p className="plan-lock__desc">{displayDescription}</p>

          {/* Pricing toggle */}
          <div className="upgrade-pricing">
            <div className="upgrade-pricing__toggle">
              <button
                type="button"
                className={`upgrade-pricing__option ${billingCycle === "monthly" ? "upgrade-pricing__option--active" : ""}`}
                onClick={() => setBillingCycle("monthly")}
              >
                Monthly
              </button>
              <button
                type="button"
                className={`upgrade-pricing__option ${billingCycle === "yearly" ? "upgrade-pricing__option--active" : ""}`}
                onClick={() => setBillingCycle("yearly")}
              >
                Yearly
              </button>
            </div>
            {billingCycle === "yearly" && (
              <span className="upgrade-pricing__badge">Save {Math.round(yearlyDiscount * 100)}%</span>
            )}
          </div>

          {/* Price */}
          <div className="upgrade-pricing__price">
            {billingCycle === "monthly"
              ? <>${monthlyPrice}<span className="upgrade-pricing__period">/ month</span></>
              : <>${yearlyPrice}<span className="upgrade-pricing__period">/ month</span></>
            }
          </div>

          {/* Features */}
          <div className="upgrade-features">
            <div className="upgrade-features__header">WHAT'S INCLUDED</div>
            {displayFeatures.map((feature, i) => (
              <div key={i} className="upgrade-features__item">
                <span className="upgrade-features__check">✓</span>
                <span>{feature}</span>
              </div>
            ))}
            {displayNotIncluded.map((feature, i) => (
              <div key={`ni-${i}`} className="upgrade-features__item upgrade-features__item--disabled">
                <span className="upgrade-features__check upgrade-features__check--disabled">✕</span>
                <span>{feature}</span>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="upgrade-actions">
            {onUpgrade && (
              <button type="button" className="upgrade-actions__primary" onClick={onUpgrade}>
                {upgradeLabel}
              </button>
            )}
            <button type="button" className="upgrade-actions__secondary">
              Maybe later
            </button>
          </div>

          <p className="upgrade-actions__footnote">
            Cancel anytime. No questions asked.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PlanLockOverlay;
