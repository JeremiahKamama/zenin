import React, { useEffect, useMemo, useState } from "react";
import { zeninFetch } from "./utils/zeninFetch";

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

function getStoredAuthToken() {
  if (typeof window === "undefined") return "";
  return String(sessionStorage.getItem("zenin_auth_token") || localStorage.getItem("zenin_auth_token") || "").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function getPasswordRuleState(password) {
  const value = String(password || "");
  return {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    numberOrSymbol: /[\d\W]/.test(value)
  };
}

function getPasswordStrengthLabel(rules) {
  const metCount = Number(rules.length) + Number(rules.uppercase) + Number(rules.numberOrSymbol);
  if (metCount >= 3) return "Good";
  if (metCount === 2) return "Medium";
  return "Weak";
}

function getPasswordStrengthPercent(rules) {
  const metCount = Number(rules.length) + Number(rules.uppercase) + Number(rules.numberOrSymbol);
  return Math.min(100, Math.max(15, metCount * 33));
}

function persistAuth(result, remember = true) {
  if (!result?.token) return;
  sessionStorage.setItem("zenin_auth_token", result.token);
  if (remember) {
    localStorage.setItem("zenin_auth_token", result.token);
  } else {
    localStorage.removeItem("zenin_auth_token");
  }
  localStorage.setItem("zenin_auth_expires_at", String(result.expiresAt || ""));
  if (result.user) {
    localStorage.setItem("zenin_auth_user", JSON.stringify(result.user));
    if (result.user.email) localStorage.setItem("zenin_email", result.user.email);
  }
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

  const signupPasswordRules = useMemo(() => getPasswordRuleState(signupForm.password), [signupForm.password]);
  const signupStrengthLabel = useMemo(() => getPasswordStrengthLabel(signupPasswordRules), [signupPasswordRules]);
  const signupStrengthPercent = useMemo(() => getPasswordStrengthPercent(signupPasswordRules), [signupPasswordRules]);

  useEffect(() => {
    let mounted = true;
    const token = getStoredAuthToken();
    if (!token) return () => {
      mounted = false;
    };

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
        }
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
    persistAuth(data, true);
    setSignupStep("created");
  });

  const onSignin = () => runAction(async () => {
    setSigninTouched(true);
    if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
    if (!signinForm.password.trim()) throw new Error("Enter your password.");
    const payload = {
      email: signinForm.email,
      password: signinForm.password
    };
    if (signinForm.otpCode) payload.otpCode = signinForm.otpCode;
    if (signinForm.passkeyId) payload.passkeyId = signinForm.passkeyId;
    const res = await zeninFetch("/auth/signin", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await readJson(res);
    persistAuth(data, rememberMe);
    if (!rememberMe) {
      localStorage.removeItem("zenin_auth_expires_at");
    }
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
    persistAuth(data, true);
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
    const res = await zeninFetch("/auth/passkeys/register", {
      method: "POST",
      body: JSON.stringify({
        name: passkeyForm.name,
        provider: passkeyForm.provider
      })
    });
    const data = await readJson(res);
    if (data?.user) localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
    setSigninForm((prev) => ({ ...prev, passkeyId: data?.passkey?.id || prev.passkeyId }));
    setMessage("Passkey created successfully.");
  });

  const signupEmailInvalid = signupTouched && !isValidEmail(signupForm.email);
  const signinEmailInvalid = signinTouched && !isValidEmail(signinForm.email);

  return (
    <div className="auth-v2-shell">
      <div className="auth-v2-bg" aria-hidden="true" />
      <main className="auth-v2-main">
        <a className="auth-v2-logo" href="/" aria-label="Zenin Capital homepage">
          <span className="auth-v2-logo-mark">Z</span>
          <span>ZENIN CAPITAL</span>
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
              ) : null}

              <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-passkey-entry" disabled={loading} onClick={() => setSignupStep("passkey")}>Sign up with passkey</button>
              <p className="auth-v2-footnote">Use Face ID, Touch ID, Windows Hello, or your device passcode.</p>

              <div className="auth-v2-divider auth-v2-divider-soft" />

              <p className="auth-v2-bottom-link">Already have an account? <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("signin")}>Sign in</button></p>
              <p className="auth-v2-terms">By continuing, you agree to Zenin Capital&apos;s <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.</p>
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
                  placeholder="Minimum 8 characters"
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
                <li className={signupPasswordRules.length ? "ok" : ""}>At least 8 characters</li>
                <li className={signupPasswordRules.uppercase ? "ok" : ""}>One uppercase letter</li>
                <li className={signupPasswordRules.numberOrSymbol ? "ok" : ""}>One number or symbol</li>
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
              ) : null}

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

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onSignin}>Sign in</button>

              {signinUsePasskey ? (
                <>
                  <label className="auth-v2-label" htmlFor="signin-passkey-id">Passkey ID</label>
                  <input
                    id="signin-passkey-id"
                    className="auth-v2-input"
                    placeholder="Enter passkey ID if prompted"
                    value={signinForm.passkeyId}
                    onChange={(e) => setSigninForm((prev) => ({ ...prev, passkeyId: e.target.value }))}
                  />
                </>
              ) : null}

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
              ) : null}

              <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-passkey-entry" disabled={loading} onClick={() => setSigninUsePasskey((prev) => !prev)}>
                {signinUsePasskey ? "Hide passkey option" : "Use passkey instead"}
              </button>

              <p className="auth-v2-bottom-link">New to Zenin Capital? <button className="auth-v2-link-btn" onClick={() => setModeAndUrl("signup")}>Create account</button></p>
              <p className="auth-v2-terms">By continuing, you agree to Zenin Capital&apos;s <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.</p>
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
    </div>
  );
}
