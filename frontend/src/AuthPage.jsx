import React, { useEffect, useState } from "react";
import "./public.css";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applySeo } from "./utils/seo";
import { clearPostAuthRedirect, getPostAuthRedirectPath, storePostAuthRedirect } from "./utils/authRedirect";
import { zeninFetchJson } from "./utils/zeninFetch";
import { startSupabasePasskeyAuthentication, verifySupabasePasskeyAuthentication } from "./utils/supabaseAuth";
import { startAuthentication } from "@simplewebauthn/browser";

function getModeFromLocation() {
  if (typeof window === "undefined") return "signup";
  const search = new URLSearchParams(window.location.search);
  const mode = String(search.get("mode") || "signup").toLowerCase();
  return ["signup", "signin", "forgot"].includes(mode) ? mode : "signup";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isStrongPassword(password) {
  const value = String(password || "");
  return value.length >= 10 && /[a-z]/i.test(value) && /\d/.test(value) && /[^a-z0-9]/i.test(value);
}

function isRecoveryLinkActive() {
  if (typeof window === "undefined") return false;
  const locationValue = `${window.location.search}${window.location.hash}`.toLowerCase();
  return locationValue.includes("type=recovery") || locationValue.includes("reset=1");
}

function getRedirectUrl(path = "/auth?mode=signin") {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.1 0 9.5 7 9.5 7a17 17 0 0 1-2.1 3" />
      <path d="M6.6 6.8C3.9 8.5 2.5 12 2.5 12s3.4 7 9.5 7a9.8 9.8 0 0 0 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState(getModeFromLocation);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signupForm, setSignupForm] = useState({ email: "", password: "", displayName: "" });
  const [signinForm, setSigninForm] = useState({ email: "", password: "" });
  const [forgotForm, setForgotForm] = useState({ email: "", newPassword: "" });
  const [mfaForm, setMfaForm] = useState({ code: "" });
  const [visiblePasswords, setVisiblePasswords] = useState({ signup: false, signin: false, reset: false });
  const [rememberMe, setRememberMe] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(isRecoveryLinkActive);

  const redirectToApp = () => {
    const target = getPostAuthRedirectPath();
    clearPostAuthRedirect();
    window.location.replace(target);
  };

  const runAction = async (action) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError?.message || "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const shouldPromptForMfa = async () => {
    // Server-driven MFA will indicate when signin requires it.
    return false;
  };

  const finishSignedInSession = async () => {
    const me = await zeninFetchJson("/api/auth/me");
    if (!me?.authenticated || !me?.user) {
      throw new Error("Signed in successfully, but Zenin could not start your workspace session.");
    }
    redirectToApp();
  };

  const updateMode = (nextMode) => {
    setError("");
    setMessage("");
    setMode(nextMode);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMode);
    url.searchParams.delete("error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    applySeo({
      title: "Zenin Capital | Sign In",
      description: "Access your Zenin Capital workspace with secure authentication.",
      robots: "noindex, nofollow, noarchive",
      pathname: typeof window !== "undefined" ? window.location.pathname : "/auth",
      canonicalPath: "/auth",
      ogTitle: "Zenin Capital | Account Access",
      ogDescription: "Secure sign in, sign up, and account recovery for Zenin Capital.",
      schema: []
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next) {
      storePostAuthRedirect(next, "/app");
    }
    const incomingError = String(params.get("error") || params.get("oauthError") || "").trim();
    if (incomingError) {
      setError(incomingError);
    }
    if (isRecoveryLinkActive()) {
      setRecoveryReady(true);
      setMode("forgot");
    }
  }, []);

  useEffect(() => {
    // No client-side Supabase listener; handle recovery and sign-in via URL and backend session checks.
  }, [rememberMe]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      try {
        const me = await zeninFetchJson("/api/auth/me");
        if (mounted && me?.authenticated && !isRecoveryLinkActive()) {
          redirectToApp();
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const onSignUp = () => runAction(async () => {
    if (!signupForm.displayName.trim()) throw new Error("Enter your display name.");
    if (!isValidEmail(signupForm.email)) throw new Error("Enter a valid email address.");
    if (!isStrongPassword(signupForm.password)) {
      throw new Error("Password must be 10+ characters with letters, numbers, and symbols.");
    }
    const data = await zeninFetchJson("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email: signupForm.email.trim(), password: signupForm.password, displayName: signupForm.displayName.trim() })
    });
    if (data?.requiresVerification) {
      updateMode("signin");
      setSigninForm((prev) => ({ ...prev, email: signupForm.email.trim() }));
      setMessage("Check your inbox to confirm your email, then return to sign in.");
      return;
    }
    await finishSignedInSession();
  });

  const onSignIn = () => runAction(async () => {
    if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
    if (!signinForm.password.trim()) throw new Error("Enter your password.");
    const payload = { email: signinForm.email.trim(), password: signinForm.password, rememberMe };
    const data = await zeninFetchJson("/api/auth/signin", { method: "POST", body: JSON.stringify(payload) });
    if (data?.requiresMfa) {
      setMode("mfa");
      setMessage("Enter the code from your authenticator app to finish signing in.");
      return;
    }
    await finishSignedInSession();
  });

  const onVerifyMfa = () => runAction(async () => {
    const code = String(mfaForm.code || "").trim();
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit authenticator code.");
    const payload = { email: signinForm.email.trim(), password: signinForm.password, verificationCode: code, rememberMe };
    await zeninFetchJson("/api/auth/signin", { method: "POST", body: JSON.stringify(payload) });
    await finishSignedInSession();
  });

  const onForgotRequest = () => runAction(async () => {
    if (!isValidEmail(forgotForm.email)) throw new Error("Enter a valid email address.");
    await zeninFetchJson("/api/auth/forgot-password/request", { method: "POST", body: JSON.stringify({ email: forgotForm.email.trim() }) });
    setMessage("Reset instructions sent. Open the email link here to set a new password.");
  });

  const onResetPassword = () => runAction(async () => {
    if (!recoveryReady) throw new Error("Open the recovery link from your email first.");
    if (!isStrongPassword(forgotForm.newPassword)) {
      throw new Error("Password must be 10+ characters with letters, numbers, and symbols.");
    }
    // Try to read a reset token from the URL (query or fragment)
    const url = typeof window !== "undefined" ? new URL(window.location.href) : null;
    let token = null;
    if (url) {
      token = String(url.searchParams.get("token") || url.searchParams.get("t") || "").trim();
      if (!token && url.hash) {
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
        token = String(hashParams.get("token") || hashParams.get("access_token") || "").trim();
      }
    }
    if (!token) throw new Error("No reset token found in the URL. Open the recovery link from your email.");
    await zeninFetchJson("/api/auth/forgot-password/confirm", { method: "POST", body: JSON.stringify({ token, newPassword: forgotForm.newPassword }) });
    await finishSignedInSession();
  });

  const onOAuth = (provider) => runAction(async () => {
    // Use backend OAuth start to avoid Supabase-hosted authorize URLs
    const returnTo = getRedirectUrl("/auth?mode=signin");
    await import("./utils/backendOAuth").then(({ startOAuth }) => startOAuth(provider, { returnTo }));
  });

  const signupPasswordRules = [
    { label: "At least 10 characters", ok: signupForm.password.length >= 10 },
    { label: "Includes a number", ok: /\d/.test(signupForm.password) },
    { label: "Includes a symbol", ok: /[^a-z0-9]/i.test(signupForm.password) },
  ];

  const togglePasswordVisibility = (field) => {
    setVisiblePasswords((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="auth-v2-shell">
      <div className="auth-v2-bg" aria-hidden="true" />
      <main className="auth-v2-main">
        <section className="auth-v2-card">
          <button className="auth-v2-back" onClick={() => { window.location.href = "/"; }}>
            <span>←</span> Back to home
          </button>

          {mode === "signup" ? (
            <>
              <h1>Create your workspace</h1>
              <p className="auth-v2-subtitle">Secure sign-in, email confirmation, and recovery for Zenin Capital.</p>

              <label className="auth-v2-label" htmlFor="signup-name">Display name</label>
              <input
                id="signup-name"
                className="auth-v2-input"
                value={signupForm.displayName}
                onChange={(e) => setSignupForm((prev) => ({ ...prev, displayName: e.target.value }))}
                placeholder="Your name"
                autoComplete="name"
              />

              <label className="auth-v2-label" htmlFor="signup-email">Email address</label>
              <input
                id="signup-email"
                className="auth-v2-input"
                type="email"
                value={signupForm.email}
                onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="auth-v2-label" htmlFor="signup-password">Password</label>
              <div className="auth-v2-password-row">
                <input
                  id="signup-password"
                  className="auth-v2-input"
                  type={visiblePasswords.signup ? "text" : "password"}
                  value={signupForm.password}
                  onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-v2-eye-btn"
                  onClick={() => togglePasswordVisibility("signup")}
                  aria-label={visiblePasswords.signup ? "Hide password" : "Show password"}
                  title={visiblePasswords.signup ? "Hide password" : "Show password"}
                >
                  {visiblePasswords.signup ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              <ul className="auth-v2-rule-list auth-v2-signup-rules" aria-label="Password requirements">
                {signupPasswordRules.map((rule) => (
                  <li key={rule.label} className={rule.ok ? "ok" : ""}>{rule.label}</li>
                ))}
              </ul>

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onSignUp}>
                {loading ? "Creating account..." : "Create account"}
              </button>

              <div className="auth-v2-divider">Or continue with</div>
              <div className="auth-v2-oauth-row">
                <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-google-btn" disabled={loading} onClick={() => onOAuth("google")}>
                  Continue with Google
                </button>
                <button className="auth-v2-btn auth-v2-btn-ghost" disabled={loading} onClick={async () => {
                  try {
                    setLoading(true);
                    const opts = await startSupabasePasskeyAuthentication();
                    const attResp = await startAuthentication(opts);
                    const verify = await verifySupabasePasskeyAuthentication({ response: attResp, challengeId: opts.challengeId, rememberMe });
                    if (verify?.success) {
                      await finishSignedInSession();
                    } else {
                      setError(verify?.error || "Passkey sign-in failed.");
                    }
                  } catch (e) {
                    setError(e?.message || "Passkey sign-in failed.");
                  } finally {
                    setLoading(false);
                  }
                }}>Sign in with Passkey</button>
              </div>

              <p className="auth-v2-bottom-link">Already have an account? <button className="auth-v2-link-btn" onClick={() => updateMode("signin")}>Sign in</button></p>
            </>
          ) : null}

          {mode === "signin" ? (
            <>
              <h1>Sign in</h1>
              <p className="auth-v2-subtitle">Continue to your Zenin workspace with secure authentication.</p>

              <label className="auth-v2-label" htmlFor="signin-email">Email address</label>
              <input
                id="signin-email"
                className="auth-v2-input"
                type="email"
                value={signinForm.email}
                onChange={(e) => setSigninForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="auth-v2-label" htmlFor="signin-password">Password</label>
              <div className="auth-v2-password-row">
                <input
                  id="signin-password"
                  className="auth-v2-input"
                  type={visiblePasswords.signin ? "text" : "password"}
                  value={signinForm.password}
                  onChange={(e) => setSigninForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-v2-eye-btn"
                  onClick={() => togglePasswordVisibility("signin")}
                  aria-label={visiblePasswords.signin ? "Hide password" : "Show password"}
                  title={visiblePasswords.signin ? "Hide password" : "Show password"}
                >
                  {visiblePasswords.signin ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              <div className="auth-v2-check-row">
                <label className="auth-v2-checkbox">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Keep this device signed in</span>
                </label>
                <button className="auth-v2-link-btn" onClick={() => updateMode("forgot")}>Forgot password?</button>
              </div>

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onSignIn}>
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <div className="auth-v2-divider">Or continue with</div>
              <div className="auth-v2-oauth-row">
                <button className="auth-v2-btn auth-v2-btn-ghost auth-v2-google-btn" disabled={loading} onClick={() => onOAuth("google")}>
                  Continue with Google
                </button>
              </div>

              <p className="auth-v2-bottom-link">Need an account? <button className="auth-v2-link-btn" onClick={() => updateMode("signup")}>Create one</button></p>
            </>
          ) : null}

          {mode === "forgot" ? (
            <>
              <h1>{recoveryReady ? "Set a new password" : "Reset password"}</h1>
              <p className="auth-v2-subtitle">
                {recoveryReady
                  ? "Choose a new password for your Zenin account."
                  : "Send a recovery link to your email, then return here to complete the reset."}
              </p>

              {!recoveryReady ? (
                <>
                  <label className="auth-v2-label" htmlFor="forgot-email">Email address</label>
                  <input
                    id="forgot-email"
                    className="auth-v2-input"
                    type="email"
                    value={forgotForm.email}
                    onChange={(e) => setForgotForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />

                  <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onForgotRequest}>
                    {loading ? "Sending..." : "Send reset link"}
                  </button>
                </>
              ) : (
                <>
                  <label className="auth-v2-label" htmlFor="reset-password">New password</label>
                  <div className="auth-v2-password-row">
                    <input
                      id="reset-password"
                      className="auth-v2-input"
                      type={visiblePasswords.reset ? "text" : "password"}
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                      placeholder="Enter a new password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="auth-v2-eye-btn"
                      onClick={() => togglePasswordVisibility("reset")}
                      aria-label={visiblePasswords.reset ? "Hide password" : "Show password"}
                      title={visiblePasswords.reset ? "Hide password" : "Show password"}
                    >
                      {visiblePasswords.reset ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>

                  <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} onClick={onResetPassword}>
                    {loading ? "Updating..." : "Update password"}
                  </button>
                </>
              )}

              <p className="auth-v2-bottom-link">Back to <button className="auth-v2-link-btn" onClick={() => updateMode("signin")}>sign in</button></p>
            </>
          ) : null}

          {mode === "mfa" ? (
            <>
              <h1>Verify it is you</h1>
              <p className="auth-v2-subtitle">This account has authenticator app MFA enabled.</p>

              <label className="auth-v2-label" htmlFor="mfa-code">Authenticator code</label>
              <input
                id="mfa-code"
                className="auth-v2-input"
                type="text"
                inputMode="numeric"
                value={mfaForm.code}
                onChange={(e) => setMfaForm({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                placeholder="6-digit code"
                autoComplete="one-time-code"
              />

              <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading || !/^\d{6}$/.test(mfaForm.code)} onClick={onVerifyMfa}>
                {loading ? "Verifying..." : "Verify and continue"}
              </button>

              <p className="auth-v2-bottom-link">
                Need to use another account? <button className="auth-v2-link-btn" onClick={() => updateMode("signin")}>Back to sign in</button>
              </p>
            </>
          ) : null}

          {error ? <p className="auth-v2-error-inline">{error}</p> : null}
          {message ? <p className="auth-v2-success-inline">✓ {message}</p> : null}
          {!isSupabaseConfigured() ? (
            <p className="auth-v2-error-inline">Authentication environment variables are missing on this frontend build.</p>
          ) : null}
        </section>
      </main>
      <SpeedInsights />
    </div>
  );
}
