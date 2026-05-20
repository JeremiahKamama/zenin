import React, { useEffect, useState } from "react";
import "./public.css";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applySeo } from "./utils/seo";
import { clearPostAuthRedirect, getPostAuthRedirectPath, storePostAuthRedirect } from "./utils/authRedirect";
import {
  ensureZeninSessionFromSupabase,
  getSupabaseClient,
  isSupabaseConfigured,
  subscribeToSupabaseAuth
} from "./utils/supabaseAuth";

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
    const unsubscribe = subscribeToSupabaseAuth(async (event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryReady(true);
        setMode("forgot");
        setMessage("Set a new password to finish recovery.");
        return;
      }
      if (event === "SIGNED_IN" && session) {
        const exchanged = await ensureZeninSessionFromSupabase({ rememberMe });
        if (exchanged?.user && !isRecoveryLinkActive()) {
          redirectToApp();
        }
      }
    });
    return unsubscribe;
  }, [rememberMe]);

  useEffect(() => {
    let mounted = true;
    if (!isSupabaseConfigured()) return () => {};
    ensureZeninSessionFromSupabase({ rememberMe: true }).then((result) => {
      if (mounted && result?.user && !isRecoveryLinkActive()) {
        redirectToApp();
      }
    }).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const onSignUp = () => runAction(async () => {
    if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
    if (!signupForm.displayName.trim()) throw new Error("Enter your display name.");
    if (!isValidEmail(signupForm.email)) throw new Error("Enter a valid email address.");
    if (!isStrongPassword(signupForm.password)) {
      throw new Error("Password must be 10+ characters with letters, numbers, and symbols.");
    }
    const client = getSupabaseClient();
    const { data, error: authError } = await client.auth.signUp({
      email: signupForm.email.trim(),
      password: signupForm.password,
      options: {
        emailRedirectTo: getRedirectUrl("/auth?mode=signup"),
        data: {
          display_name: signupForm.displayName.trim()
        }
      }
    });
    if (authError) throw authError;
    if (data.session?.access_token) {
      const exchanged = await ensureZeninSessionFromSupabase({ rememberMe });
      if (exchanged?.user) {
        redirectToApp();
        return;
      }
    }
    updateMode("signin");
    setSigninForm((prev) => ({ ...prev, email: signupForm.email.trim() }));
    setMessage("Check your inbox to confirm your email, then return to sign in.");
  });

  const onSignIn = () => runAction(async () => {
    if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
    if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
    if (!signinForm.password.trim()) throw new Error("Enter your password.");
    const client = getSupabaseClient();
    const { data, error: authError } = await client.auth.signInWithPassword({
      email: signinForm.email.trim(),
      password: signinForm.password
    });
    if (authError) throw authError;
    if (!data.session?.access_token) {
      throw new Error("Authentication did not return a valid session. Try again.");
    }
    const exchanged = await ensureZeninSessionFromSupabase({ rememberMe });
    if (!exchanged?.user) {
      throw new Error("Signed in successfully, but Zenin could not start your workspace session.");
    }
    redirectToApp();
  });

  const onForgotRequest = () => runAction(async () => {
    if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
    if (!isValidEmail(forgotForm.email)) throw new Error("Enter a valid email address.");
    const client = getSupabaseClient();
    const { error: authError } = await client.auth.resetPasswordForEmail(forgotForm.email.trim(), {
      redirectTo: getRedirectUrl("/auth?mode=forgot&reset=1")
    });
    if (authError) throw authError;
    setMessage("Reset instructions sent. Open the email link here to set a new password.");
  });

  const onResetPassword = () => runAction(async () => {
    if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
    if (!recoveryReady) throw new Error("Open the recovery link from your email first.");
    if (!isStrongPassword(forgotForm.newPassword)) {
      throw new Error("Password must be 10+ characters with letters, numbers, and symbols.");
    }
    const client = getSupabaseClient();
    const { error: authError } = await client.auth.updateUser({
      password: forgotForm.newPassword
    });
    if (authError) throw authError;
    const exchanged = await ensureZeninSessionFromSupabase({ rememberMe: true });
    if (!exchanged?.user) {
      throw new Error("Password updated, but Zenin could not start your workspace session.");
    }
    setMessage("Password updated successfully.");
    redirectToApp();
  });

  const onOAuth = (provider) => runAction(async () => {
    if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
    const client = getSupabaseClient();
    const { data, error: authError } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getRedirectUrl("/auth?mode=signin")
      }
    });
    if (authError) throw authError;
    if (data?.url) {
      window.location.href = data.url;
    }
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
