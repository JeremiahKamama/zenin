// useOnboarding — the engine state machine + auto-save/resume.
// Single source of step order (from the registry), validation, and persistence.
// Business logic lives here; steps are pure presentational consumers.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  STEP_REGISTRY,
  getStepOrderForPlan,
  totalStepsForPlan,
} from "../constants/onboardingSteps";
import { ONBOARDING_STEPS } from "../types/onboarding";
import {
  loadOnboardingState,
  saveOnboardingState,
  completeStep,
  clearOnboardingState,
} from "../services/OnboardingService";

const PHASE = {
  IDLE: "idle",
  STARTED: "started",
  STEP: "step",
  PROVISIONING: "provisioning",
  COMPLETED: "completed",
};

const PHASE_STEPS = [ONBOARDING_STEPS.PROVISIONING, ONBOARDING_STEPS.COMPLETION];

export function useOnboarding(initialPlan) {
  const [plan, setPlan] = useState(initialPlan || null);
  const [order, setOrder] = useState(initialPlan ? getStepOrderForPlan(initialPlan) : []);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [completed, setCompleted] = useState([]);
  const [phase, setPhase] = useState(PHASE.IDLE);
  const [dirty, setDirty] = useState(false);
  const hydrated = useRef(false);
  // One-shot guard: resume from persisted state exactly once (kills the
  // /onboarding:state GET storm under StrictMode + dep churn).
  const resumedRef = useRef(false);

  // Resume from persisted state on mount.
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    let alive = true;
    loadOnboardingState().then((state) => {
      if (!alive) return;
      const resumedPlan = state.selectedPlan || initialPlan;
      if (resumedPlan) {
        const resumedOrder = getStepOrderForPlan(resumedPlan);
        setPlan(resumedPlan);
        setOrder(resumedOrder);
        setAnswers(state.answers || {});
        setCompleted(state.completedSteps || []);
        const idx = resumedOrder.indexOf(state.currentStep);
        setStepIndex(idx >= 0 && !PHASE_STEPS.includes(state.currentStep) ? idx : 0);
        setPhase(state.currentStep && PHASE_STEPS.includes(state.currentStep) ? PHASE[state.currentStep.toUpperCase()] : PHASE.STARTED);
      }
      hydrated.current = true;
    });
    return () => {
      alive = false;
    };
  }, [initialPlan]);

  const startPlan = useCallback((nextPlan) => {
    setPlan(nextPlan);
    const nextOrder = getStepOrderForPlan(nextPlan);
    setOrder(nextOrder);
    setStepIndex(0);
    setPhase(PHASE.STARTED);
    saveOnboardingState({ selectedPlan: nextPlan, currentStep: nextOrder[0], completedSteps: [], answers: {} });
  }, []);

  const currentStepKey = order[stepIndex] || null;
  const currentStep = currentStepKey ? STEP_REGISTRY[currentStepKey] : null;
  const isPhaseStep = currentStep && (currentStep.isProvisioning || currentStep.isCompletion);

  const validateCurrent = useCallback(() => {
    if (!currentStep) return false;
    if (currentStep.isProvisioning || currentStep.isCompletion) return true;
    if (typeof currentStep.validate === "function") return currentStep.validate(answers);
    return !currentStep.required ? true : true; // non-required always passable
  }, [currentStep, answers]);

  const canContinue = isPhaseStep ? true : validateCurrent();

  const updateAnswers = useCallback((patch) => {
    setAnswers((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  // Debounced auto-save (spec: auto-save progress; survive refresh/close/logout).
  useEffect(() => {
    if (!plan || !hydrated.current) return;
    const t = setTimeout(() => {
      if (!dirty) return;
      const key = order[stepIndex];
      saveOnboardingState({ selectedPlan: plan, currentStep: key, answers, completedSteps: completed });
      setDirty(false);
    }, 400);
    return () => clearTimeout(t);
  }, [answers, dirty, plan, order, stepIndex, completed]);

  const goTo = useCallback((idx) => {
    const clamped = Math.max(0, Math.min(order.length - 1, idx));
    setStepIndex(clamped);
    const key = order[clamped];
    saveOnboardingState({ selectedPlan: plan, currentStep: key });
  }, [order, plan]);

  const next = useCallback(async () => {
    const key = order[stepIndex];
    if (STEP_REGISTRY[key]?.isProvisioning) {
      // Provisioning is a finite, local-first animation; on completion it
      // advances to the completion step. Never wait on a backend call — the
      // workspace launches from cached/local state and sync continues after.
      const nextIdx = stepIndex + 1;
      const nextKey = order[nextIdx];
      setCompleted((c) => Array.from(new Set([...c, key])));
      setStepIndex(nextIdx);
      if (STEP_REGISTRY[nextKey]?.isCompletion) setPhase(PHASE.COMPLETED);
      saveOnboardingState({ currentStep: nextKey, completedSteps: [key] }).catch(() => {});
      return;
    }
    if (STEP_REGISTRY[key]?.isCompletion) {
      setPhase(PHASE.COMPLETED);
      return;
    }
    // Advance UI state SYNCHRONOUSLY (never block on the remote write),
    // then persist in the background so navigation stays instant.
    const nextIdx = stepIndex + 1;
    const nextKey = order[nextIdx];
    setCompleted((c) => Array.from(new Set([...c, key])));
    setStepIndex(nextIdx);
    if (STEP_REGISTRY[nextKey]?.isProvisioning) setPhase(PHASE.PROVISIONING);
    // Fire-and-forget persistence; a failed remote write must never trap the user.
    completeStep(key, answers, nextKey, plan).catch(() => {});
  }, [order, stepIndex, answers, plan]);

  const back = useCallback(() => {
    if (stepIndex === 0) return;
    goTo(stepIndex - 1);
  }, [stepIndex, goTo]);

  const finish = useCallback(async () => {
    await clearOnboardingState();
  }, []);

  const totalFillable = useMemo(() => totalStepsForPlan(plan || "starter"), [plan]);

  return {
    PHASE,
    plan,
    order,
    stepIndex,
    currentStepKey,
    currentStep,
    answers,
    completed,
    phase,
    isPhaseStep,
    canContinue,
    validateCurrent,
    updateAnswers,
    startPlan,
    goTo,
    next,
    back,
    finish,
    totalFillable,
    progress: Math.min(completed.length, totalFillable),
  };
}
