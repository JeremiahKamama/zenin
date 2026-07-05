/**
 * SubscriptionManager.jsx
 * 
 * Brand System v2 - Pure monochrome subscription management UI
 * Provides flows for: Refresh Subscription, Change Plan, Manage Subscription
 * 
 * Follows institutional design principles:
 * - Typography before color
 * - Contrast before decoration  
 * - Minimal surfaces
 * - Information first
 */

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui";
import { Loader2, RefreshCw, CreditCard, Settings, Check, AlertCircle, X } from "lucide-react";

// ── Status Indicators ─────────────────────────────────────────────────────

const SubscriptionStatus = ({ status, className = "" }) => {
  const statusConfig = {
    active: { 
      icon: Check, 
      label: "Active",
      color: "var(--color-success)",
      bg: "rgba(16, 185, 129, 0.1)",
      border: "rgba(16, 185, 129, 0.2)"
    },
    expired: {
      icon: AlertCircle,
      label: "Expired", 
      color: "var(--color-danger)",
      bg: "rgba(239, 68, 68, 0.1)",
      border: "rgba(239, 68, 68, 0.2)"
    },
    pending: {
      icon: Loader2,
      label: "Processing",
      color: "var(--color-warning)",
      bg: "rgba(245, 158, 11, 0.1)",
      border: "rgba(245, 158, 11, 0.2)"
    },
    canceled: {
      icon: X,
      label: "Canceled",
      color: "var(--color-danger)",
      bg: "rgba(239, 68, 68, 0.1)", 
      border: "rgba(239, 68, 68, 0.2)"
    }
  };

  const config = statusConfig[status] || statusConfig.expired;
  const Icon = config.icon;

  return (
    <span 
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${className}`}
      style={{
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`
      }}
    >
      {status === "pending" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {config.label}
    </span>
  );
};

// ── Plan Card ─────────────────────────────────────────────────────────────

