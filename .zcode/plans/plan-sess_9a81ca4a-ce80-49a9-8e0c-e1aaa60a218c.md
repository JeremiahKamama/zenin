## Goal
Two things: (1) stop sending live-app users into the "Demo Workspace" experience — when they click **Continue as Guest**, they should land in the **full app** (with empty/placeholder states for data-bearing modules), not the fake-data `GuestWorkspacePreview`; (2) remove the **"Opening demo workspace"** loading-screen copy. The "Continue as Guest" button stays. No backend changes — guests still have no real session, so data-bearing modules will show their normal empty states (confirmed with you).

All changes are in the frontend, almost entirely in `frontend/src/App.jsx`.

## Root cause (why guests still see the demo workspace today)
- The guest button (`AuthPage.jsx:114`, `AuthModal.jsx:124`) navigates to `/app?guest=1`.
- On `/app`, `?guest=1` makes `isGuestQueryRequested()` true → `isExplicitGuestMode=true` → `shouldRenderGuestPreview=true` (`App.jsx:6962`) → the real modules (Home/Portfolio/Watchlist/Research/Analytics/Options/Tax Estimator) are **swapped out** for `<GuestWorkspacePreview>` (`App.jsx:7441`).
- The "Opening demo workspace" text comes from `bootPhase === "opening_demo_mode"` (`App.jsx:4693, 4703`), set while `accessCheckLoading && isGuestQueryRequested()`.
- `AuthPage.jsx` also sets `localStorage.zenin_guest_full_access=1`, but on production that flag is inert because `isDevFullAccessEnabled()` (`App.jsx:455`) requires `import.meta.env.DEV`. So prod guests still fall into the demo workspace. (We are *not* re-enabling full-access; we're disabling the demo gating.)

## Changes

### 1. `frontend/src/App.jsx` — stop rendering the demo workspace gate
Make guests render the **real modules** (which will show empty/placeholder states, since they have no backend session), instead of `<GuestWorkspacePreview>`:

- **`App.jsx:6962`** — Neutralize `shouldRenderGuestPreview`. Change it to always `false` (simplest, leaves all the `!shouldRenderGuestPreview` render guards and `GuestWorkspacePreview` component in place untouched — minimal blast radius):
  ```js
  const shouldRenderGuestPreview = false; // Demo workspace disabled; guests now see the full app.
  ```
  *(Alternative considered: delete the variable + all references and the `GuestWorkspacePreview` component. Rejected for now — larger, riskier edit, and the component/preview modules can be removed in a follow-up cleanup.)*

### 2. `frontend/src/App.jsx` — remove "Opening demo workspace" loading text
- **`App.jsx:4693`** — stop selecting the `opening_demo_mode` phase. Guests should see the normal "Checking session" phase like everyone else:
  ```js
  setBootPhase(accessCheckLoading ? "checking_session" : ...);
  ```
  i.e. replace the `isGuestQueryRequested() ? "opening_demo_mode" : "checking_session"` ternary with just `"checking_session"`.
- **`App.jsx:4703`** — remove the `case "opening_demo_mode": return "Opening demo workspace";` branch from `bootPhaseCopy` (the `default` "Checking session" covers it).

### 3. `frontend/src/App.jsx` — relabel the guest plan chip
Guests currently show **"Demo Workspace"** as their plan label. Since this is no longer a demo workspace, change the label guests see:
- **`App.jsx:651-653`** (`getGuestWorkspaceLabel`) — return `"Guest"` instead of `"Demo Workspace"`. This label flows into `accountPlanLabel` at `App.jsx:4780` and `4829`.

### 4. `frontend/src/AuthPage.jsx` — keep the button, drop the misleading comment
- **`AuthPage.jsx:114-124`** — The `handleGuestEntry` handler is fine as-is (navigates to `/app?guest=1`). I'll update the stale comment at lines 116-117 that says *"treat the user like a dev/full-access user without backend auth"* — that's no longer accurate (we're not granting full access; guests see the full UI with empty states). New comment will say it enters the app as a guest with no backend session. No behavioral change here.

## Not changing (intentionally)
- The backend: `requireSignedIn` still blocks `/api/app/bootstrap`, `/api/workspaces/*`, `/api/account/*` for guests. Real modules will therefore show empty/placeholder states — which is exactly what you confirmed you want "for now". No backend edits.
- The "Continue as Guest" **button** stays (per your answer), in both `AuthPage.jsx` and `AuthModal.jsx`.
- The many `isGuestUser`/`isExplicitGuestMode` early-returns throughout `App.jsx` (watchlist alert emails, RevenueCat, 2FA, workspace settings sync, etc.) stay — they correctly skip backend calls that would 401 for a guest. Changing them is out of scope and not needed for "see the whole app".
- `zenin_guest_full_access` localStorage flag: left in place (harmless on prod; useful in dev). Clearing it isn't required for this fix.
- `GuestWorkspacePreview` and `GUEST_PREVIEW_*` constants: left in the file (now unused via the `false` short-circuit) to keep this change small and reversible. Can be deleted in a follow-up cleanup PR.

## Verification
After the edits:
1. `cd frontend && npm run build` — confirm it builds clean (no dead-code errors; the unused `GuestWorkspacePreview` is still imported and referenced, just never rendered).
2. `npm run dev`, open `/auth`, click **Continue as Guest**:
   - No "Opening demo workspace" text — should show "Checking session" / normal loading.
   - Lands on `/app?guest=1` showing the **real** Home module (empty states), not `GuestWorkspacePreview`.
   - Sidebar navigates to Portfolio / Watchlist / Research / Analytics / Options / Tax Estimator — each shows the real module's empty state, not demo cards.
   - Plan label in the UI reads **"Guest"**, not "Demo Workspace".
3. Sign-in flow still works (signing in strips `?guest=` via `getSignedInWorkspacePath`, unaffected).

## Risk / scope
- **Low risk, frontend-only, ~4 small edits in 2 files.** No API, DB, auth, or routing changes.
- The main behavioral shift: guests now see real (empty) modules instead of polished demo content — expected per your instruction.
- If a guest later signs in, everything works as before.