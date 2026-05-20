import { zeninFetchJson } from "./zeninFetch";

export async function updateAccountPlan({ plan, billingCycle }) {
  return zeninFetchJson("/account/plan", {
    method: "POST",
    body: JSON.stringify({ plan, billingCycle })
  });
}
