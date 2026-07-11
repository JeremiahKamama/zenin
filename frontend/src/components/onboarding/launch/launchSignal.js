// Tiny shared signal: set true the moment the user launches from onboarding,
// consumed once by App.jsx to trigger the progressive app-shell boot fade.
let justLaunched = false;

export function markLaunched() {
  justLaunched = true;
}

export function consumeLaunched() {
  const v = justLaunched;
  justLaunched = false;
  return v;
}
