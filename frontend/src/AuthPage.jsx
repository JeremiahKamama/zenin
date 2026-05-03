import React, { useEffect, useMemo, useState } from "react";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { zeninFetch } from "./utils/zeninFetch";
import { ZeninLogo } from "./components/Branding";
import { SpeedInsights } from "@vercel/speed-insights/react";

const OAUTH_PROVIDERS = [
  { key: "google", label: "Google", icon: "G" },
  { key: "github", label: "GitHub", icon: "GH" },
  { key: "apple", label: "Apple", icon: "A" }
];
const ENABLE_OAUTH_MOCK = String(import.meta.env.VITE_ENABLE_OAUTH_MOCK || "").trim().toLowerCase() === "true";

const PASSKEY_PROVIDERS = ["Platform Authenticator", "iCloud Keychain", "Google Password Manager", "1Password", "Bitwarden"];
const VALID_PLANS = ["starter", "pro", "desk"];
const VALID_BILLING_CYCLES = ["monthly", "yearly"];

function getModeFromLocation() {
  if (typeof window === "undefined") return "signup";
  const search = new URLSearchParams(window.location.search);
  const mode = String(search.get("mode") || "signup").toLowerCase();
  return ["signup", "signin", "forgot"].includes(mode) ? mode : "signup";
}

function sanitizeInternalPath(path, fallback = "/app") {
  const value = String(path || "").trim();
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function normalizePlan(plan) {
  const value = String(plan || "").trim().toLowerCase();
  return VALID_PLANS.includes(value) ? value : null;
}

function normalizeBillingCycle(billingCycle) {
  const value = String(billingCycle || "").trim().toLowerCase();
  return VALID_BILLING_CYCLES.includes(value) ? value : null;
}

function getPostAuthRedirectPath() {
  let queryNext = null;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    queryNext = sanitizeInternalPath(params.get("next"), "");
  }
  const storedNext = sanitizeInternalPath(localStorage.getItem("zenin_post_auth_next"), "");
  return queryNext || storedNext || "/app";
}

function getRequestedPlan() {
  let fromQuery = null;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    fromQuery = normalizePlan(params.get("plan"));
  }
  const fromStorage = normalizePlan(localStorage.getItem("zenin_pending_plan"));
  return fromQuery || fromStorage || null;
}

function getRequestedBillingCycle() {
  let fromQuery = null;
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    fromQuery = normalizeBillingCycle(params.get("billing"));
  }
  const fromStorage = normalizeBillingCycle(localStorage.getItem("zenin_pending_billing_cycle"));
  return fromQuery || fromStorage || "monthly";
}

