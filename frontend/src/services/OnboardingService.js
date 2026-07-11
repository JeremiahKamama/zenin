// OnboardingService (spec: "Persist selectedPlan, completedSteps, answers,
// currentStep, workspaceConfiguration. Use OnboardingService. Never local
// component state.").
//
// Persistence is additive and resilient: it mirrors the assetResearchService
// pattern (local JSON + remote workspace doc) so it works for guests and
// authenticated users without orphaning data. A single workspace doc
// `onboarding:state` is the canonical store.

import { readLocalJson, writeLocalJson } from "../utils/workspacePersistence";

const LOCAL_KEY = "zenin_onboarding_state";
const REMOTE_NAMESPACE = "onboarding:state";

function safeParse(raw) {
  if (!raw) return null;
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function defaultState() {
  return {
    selectedPlan: null,
    currentStep: null,
    completedSteps: [],
    answers: {},
    workspaceConfiguration: null,
    updatedAt: 0,
  };
}

// Best-effort remote read; falls back to local. Never throws.
export async function loadOnboardingState() {
  console.count("loadOnboardingState");
  let remote = null;
  try {
    const { loadWorkspaceCollection } = await import("../utils/workspacePersistence");
    const res = await loadWorkspaceCollection(REMOTE_NAMESPACE, []);
    if (res && Array.isArray(res.items) && res.items[0]) remote = safeParse(res.items[0]);
  } catch {
    remote = null;
  }
  const local = safeParse(readLocalJson(LOCAL_KEY, null));
  // Remote wins if newer, else local.
  const candidates = [remote, local].filter(Boolean);
  if (!candidates.length) return defaultState();
  candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { ...defaultState(), ...candidates[0] };
}

function persistLocal(state) {
  writeLocalJson(LOCAL_KEY, state);
}

export async function saveOnboardingState(partial) {
  const current = await loadOnboardingState();
  const next = { ...current, ...partial, updatedAt: Date.now() };
  persistLocal(next);
  // Mirror to remote (best effort; ignore failures — local is source of resume).
  try {
    const { saveWorkspaceCollection } = await import("../utils/workspacePersistence");
    await saveWorkspaceCollection(REMOTE_NAMESPACE, [next], 1).catch(() => null);
  } catch {
    /* guest or offline: local persists */
  }
  return next;
}

export async function clearOnboardingState() {
  persistLocal(defaultState());
  try {
    const { saveWorkspaceCollection } = await import("../utils/workspacePersistence");
    await saveWorkspaceCollection(REMOTE_NAMESPACE, [], 1).catch(() => null);
  } catch {
    /* ignore */
  }
}

// Mark onboarding complete + workspace ready. Persists to the canonical
// onboarding:state doc + localStorage so the router can treat completion as
// authoritative (survives reloads; decouples launch from bootstrap success).
export async function markOnboardingComplete(extra = {}) {
  const next = {
    ...defaultState(),
    selectedPlan: extra.selectedPlan || null,
    answers: extra.answers || {},
    onboardingComplete: true,
    workspaceReady: true,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  };
  persistLocal(next);
  try {
    const { saveWorkspaceCollection } = await import("../utils/workspacePersistence");
    await saveWorkspaceCollection(REMOTE_NAMESPACE, [next], 1).catch(() => null);
  } catch {
    /* guest or offline: local persists */
  }
  return next;
}

export async function loadOnboardingComplete() {
  const state = await loadOnboardingState().catch(() => defaultState());
  return Boolean(state && state.onboardingComplete);
}

export async function resetOnboardingComplete() {
  const current = await loadOnboardingState().catch(() => defaultState());
  const next = { ...current, onboardingComplete: false, workspaceReady: false, updatedAt: Date.now() };
  persistLocal(next);
  return next;
}

// Mark a step complete + advance pointer in one atomic write.
export async function completeStep(stepKey, answers, nextStep, plan) {
  const current = await loadOnboardingState();
  const completed = Array.from(new Set([...(current.completedSteps || []), stepKey]));
  return saveOnboardingState({
    selectedPlan: plan || current.selectedPlan,
    completedSteps: completed,
    answers: { ...current.answers, ...answers },
    currentStep: nextStep,
  });
}
