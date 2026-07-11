// Schema-driven step registry (spec: "new steps can be registered instead of
// hardcoded"). One engine, dynamic insertion by plan.
//
// Each step descriptor:
//   key        - ONBOARDING_STEPS value (also the route/state key)
//   component  - lazy/regular React component (resolved by OnboardingPage)
//   title      - step heading
//   description- step subhead
//   plans      - array of plans this step appears for ([] = all shared steps)
//   required   - whether Continue is blocked until the step reports complete
//   isProvisioning / isCompletion - engine phases (not user "steps" to fill)
//   validate   - (answers) => boolean  (pure; reused everywhere, no dup logic)

import { ONBOARDING_STEPS, ONBOARDING_PLANS } from "../types/onboarding";

const SHARED = ONBOARDING_PLANS; // all plans include the core steps

export const STEP_REGISTRY = {
  [ONBOARDING_STEPS.WELCOME]: {
    key: ONBOARDING_STEPS.WELCOME,
    title: "Welcome to Zenin",
    description: "We'll configure your investment workspace. This takes about three minutes.",
    plans: SHARED,
    required: true,
    component: "WelcomeStep",
  },
  [ONBOARDING_STEPS.ACCOUNT_PROFILE]: {
    key: ONBOARDING_STEPS.ACCOUNT_PROFILE,
    title: "Account profile",
    description: "Used to localize your workspace, briefings, and reports.",
    plans: SHARED,
    required: true,
    component: "AccountProfileStep",
    validate: (a) => Boolean(a.name && a.name.trim() && a.country && a.currency),
  },
  [ONBOARDING_STEPS.INVESTOR_TYPE]: {
    key: ONBOARDING_STEPS.INVESTOR_TYPE,
    title: "What best describes you?",
    description: "We use this to configure your default workspace layout and research flow.",
    plans: SHARED,
    required: true,
    component: "InvestorTypeStep",
    validate: (a) => Boolean(a.persona),
  },
  [ONBOARDING_STEPS.MARKETS]: {
    key: ONBOARDING_STEPS.MARKETS,
    title: "Which markets matter most?",
    description: "Drives your watchlist, research, briefings, dashboard, and alerts.",
    plans: SHARED,
    required: true,
    component: "MarketSelectionStep",
    validate: (a) => Array.isArray(a.markets) && a.markets.length > 0,
  },
  [ONBOARDING_STEPS.PORTFOLIO]: {
    key: ONBOARDING_STEPS.PORTFOLIO,
    title: "Bring your portfolio",
    description: "Import now or start empty — you can always import later.",
    plans: SHARED,
    required: false, // optional; "Start Empty" is valid
    component: "PortfolioImportStep",
  },
  [ONBOARDING_STEPS.NOTIFICATIONS]: {
    key: ONBOARDING_STEPS.NOTIFICATIONS,
    title: "Stay in the loop",
    description: "Choose what Zenin should surface for you.",
    plans: SHARED,
    required: false,
    component: "NotificationStep",
  },
  // ---- Pro-only ----
  [ONBOARDING_STEPS.RESEARCH_PREFERENCES]: {
    key: ONBOARDING_STEPS.RESEARCH_PREFERENCES,
    title: "Research preferences",
    description: "Tailor the Asset Research Workspace to how you analyze.",
    plans: ["pro"],
    required: true,
    component: "ResearchPreferencesStep",
    validate: (a) => Boolean(a.researchStyle && a.horizon && a.layout),
  },
  // ---- Desk-only ----
  [ONBOARDING_STEPS.ORGANIZATION]: {
    key: ONBOARDING_STEPS.ORGANIZATION,
    title: "Organization",
    description: "Name your desk workspace and set its identity.",
    plans: ["desk"],
    required: true,
    component: "WorkspaceStep",
    validate: (a) => Boolean(a.workspaceName && a.workspaceName.trim()),
  },
  [ONBOARDING_STEPS.TEAM_SETUP]: {
    key: ONBOARDING_STEPS.TEAM_SETUP,
    title: "Invite your team",
    description: "Add seats and set permissions. You can invite more later.",
    plans: ["desk"],
    required: false, // can launch with just the owner
    component: "TeamSetupStep",
  },
  // ---- Engine phases (not fillable steps) ----
  [ONBOARDING_STEPS.PROVISIONING]: {
    key: ONBOARDING_STEPS.PROVISIONING,
    title: "Preparing workspace",
    description: "Provisioning your personalized Zenin workspace.",
    plans: SHARED,
    required: false,
    isProvisioning: true,
    component: "WorkspaceProvisioningStep",
  },
  [ONBOARDING_STEPS.COMPLETION]: {
    key: ONBOARDING_STEPS.COMPLETION,
    title: "Your workspace is ready",
    description: "Generated first experience.",
    plans: SHARED,
    required: false,
    isCompletion: true,
    component: "CompletionStep",
  },
};

// Ordered step keys for a given plan (shared steps first, then plan-specific,
// then engine phases). This is the single source of truth for ordering.
export function getStepOrderForPlan(plan) {
  const order = Object.values(STEP_REGISTRY)
    .filter((s) => s.plans.includes(plan))
    .sort((a, b) => a._ordinal - b._ordinal)
    .map((s) => s.key);
  return order;
}

// Assign ordinals once (shared steps 1..N, pro/desk steps interleave by spec
// order, provisioning + completion always last).
const SHARED_ORDER = [
  ONBOARDING_STEPS.WELCOME,
  ONBOARDING_STEPS.ACCOUNT_PROFILE,
  ONBOARDING_STEPS.INVESTOR_TYPE,
  ONBOARDING_STEPS.MARKETS,
  ONBOARDING_STEPS.PORTFOLIO,
  ONBOARDING_STEPS.NOTIFICATIONS,
];
const PRO_ORDER = [ONBOARDING_STEPS.RESEARCH_PREFERENCES];
const DESK_ORDER = [ONBOARDING_STEPS.ORGANIZATION, ONBOARDING_STEPS.TEAM_SETUP];
const PHASE_ORDER = [ONBOARDING_STEPS.PROVISIONING, ONBOARDING_STEPS.COMPLETION];

[...SHARED_ORDER, ...PRO_ORDER, ...DESK_ORDER, ...PHASE_ORDER].forEach((key, idx) => {
  if (STEP_REGISTRY[key]) STEP_REGISTRY[key]._ordinal = idx + 1;
});

export const STEP_KEYS = Object.keys(STEP_REGISTRY);

// Human-friendly progress labels (e.g. "Step 3 of 8") are derived in the shell.
export function totalStepsForPlan(plan) {
  return getStepOrderForPlan(plan).filter((k) => !STEP_REGISTRY[k].isProvisioning && !STEP_REGISTRY[k].isCompletion).length;
}