function getEmailFromStorage() {
  if (typeof window === "undefined") return "";
  return String(localStorage.getItem("zenin_email") || "").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getPasswordRuleState(password) {
  const value = String(password || "");
  return {
    length: value.length >= 10,
    letter: /[a-z]/i.test(value),
    number: /\d/.test(value),
    symbol: /[^a-z0-9]/i.test(value)
  };
}

function getPasswordStrengthLabel(rules) {
  const metCount = Number(rules.length) + Number(rules.letter) + Number(rules.number) + Number(rules.symbol);
  if (metCount >= 4) return "Good";
  if (metCount >= 2) return "Medium";
  return "Weak";
}

function getPasswordStrengthPercent(rules) {
  const metCount = Number(rules.length) + Number(rules.letter) + Number(rules.number) + Number(rules.symbol);
  return Math.min(100, Math.max(15, metCount * 25));
}

function persistAuth(result) {
  if (result?.expiresAt) {
    localStorage.setItem("zenin_auth_expires_at", String(result.expiresAt));
  } else {
    localStorage.removeItem("zenin_auth_expires_at");
  }
  if (result?.user) {
    localStorage.setItem("zenin_auth_user", JSON.stringify(result.user));
    if (result.user.email) localStorage.setItem("zenin_email", result.user.email);
    return;
  }
  localStorage.removeItem("zenin_auth_user");
}

async function applyRequestedPlanIfAny() {
  const plan = getRequestedPlan();
  if (!plan) return;
  const billingCycle = getRequestedBillingCycle();
  const res = await zeninFetch("/account/plan", {
    method: "POST",
    body: JSON.stringify({ plan, billingCycle })
  });
  if (!res.ok) return;
  const data = await res.json().catch(() => ({}));
  if (data?.user) {
    localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
    if (data.user.email) localStorage.setItem("zenin_email", data.user.email);
  }
  localStorage.removeItem("zenin_pending_plan");
  localStorage.removeItem("zenin_pending_billing_cycle");
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export default function AuthPage() {
  const [mode, setMode] = useState(getModeFromLocation);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [signupStep, setSignupStep] = useState("email");
  const [forgotStep, setForgotStep] = useState("request");
  const [resetTokenMode, setResetTokenMode] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMethod, setMfaMethod] = useState("");

  const [signupForm, setSignupForm] = useState({
    email: getEmailFromStorage(),
    password: "",
    displayName: ""
  });
  const [signinForm, setSigninForm] = useState({
    email: getEmailFromStorage(),
    password: "",
    otpCode: "",
    passkeyId: ""
  });
  const [forgotForm, setForgotForm] = useState({ email: getEmailFromStorage(), token: "", newPassword: "" });
  const [passkeyForm, setPasskeyForm] = useState({ name: "Primary Device", provider: PASSKEY_PROVIDERS[0] });

  const [rememberMe, setRememberMe] = useState(true);
  const [showSigninPassword, setShowSigninPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signinUsePasskey, setSigninUsePasskey] = useState(false);
  const [signupTouched, setSignupTouched] = useState(false);
  const [signinTouched, setSigninTouched] = useState(false);
  const [legalDoc, setLegalDoc] = useState("");

  const signupPasswordRules = useMemo(() => getPasswordRuleState(signupForm.password), [signupForm.password]);
  const signupStrengthLabel = useMemo(() => getPasswordStrengthLabel(signupPasswordRules), [signupPasswordRules]);
  const signupStrengthPercent = useMemo(() => getPasswordStrengthPercent(signupPasswordRules), [signupPasswordRules]);

  useEffect(() => {
    let mounted = true;
    zeninFetch("/auth/me")
      .then((res) => res.json().catch(() => ({})).then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!mounted) return;
        if (ok && data?.authenticated && data?.user) {
          localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
          if (data.user.email) localStorage.setItem("zenin_email", data.user.email);
          const target = getPostAuthRedirectPath();
          localStorage.removeItem("zenin_post_auth_next");
          window.location.replace(target);
          return;
        }
        localStorage.removeItem("zenin_auth_user");
        localStorage.removeItem("zenin_auth_expires_at");
      })
      .catch(() => {
        // no-op, user can continue auth flow
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const searchMode = String(url.searchParams.get("mode") || "").toLowerCase();
    if (["signup", "signin", "forgot"].includes(searchMode) && searchMode !== mode) {
      setMode(searchMode);
    }
  }, [mode]);

  const setModeAndUrl = (nextMode) => {
    setError("");
    setMessage("");
    setMode(nextMode);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMode);
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  const runAction = async (action) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const redirectToApp = async () => {
    await applyRequestedPlanIfAny();
    const target = getPostAuthRedirectPath();
    localStorage.removeItem("zenin_post_auth_next");
    window.location.href = target;
  };

  const onSignupContinue = () => {
    setSignupTouched(true);
    if (!isValidEmail(signupForm.email)) {
      setError("Enter a valid email address.");
      return;
    }
    setError("");
    setSignupStep("secure");
  };

  const onCreateAccount = () => runAction(async () => {
    if (!isValidEmail(signupForm.email)) throw new Error("Enter a valid email address.");
    const res = await zeninFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email: signupForm.email,
        password: signupForm.password,
        displayName: signupForm.displayName
      })
    });
    const data = await readJson(res);
    persistAuth(data);
    setSignupStep("created");
  });

  const onSignin = (overrideCode) => runAction(async () => {
    setSigninTouched(true);
    if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
    if (!signinForm.password.trim()) throw new Error("Enter your password.");
    const payload = {
      email: signinForm.email,
      password: signinForm.password,
      rememberMe
    };
    const code = overrideCode || mfaCode;
    if (code) payload.verificationCode = code;
    const res = await zeninFetch("/auth/signin", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await readJson(res);
    if (data.requiresMfa) {
      setMfaMethod(data.method || "authenticator");
      setMfaCode("");
      setMfaStep(true);
      return;
    }
    persistAuth(data);
    await redirectToApp();
  });

  const onMfaVerify = () => runAction(async () => {
    if (!/^\d{6,8}$/.test(mfaCode.trim())) throw new Error("Enter a valid verification code.");
    await onSignin(mfaCode.trim());
  });

  const onPasskeySignin = () => runAction(async () => {
    const optionsRes = await zeninFetch("/auth/passkeys/authenticate/generate-options");
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options?.error || "Failed to get passkey options.");
    const { challengeId, ...webAuthnOptions } = options;
    const assertion = await startAuthentication(webAuthnOptions);
    const verifyRes = await zeninFetch("/auth/passkeys/authenticate/verify", {
      method: "POST",
      body: JSON.stringify({ response: assertion, challengeId, rememberMe }),
    });
    const data = await readJson(verifyRes);
    persistAuth(data);
    await redirectToApp();
  });

  const onForgotRequest = () => runAction(async () => {
    if (!isValidEmail(forgotForm.email)) throw new Error("Enter a valid email address.");
    const res = await zeninFetch("/auth/forgot-password/request", {
      method: "POST",
      body: JSON.stringify({ email: forgotForm.email })
    });
    const data = await readJson(res);
    if (data?.devResetToken) {
      setMessage(`Dev reset token: ${data.devResetToken}`);
    }
    setForgotStep("check-email");
  });

  const onForgotConfirm = () => runAction(async () => {
    if (!forgotForm.token.trim()) throw new Error("Enter your reset token.");
    if (!forgotForm.newPassword.trim()) throw new Error("Enter a new password.");
    const res = await zeninFetch("/auth/forgot-password/confirm", {
      method: "POST",
      body: JSON.stringify({ token: forgotForm.token, newPassword: forgotForm.newPassword })
    });
    const data = await readJson(res);
    persistAuth(data);
    await redirectToApp();
  });

  const onOAuthMock = (provider) => runAction(async () => {
    if (!ENABLE_OAUTH_MOCK) {
      throw new Error("OAuth mock sign-in is disabled.");
    }
    const res = await zeninFetch("/auth/oauth/mock", {
      method: "POST",
      body: JSON.stringify({ provider })
    });
    const data = await readJson(res);
    persistAuth(data);
    await redirectToApp();
  });

  const onRegisterPasskey = () => runAction(async () => {
    const optionsRes = await zeninFetch("/auth/passkeys/register/generate-options");
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options?.error || "Failed to get registration options.");
    const attResp = await startRegistration(options);
    const verifyRes = await zeninFetch("/auth/passkeys/register/verify", {
      method: "POST",
      body: JSON.stringify({
        response: attResp,
        name: passkeyForm.name,
        provider: passkeyForm.provider
      })
    });
    const data = await readJson(verifyRes);
    if (data?.user) localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
    setMessage("Passkey registered successfully.");
  });

  const signupEmailInvalid = signupTouched && !isValidEmail(signupForm.email);
  const signinEmailInvalid = signinTouched && !isValidEmail(signinForm.email);
  const openLegalDoc = (doc) => setLegalDoc(doc);
  const closeLegalDoc = () => setLegalDoc("");

  return (
    <div className="auth-v2-shell">
      <div className="auth-v2-bg" aria-hidden="true" />
      <main className="auth-v2-main">
        <a className="auth-v2-logo" href="/" aria-label="Zenin Capital homepage">
          <ZeninLogo size="md" />
        </a>

        <section className="auth-v2-card">
          <button className="auth-v2-back" onClick={() => { window.location.href = "/"; }}>
            ← Back to homepage
          </button>

          {mode === "signup" && signupStep === "email" && (
            <>
              <h1>Create your Zenin Capital account</h1>
              <p className="auth-v2-subtitle">Start tracking portfolios, watchlists, options, taxes, and market insights in one secure workspace.</p>

              <label className="auth-v2-label" htmlFor="signup-email">Email address</label>
              <input
                id="signup-email"
                className={`auth-v2-input ${signupEmailInvalid ? "is-error" : ""}`}
                type="email"
                placeholder="you@example.com"
                value={signupForm.email}
                onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
              />
              {signupEmailInvalid ? <p className="auth-v2-error-inline">Enter a valid email address.</p> : null}

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onSignupContinue}>
                {loading ? "Please wait..." : "Continue"}
              </button>

              {ENABLE_OAUTH_MOCK ? (
                <>
                  <div className="auth-v2-divider"><span>Or continue with</span></div>
                  <div className="auth-v2-oauth-row">
                    {OAUTH_PROVIDERS.map((provider) => (
                      <button key={provider.key} className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => onOAuthMock(provider.key)}>
                        <span className="provider-icon">{provider.icon}</span>
                        <span>{provider.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="auth-v2-footnote">Social sign-in is not enabled in this environment yet.</p>
              )}

              <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-passkey-entry" disabled={loading} onClick={() => setSignupStep("passkey")}>Sign up with passkey</button>
              <p className="auth-v2-footnote">Use Face ID, Touch ID, Windows Hello, or your device passcode.</p>

              <div className="auth-v2-divider auth-v2-divider-soft" />

              <p className="auth-v2-bottom-link">Already have an account? <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("signin")}>Sign in</button></p>
              <p className="auth-v2-terms">By continuing, you agree to Zenin Capital&apos;s <button type="button" className="auth-v2-link-btn" onClick={() => openLegalDoc("terms")}>Terms</button> and <button type="button" className="auth-v2-link-btn" onClick={() => openLegalDoc("privacy")}>Privacy Policy</button>.</p>
            </>
          )}

          {mode === "signup" && signupStep === "secure" && (
            <>
              <h1>Secure your account</h1>
              <p className="auth-v2-subtitle">Create a password or use a passkey for faster sign-in.</p>

              <label className="auth-v2-label" htmlFor="signup-email-locked">Email address</label>
              <div className="auth-v2-readonly-row">
                <input id="signup-email-locked" className="auth-v2-input" type="email" value={signupForm.email} readOnly />
                <button className="auth-v2-link-btn" onClick={() => setSignupStep("email")}>Change</button>
              </div>

              <label className="auth-v2-label" htmlFor="signup-password">Create password</label>
              <div className="auth-v2-password-row">
                <input
                  id="signup-password"
                  className="auth-v2-input"
                  type={showSignupPassword ? "text" : "password"}
                  placeholder="Minimum 10 characters"
                  value={signupForm.password}
                  onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))}
                />
                <button className="auth-v2-eye-btn" onClick={() => setShowSignupPassword((prev) => !prev)}>{showSignupPassword ? "Hide" : "Show"}</button>
              </div>

              <div className="auth-v2-strength-row">
                <span>Password strength</span>
                <strong>{signupStrengthLabel}</strong>
              </div>
              <div className="auth-v2-strength-track">
                <span style={{ width: `${signupStrengthPercent}%` }} />
              </div>

              <ul className="auth-v2-rule-list">
                <li className={signupPasswordRules.length ? "ok" : ""}>At least 10 characters</li>
                <li className={signupPasswordRules.letter ? "ok" : ""}>At least one letter</li>
                <li className={signupPasswordRules.number ? "ok" : ""}>At least one number</li>
                <li className={signupPasswordRules.symbol ? "ok" : ""}>At least one symbol</li>
              </ul>

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onCreateAccount}>Create account</button>
              <button className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => setSignupStep("passkey")}>Use passkey instead</button>

              {ENABLE_OAUTH_MOCK ? (
                <>
                  <div className="auth-v2-divider"><span>Or continue with</span></div>
                  <div className="auth-v2-oauth-row">
                    {OAUTH_PROVIDERS.map((provider) => (
                      <button key={provider.key} className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => onOAuthMock(provider.key)}>
                        <span className="provider-icon">{provider.icon}</span>
                        <span>{provider.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="auth-v2-footnote">Social sign-in is not enabled in this environment yet.</p>
              )}

              <p className="auth-v2-bottom-link">Already have an account? <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("signin")}>Sign in</button></p>
            </>
          )}

          {mode === "signup" && signupStep === "passkey" && (
            <>
              <h1>Create a passkey</h1>
              <p className="auth-v2-subtitle">Use your fingerprint, face, screen lock, or security key to sign in securely.</p>

              <div className="auth-v2-passkey-badge">🔐</div>

              <ul className="auth-v2-rule-list auth-v2-rule-list-spaced">
                <li className="ok">No password to remember</li>
                <li className="ok">Protected against phishing</li>
                <li className="ok">Works with Face ID, Touch ID, Windows Hello, and security keys</li>
              </ul>

              <label className="auth-v2-label" htmlFor="passkey-name">Passkey name</label>
              <input id="passkey-name" className="auth-v2-input" value={passkeyForm.name} onChange={(e) => setPasskeyForm((prev) => ({ ...prev, name: e.target.value }))} />

              <label className="auth-v2-label" htmlFor="passkey-provider">Provider</label>
              <select id="passkey-provider" className="auth-v2-input" value={passkeyForm.provider} onChange={(e) => setPasskeyForm((prev) => ({ ...prev, provider: e.target.value }))}>
                {PASSKEY_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>{provider}</option>
                ))}
              </select>

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onRegisterPasskey}>Create passkey</button>
              <button className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => setSignupStep("secure")}>Use password instead</button>
              {message ? <p className="auth-v2-success-inline">✓ {message}</p> : null}
            </>
          )}

          {mode === "signup" && signupStep === "created" && (
            <>
              <div className="auth-v2-success-circle">✓</div>
              <h1>Account created</h1>
              <p className="auth-v2-subtitle">Your Zenin Capital workspace is ready.</p>

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={() => setSignupStep("passkey")}>Continue to setup</button>
              <button className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => runAction(redirectToApp)}>Skip for now</button>

              <div className="auth-v2-divider"><span>Get started with these next steps</span></div>
              <div className="auth-v2-tile-grid">
                <article><h3>Connect portfolio</h3><p>Link your accounts and import holdings.</p></article>
                <article><h3>Create watchlist</h3><p>Track the assets that matter to you.</p></article>
                <article><h3>Set tax country</h3><p>Configure your tax residency and rules.</p></article>
                <article><h3>Explore analytics</h3><p>Discover insights and market intelligence.</p></article>
              </div>
            </>
          )}

          {mode === "signin" && (
            <>
              <h1>Welcome back</h1>
              <p className="auth-v2-subtitle">Sign in to continue to your Zenin Capital workspace.</p>

              <label className="auth-v2-label" htmlFor="signin-email">Email address</label>
              <div className="auth-v2-readonly-row">
                <input
                  id="signin-email"
                  className={`auth-v2-input ${signinEmailInvalid ? "is-error" : ""}`}
                  type="email"
                  placeholder="user@example.com"
                  value={signinForm.email}
                  onChange={(e) => setSigninForm((prev) => ({ ...prev, email: e.target.value }))}
                />
                <button className="auth-v2-link-btn" onClick={() => setSigninForm((prev) => ({ ...prev, email: "" }))}>Change</button>
              </div>

              <label className="auth-v2-label" htmlFor="signin-password">Password</label>
              <div className="auth-v2-password-row">
                <input
                  id="signin-password"
                  className="auth-v2-input"
                  type={showSigninPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={signinForm.password}
                  onChange={(e) => setSigninForm((prev) => ({ ...prev, password: e.target.value }))}
                />
                <button className="auth-v2-eye-btn" onClick={() => setShowSigninPassword((prev) => !prev)}>{showSigninPassword ? "Hide" : "Show"}</button>
              </div>

              <div className="auth-v2-check-row">
                <label>
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Remember me</span>
                </label>
                <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("forgot")}>Forgot password?</button>
              </div>

              {mfaStep ? (
                <>
                  <div style={{ margin: '16px 0 8px', padding: '16px', borderRadius: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                    <p className="auth-v2-subtitle" style={{ marginBottom: '12px' }}>Enter the 6-digit code from your {mfaMethod === "authenticator" ? "authenticator app" : mfaMethod === "sms" ? "phone" : "email"}.</p>
                    <label className="auth-v2-label" htmlFor="mfa-code">Verification Code</label>
                    <input
                      id="mfa-code"
                      className="auth-v2-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={8}
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      autoFocus
                    />
                  </div>
                  <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onMfaVerify}>{loading ? "Verifying..." : "Verify"}</button>
                  <button className="auth-v2-btn auth-v2-btn-ghost" onClick={() => { setMfaStep(false); setMfaCode(""); setError(""); }}>Back</button>
                </>
              ) : (
                <>
                  <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={() => onSignin()}>Sign in</button>

                  <div className="auth-v2-divider"><span>Or</span></div>

                  <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-passkey-entry" disabled={loading} onClick={onPasskeySignin}>
                    🔑 Sign in with Passkey
                  </button>

                  {ENABLE_OAUTH_MOCK ? (
                    <>
                      <div className="auth-v2-divider"><span>Or continue with</span></div>
                      <div className="auth-v2-oauth-row auth-v2-oauth-row-stacked">
                        {OAUTH_PROVIDERS.map((provider) => (
                          <button key={provider.key} className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={() => onOAuthMock(provider.key)}>
                            <span className="provider-icon">{provider.icon}</span>
                            <span>Continue with {provider.label}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="auth-v2-footnote">Social sign-in is not enabled in this environment yet.</p>
                  )}
                </>
              )}

              <p className="auth-v2-bottom-link">New to Zenin Capital? <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("signup")}>Create account</button></p>
              <p className="auth-v2-terms">By continuing, you agree to Zenin Capital&apos;s <button type="button" className="auth-v2-link-btn" onClick={() => openLegalDoc("terms")}>Terms</button> and <button type="button" className="auth-v2-link-btn" onClick={() => openLegalDoc("privacy")}>Privacy Policy</button>.</p>
            </>
          )}

          {mode === "forgot" && forgotStep === "request" && (
            <>
              <h1>Reset your password</h1>
              <p className="auth-v2-subtitle">Enter your email and we&apos;ll send a reset link.</p>

              <label className="auth-v2-label" htmlFor="forgot-email">Email address</label>
              <input
                id="forgot-email"
                className="auth-v2-input"
                type="email"
                placeholder="you@example.com"
                value={forgotForm.email}
                onChange={(e) => setForgotForm((prev) => ({ ...prev, email: e.target.value }))}
              />

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onForgotRequest}>Send reset link</button>

              <div className="auth-v2-divider"><span>Back to sign in</span></div>
              <button className="auth-v2-btn auth-v2-btn-ghost" onClick={() => setModeAndUrl("signin")}>Sign in</button>

              <button className="auth-v2-text-btn" onClick={() => setResetTokenMode((prev) => !prev)}>{resetTokenMode ? "Hide reset token form" : "I already have a reset token"}</button>
              {resetTokenMode ? (
                <div className="auth-v2-inline-panel">
                  <input className="auth-v2-input" placeholder="Reset token" value={forgotForm.token} onChange={(e) => setForgotForm((prev) => ({ ...prev, token: e.target.value }))} />
                  <input className="auth-v2-input" placeholder="New password" type="password" value={forgotForm.newPassword} onChange={(e) => setForgotForm((prev) => ({ ...prev, newPassword: e.target.value }))} />
                  <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onForgotConfirm}>Reset password</button>
                </div>
              ) : null}
            </>
          )}

          {mode === "forgot" && forgotStep === "check-email" && (
            <>
              <h1>Check your email</h1>
              <p className="auth-v2-subtitle">We sent a verification link to <strong>{forgotForm.email || "your inbox"}</strong>.</p>

              <div className="auth-v2-mail-illustration">✉</div>

              <button className="auth-v2-btn auth-v2-btn-primary" onClick={() => window.open("https://mail.google.com", "_blank", "noopener,noreferrer")}>Open email app</button>

              <div className="auth-v2-divider"><span>or</span></div>
              <div className="auth-v2-split-actions">
                <button className="auth-v2-link-btn" disabled={loading} onClick={onForgotRequest}>Resend email</button>
                <button className="auth-v2-link-btn" onClick={() => setForgotStep("request")}>Change email</button>
              </div>

              <p className="auth-v2-footnote">Didn&apos;t receive it? Check your spam folder or resend the link.</p>
            </>
          )}

          {message ? <p className="auth-v2-message">{message}</p> : null}
          {error ? <p className="auth-v2-error">{error}</p> : null}
        </section>
      </main>
      <AuthLegalModal doc={legalDoc} onClose={closeLegalDoc} />
      <SpeedInsights />
    </div>
  );
}