const PlanCard = ({ 
  plan, 
  currentPlan, 
  isLoading, 
  onSelect, 
  disabled 
}) => {
  const { name, description, price, features, tag } = plan;
  const isCurrent = currentPlan?.id === plan.id;
  const isPremium = plan.id !== "starter";

  return (
    <div 
      className={`border rounded-lg p-6 transition-all duration-200 ${
        isCurrent 
          ? "border-[var(--color-interactive)] bg-[rgba(255,255,255,0.04)]" 
          : "border-[var(--color-border-medium)] bg-[var(--color-surface-card)] hover:bg-[var(--color-surface-elevated)]"
      }`}
      style={{ cursor: disabled ? "not-allowed" : "pointer" }}
      onClick={() => !disabled && !isCurrent && onSelect?.(plan)}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              {name}
            </h3>
            {tag && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-[rgba(255,255,255,0.1)] text-[var(--color-text-secondary)] border border-[var(--color-border-medium)]">
                {tag}
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            {price}
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            /month
          </div>
        </div>
      </div>

      {isCurrent && (
        <div className="mb-4 p-3 rounded bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
          <p className="text-sm text-[var(--color-success)] font-medium flex items-center gap-2">
            <Check className="h-4 w-4" />
            Your current plan
          </p>
        </div>
      )}

      <ul className="space-y-2 text-sm">
        {features.map((feature, index) => (
          <li key={index} className="flex items-center gap-2 text-[var(--color-text-secondary)]">
            <Check className="h-4 w-4 text-[var(--color-success)]" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {isCurrent ? (
          <Button 
            variant="secondary" 
            className="w-full" 
            disabled
          >
            Current Plan
          </Button>
        ) : (
          <Button 
            variant={isPremium ? "primary" : "secondary"} 
            className="w-full" 
            disabled={disabled || isLoading}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(plan);
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              `Select ${name}`
            )}
          </Button>
        )}
      </div>
    </div>
  );
};

// ── Action Buttons ────────────────────────────────────────────────────────

const SubscriptionActionButton = ({ 
  action, 
  onClick, 
  disabled = false, 
  loading = false,
  className = ""
}) => {
  const actionConfig = {
    refresh: {
      label: "Refresh Subscription",
      icon: RefreshCw,
      variant: "secondary"
    },
    change: {
      label: "Change Plan", 
      icon: CreditCard,
      variant: "primary"
    },
    manage: {
      label: "Manage Subscription",
      icon: Settings,
      variant: "secondary"
    }
  };

  const config = actionConfig[action] || actionConfig.manage;
  const Icon = config.icon;

  return (
    <Button 
      variant={config.variant}
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full justify-start gap-2 ${className}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
      {loading ? `Processing ${config.label}...` : config.label}
    </Button>
  );
};

// ── Main Component ────────────────────────────────────────────────────────

const PLAN_OPTIONS = [
  {
    id: "starter",
    name: "Starter",
    description: "Essential tracking for individual investors",
    price: "$0",
    tag: "Free",
    features: [
      "Basic portfolio tracking",
      "Market data access", 
      "Limited research tools",
      "Community support"
    ]
  },
  {
    id: "pro",
    name: "Pro",
    description: "Advanced analytics for active traders",
    price: "$49",
    tag: "Popular",
    features: [
      "Everything in Starter",
      "Advanced portfolio analytics",
      "Real-time alerts",
      "Priority support",
      "Options flow data",
      "API access"
    ]
  },
  {
    id: "institutional",
    name: "Institutional", 
    description: "Full platform access for teams",
    price: "$199",
    tag: "Enterprise",
    features: [
      "Everything in Pro",
      "Team collaboration",
      "Multi-portfolio management",
      "Dedicated account manager",
      "Custom integrations",
      "Advanced reporting"
    ]
  }
];

export function SubscriptionManager({
  currentPlan,
  subscriptionStatus = "active",
  onRefresh,
  onPlanChange,
  onManage,
  isLoading = false
}) {
  const [showPlanSelector, setShowPlanSelector] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [actionLoading, setActionLoading] = useState({
    refresh: false,
    change: false,
    manage: false
  });

  const currentPlanData = useMemo(() => {
    return PLAN_OPTIONS.find(p => p.id === currentPlan?.id) || PLAN_OPTIONS[0];
  }, [currentPlan?.id]);

  const handleRefresh = async () => {
    setActionLoading(prev => ({ ...prev, refresh: true }));
    try {
      await onRefresh?.();
    } finally {
      setActionLoading(prev => ({ ...prev, refresh: false }));
    }
  };

  const handlePlanChange = async (plan) => {
    setSelectedPlan(plan);
    setShowPlanSelector(false);
    setActionLoading(prev => ({ ...prev, change: true }));
    try {
      await onPlanChange?.(plan);
    } finally {
      setActionLoading(prev => ({ ...prev, change: false }));
    }
  };

  const handleManage = async () => {
    setActionLoading(prev => ({ ...prev, manage: true }));
    try {
      await onManage?.();
    } finally {
      setActionLoading(prev => ({ ...prev, manage: false }));
    }
  };

  const handleSelectPlan = (plan) => {
    if (plan.id !== currentPlan?.id) {
      setSelectedPlan(plan);
      // In a real implementation, this would open a confirmation dialog
      // For now, we'll directly call the plan change
      handlePlanChange(plan);
    }
  };

  return (
    <div className="space-y-6">
      {/* Current Subscription Status */}
      <div className="border border-[var(--color-border-medium)] rounded-lg p-6 bg-[var(--color-surface-card)]">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Subscription Status
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Your current plan and billing information
            </p>
          </div>
          <SubscriptionStatus status={subscriptionStatus} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[var(--color-text-muted)] mb-1">Current Plan</p>
            <p className="text-[var(--color-text-primary)] font-medium">
              {currentPlanData.name}
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-muted)] mb-1">Billing Cycle</p>
            <p className="text-[var(--color-text-primary)] font-medium">
              Monthly
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-muted)] mb-1">Price</p>
            <p className="text-[var(--color-text-primary)] font-medium">
              {currentPlanData.price}/month
            </p>
          </div>
          <div>
            <p className="text-[var(--color-text-muted)] mb-1">Seats</p>
            <p className="text-[var(--color-text-primary)] font-medium">
              {currentPlan?.seats || 1}
            </p>
          </div>
        </div>

        {currentPlan?.expiryDate && (
          <div className="mt-4 p-3 rounded bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.2)]">
            <p className="text-sm text-[var(--color-success)]">
              Next billing: {new Date(currentPlan.expiryDate).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <SubscriptionActionButton
          action="refresh"
          onClick={handleRefresh}
          loading={actionLoading.refresh || isLoading}
          disabled={subscriptionStatus === "pending"}
        />
        
        <SubscriptionActionButton
          action="change"
          onClick={() => setShowPlanSelector(!showPlanSelector)}
          loading={actionLoading.change || isLoading}
          disabled={subscriptionStatus === "pending"}
        />
        
        <SubscriptionActionButton
          action="manage"
          onClick={handleManage}
          loading={actionLoading.manage || isLoading}
          disabled={!currentPlan?.managementUrl || subscriptionStatus === "pending"}
        />
      </div>

      {/* Plan Selector (Modal/Drawer would be better, but keeping it simple) */}
      {showPlanSelector && (
        <div className="border border-[var(--color-border-medium)] rounded-lg p-6 bg-[var(--color-surface-card)]">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Choose Your Plan
            </h3>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setShowPlanSelector(false)}
            >
              <X className="h-4 w-4" />
              Close
            </Button>
          </div>

          <p className="text-sm text-[var(--color-text-muted)] mb-6">
            Select the plan that best fits your needs. All plans include core portfolio tracking.
          </p>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {PLAN_OPTIONS.map(plan => (
              <PlanCard
                key={plan.id}
                plan={plan}
                currentPlan={currentPlan}
                isLoading={actionLoading.change || isLoading}
                onSelect={handleSelectPlan}
                disabled={subscriptionStatus === "pending"}
              />
            ))}
          </div>
        </div>
      )}

      {/* DEX Providers Integration Notice */}
      {currentPlan?.id === "institutional" && (
        <div className="border border-[var(--color-border-medium)] rounded-lg p-4 bg-[var(--color-surface-card)]">
          <p className="text-sm text-[var(--color-text-muted)] mb-2">
            <strong className="text-[var(--color-text-primary)]">DEX Integrations:</strong> Your plan includes access to premium DEX providers
          </p>
          <div className="flex flex-wrap gap-2">
            {["Hyperliquid", "Aster", "Lighter", "Variational", "Binance", "Derive", "dYdX v4"].map(provider => (
              <span 
                key={provider}
                className="px-2 py-1 rounded text-xs font-medium bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border-medium)]"
              >
                {provider}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Default Export ─────────────────────────────────────────────────────────

export default SubscriptionManager;