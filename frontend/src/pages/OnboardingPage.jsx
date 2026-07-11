// OnboardingPage — the single onboarding engine (spec: "ONE onboarding engine").
// Reads ?plan=, runs the schema-driven registry, renders the institutional
// 3-column "Workspace Setup" shell. Business logic lives in useOnboarding;
// steps are pure consumers of (answers, update).
import "../public.css";
import { useEffect, useMemo, useRef } from "react";
import { useOnboarding } from "../hooks/useOnboarding";
import { STEP_REGISTRY } from "../constants/onboardingSteps";
import { ONBOARDING_PLANS, PLAN_COMPLETION_ROUTE } from "../types/onboarding";
import {
  SetupNavigator,
  SetupPreview,
  StepFooter,
  useFocusTrap,
} from "../components/onboarding/primitives";
import LaunchTransition from "../components/onboarding/launch/LaunchTransition";
import { markLaunched } from "../components/onboarding/launch/launchSignal";

import WelcomeStep from "../components/onboarding/WelcomeStep";
import AccountProfileStep from "../components/onboarding/AccountProfileStep";
import InvestorTypeStep from "../components/onboarding/InvestorTypeStep";
import MarketSelectionStep from "../components/onboarding/MarketSelectionStep";
import PortfolioImportStep from "../components/onboarding/PortfolioImportStep";
import NotificationStep from "../components/onboarding/NotificationStep";
import ResearchPreferencesStep from "../components/onboarding/ResearchPreferencesStep";
import WorkspaceStep from "../components/onboarding/WorkspaceStep";
import TeamSetupStep from "../components/onboarding/TeamSetupStep";
import WorkspaceProvisioningStep from "../components/onboarding/WorkspaceProvisioningStep";
import CompletionStep from "../components/onboarding/CompletionStep";

// Destination route modules, preloaded during the launch sequence so the
// route is ready and the navigation latency is masked by the launch veil.
const LAZY_DESTINATIONS = {
  "/app/dashboard": () => import(/* webpackChunkName: "dashboard" */ "../components/AssetResearchWorkspace"),
  "/app/research": () => import(/* webpackChunkName: "research" */ "../components/AssetResearchWorkspace"),
  "/app/desk": () => import(/* webpackChunkName: "desk" */ "../components/AssetResearchWorkspace"),
};

const COMPONENTS = {
  WelcomeStep,
  AccountProfileStep,
  InvestorTypeStep,
  MarketSelectionStep,
  PortfolioImportStep,
  NotificationStep,
  ResearchPreferencesStep,
  WorkspaceStep,
  TeamSetupStep,
  WorkspaceProvisioningStep,
  CompletionStep,
};

// Rough estimate for the left-rail "X min remaining" readout.
function estRemaining(stepIndex, total) {
  const perStepMin = 0.4;
  const left = Math.max(total - 1 - stepIndex, 0);
  const mins = Math.max(1, Math.round(left * perStepMin));
  return `${mins} min remaining`;
}

export default function OnboardingPage({ plan: planFromRoute, onLaunch }) {
  const shellRef = useRef(null);
  const validPlan = ONBOARDING_PLANS.includes(planFromRoute) ? planFromRoute : null;
  const ob = useOnboarding(validPlan);

  useEffect(() => {
    if (validPlan && !ob.plan) ob.startPlan(validPlan);
  }, [validPlan, ob.plan, ob]);

  useFocusTrap(shellRef, true);

  const steps = useMemo(
    () => (ob.order || []).map((k) => STEP_REGISTRY[k]).filter(Boolean),
    [ob.order]
  );

  const StepComp = ob.currentStep ? COMPONENTS[ob.currentStep.component] : null;
  const isProvisioning = ob.currentStep?.isProvisioning;
  const isCompletion = ob.currentStep?.isCompletion;
  const canSkip = !isProvisioning && !isCompletion && ob.currentStep && !ob.currentStep.required;

  // Begin preloading the destination module the moment we reach the completion
  // stage, so by the time the user clicks Launch the route + shell are ready.
  // (Declared after isCompletion so its dependency is initialized.)
  useEffect(() => {
    if (!isCompletion) return;
    const dest = PLAN_COMPLETION_ROUTE[ob.plan] || "/app/dashboard";
    const loader = LAZY_DESTINATIONS[dest];
    if (loader) loader().catch(() => {});
  }, [isCompletion, ob.plan]);

  const handleOpen = () => {
    console.log("[lifecycle] Onboarding Complete");
    console.log("[lifecycle] Workspace Provisioning Started");
    ob.finish();
    // Single owner of the workspace transition lives in App (launchWorkspace).
    // Hand off instead of a hard reload so bootstrap state + the route
    // transition are preserved (no splash re-trap).
    if (typeof onLaunch === "function") onLaunch(ob.plan);
    else {
      markLaunched();
      const dest = PLAN_COMPLETION_ROUTE[ob.plan] || "/app/dashboard";
      window.location.href = dest;
    }
  };

  if (!ob.plan) {
    return (
      <div className="ob-page ob-page-empty" ref={shellRef}>
        <div className="ob-empty">
          <h1>No plan selected</h1>
          <p>Choose a plan from pricing to set up your workspace.</p>
          <a className="ob-btn ob-btn-primary" href="/#pricing">View pricing</a>
        </div>
      </div>
    );
  }

  return (
    <div className="ob-page" ref={shellRef}>
      <div className="ob-shell">
        <SetupNavigator
          plan={ob.plan}
          currentIndex={ob.stepIndex}
          total={ob.totalFillable}
          steps={steps.map((s) => ({ key: s.key, title: s.title }))}
          remainingLabel={estRemaining(ob.stepIndex, ob.totalFillable)}
          onJump={ob.goTo}
        />
        <main className="ob-stage">
          {isProvisioning ? (
            <StepComp onDone={() => ob.next()} />
          ) : isCompletion ? (
            <StepComp answers={ob.answers} plan={ob.plan} onOpen={handleOpen} />
          ) : StepComp ? (
            <StepComp
              answers={ob.answers}
              update={ob.updateAnswers}
              plan={ob.plan}
              onBegin={() => ob.next()}
            />
          ) : null}
        </main>
        {!isProvisioning && !isCompletion ? (
          <SetupPreview plan={ob.plan} answers={ob.answers} />
        ) : null}
        {!isProvisioning && !isCompletion ? (
          <div className="ob-stage-footer">
            <StepFooter
              onBack={ob.back}
              onContinue={ob.next}
              canContinue={ob.canContinue}
              isFirst={ob.stepIndex === 0}
              onSkip={canSkip ? ob.next : null}
            />
          </div>
        ) : null}
      </div>
      <LaunchTransition visible={isCompletion} />
    </div>
  );
}