function AuthLegalModal({ doc, onClose }) {
  if (!doc) return null;
  const isTerms = doc === "terms";
  return (
    <div
      className="home-v3-drawer-overlay"
      onMouseDown={onClose}
      role="presentation"
      style={{ background: "rgba(2, 6, 23, 0.7)", backdropFilter: "blur(8px)" }}
    >
      <aside
        className="home-v3-detail-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={isTerms ? "Terms of Service" : "Privacy Policy"}
        style={{ maxWidth: 720 }}
      >
        <div className="home-v3-drawer-head">
          <h2>{isTerms ? "Terms of Service" : "Privacy Policy"}</h2>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="home-v3-drawer-rows" style={{ gap: 16 }}>
          {isTerms ? (
            <>
              <div><span>Access</span><strong>Use the workspace for lawful research, portfolio tracking, and analytics only.</strong></div>
              <div><span>Accounts</span><strong>You are responsible for credentials, connected accounts, and read-only API usage.</strong></div>
              <div><span>Market data</span><strong>Quotes, tax estimates, and analytics are informational and may be delayed or incomplete.</strong></div>
              <div><span>Not advice</span><strong>Nothing in Zenin Capital is investment, legal, or tax advice.</strong></div>
            </>
          ) : (
            <>
              <div><span>Data stored</span><strong>Email, workspace preferences, saved calculations, and locally cached portfolio context.</strong></div>
              <div><span>Connected sources</span><strong>Read-only keys and linked accounts are used to display holdings and analytics inside your workspace.</strong></div>
              <div><span>Security</span><strong>Use least-privilege credentials and avoid providing withdrawal-enabled keys.</strong></div>
              <div><span>Control</span><strong>You can remove local session data by signing out or clearing browser storage.</strong></div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
