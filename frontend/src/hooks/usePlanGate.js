import { useCallback, useMemo } from "react";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";

/**
 * usePlanGate — single source of truth for desk-vs-individual section gating.
 *
 * Returns a `.check()` helper that computes one of three states for a given
 * section:
 *   - "open"    user can access the section
 *   - "locked"  section exists but the user's plan is insufficient (show lock UI)
 *   - "hidden"  section should never appear in the nav for this user
 *
 * Resolve precedence:
 *   1. Workspace plan overrides user plan when higher (desk-upsell).
 *   2. Admins bypass gating (returned as "open").
 *
 * @param {object} ctx
 * @param {string} ctx.userPlan         user's individual plan
 * @param {string} [ctx.workspacePlan]  desktop-aware workspace plan
 * @param {boolean} [ctx.isAdmin=false]
 *
 * @returns {{
 *   effectivePlan: string,
 *   check: (section: string, opts?: { hiddenWhenLocked?: boolean }) => 'open' | 'locked' | 'hidden'
 * }}
 */
export function usePlanGate({ userPlan, workspacePlan, isAdmin = false }) {
  const planRank = getAppRuntimeConfig()?.subscription?.planRank || { starter: 0, pro: 1, desk: 2 };
  const sectionMinPlan = getAppRuntimeConfig()?.subscription?.sectionMinPlan || {};

  const effectivePlan = useMemo(() => {
    const normalizedUser = normalizePlan(userPlan);
    const normalizedWorkspace = normalizePlan(workspacePlan);
    return Number(planRank[normalizedWorkspace] || 0) > Number(planRank[normalizedUser] || 0)
      ? normalizedWorkspace
      : normalizedUser;
  }, [userPlan, workspacePlan, planRank]);

  const check = useCallback(
    (section, opts = {}) => {
      if (isAdmin) return "open";
      const required = normalizePlan(sectionMinPlan[section] || "starter");
      if (Number(planRank[effectivePlan] || 0) >= Number(planRank[required] || 0)) return "open";
      return opts.hiddenWhenLocked ? "hidden" : "locked";
    },
    [isAdmin, effectivePlan, sectionMinPlan, planRank]
  );

  return { effectivePlan, check };
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  const valid = ["starter", "pro", "desk"];
  return valid.includes(value) ? value : "starter";
}