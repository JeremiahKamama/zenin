import React, { useState, useEffect } from "react";
import { ZeninLogo } from "./Branding";
import { clearPostAuthRedirect, getGuestWorkspacePath, getSignedInWorkspacePath, storePostAuthRedirect } from "../utils/authRedirect";
import { zeninFetchJson } from "../utils/zeninFetch";
import { startSupabasePasskeyAuthentication, verifySupabasePasskeyAuthentication } from "../utils/backendAuth";
import { startAuthentication } from "@simplewebauthn/browser";

const ENABLE_APPLE_OAUTH = false;

function getRedirectUrl(path = "/auth?mode=signin") {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isStrongPassword(password) {
  const value = String(password || "");
  return value.length >= 10 && /[a-z]/i.test(value) && /\d/.test(value) && /[^a-z0-9]/i.test(value);
}

function getAuthErrorMessage(error, fallback) {
  if (error?.code === "AUTH_SERVICE_TIMEOUT" || error?.code === "REQUEST_TIMEOUT") {
    return "Zenin's auth service is still waking up. Please try again in a moment, or wait for the backend health check to recover.";
  }
  if (error?.status === 503 || error?.code === "NETWORK_ERROR" || error?.code === "REQUEST_ABORTED") {
    return "Zenin's auth service is temporarily unavailable or still waking up. Please wait a moment and try signing in again.";
  }
  return error?.message || fallback;
}

/**
 * AuthModal provides a Sign In / Sign Up flow as a modal.
 * Includes a "Continue as Guest" option.
 */
export default function AuthModal({ isOpen, initialMode = "signup", initialError = "", returnTo = "/app", onClose }) {
  const [mode, setMode] = useState(initialMode); // 'signin', 'signup', 'forgot', 'forgot_success'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Forms
  const [signinForm, setSigninForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ email: "", password: "", fullName: "" });
  const [forgotForm, setForgotForm] = useState({ email: "" });

  const redirectToApp = () => {
    const target = getSignedInWorkspacePath();
    clearPostAuthRedirect();
    window.location.href = target;
  };

  const redirectToFullMfa = () => {
    storePostAuthRedirect(returnTo, "/app");
    const authUrl = new URL("/auth", window.location.origin);
    authUrl.searchParams.set("mode", "signin");
    authUrl.searchParams.set("next", returnTo || "/app");
    window.location.href = `${authUrl.pathname}${authUrl.search}`;
  };

  const redirectToFullVerification = (email) => {
    storePostAuthRedirect(returnTo, "/app");
    const authUrl = new URL("/auth", window.location.origin);
    authUrl.searchParams.set("mode", "verify");
    authUrl.searchParams.set("next", returnTo || "/app");
    if (email) authUrl.searchParams.set("email", email);
    window.location.href = `${authUrl.pathname}${authUrl.search}`;
  };

  const shouldUseFullMfaScreen = async () => {
    // Server-driven MFA handled by signin endpoint
    return false;
  };

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError(initialError || "");
      storePostAuthRedirect(returnTo, "/app");
    }
  }, [initialError, initialMode, isOpen, returnTo]);

  if (!isOpen) return null;

  useEffect(() => {
    // No Supabase client subscription; rely on backend session after signin/signup flows.
  }, [isOpen]);

  if (!isOpen) return null;

  const handleGuestEntry = () => {
    localStorage.removeItem("zenin_auth_user");
    localStorage.removeItem("zenin_auth_expires_at");
    const guestTarget = new URL(getGuestWorkspacePath(), window.location.origin);
    guestTarget.searchParams.set("guest", "1");
    clearPostAuthRedirect();
    window.location.href = `${guestTarget.pathname}${guestTarget.search}${guestTarget.hash}`;
  };

  const handleSignin = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
      if (!signinForm.password.trim()) throw new Error("Enter your password.");
      const payload = { email: signinForm.email.trim(), password: signinForm.password, rememberMe: true };
      const data = await zeninFetchJson("/api/auth/signin", { method: "POST", body: JSON.stringify(payload) });
      if (data?.requiresVerification) {
        redirectToFullVerification(signinForm.email.trim());
        return;
      }
      if (data?.requiresMfa) {
        redirectToFullMfa();
        return;
      }
      const me = await zeninFetchJson("/api/auth/me");
      if (!me?.authenticated || !me?.user) throw new Error("Signed in successfully, but Zenin could not start your workspace session.");
      redirectToApp();
    } catch (err) {
      setError(getAuthErrorMessage(err, "Failed to sign in"));
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!signupForm.fullName.trim()) throw new Error("Enter your full name.");
      if (!isValidEmail(signupForm.email)) throw new Error("Enter a valid email address.");
      if (!isStrongPassword(signupForm.password)) {
        throw new Error("Password must be 10+ characters with letters, numbers, and symbols.");
      }
      const data = await zeninFetchJson("/api/auth/signup", { method: "POST", body: JSON.stringify({ email: signupForm.email.trim(), password: signupForm.password, displayName: signupForm.fullName.trim() }) });
      if (data?.requiresVerification) {
        setSigninForm((prev) => ({ ...prev, email: signupForm.email.trim() }));
        redirectToFullVerification(signupForm.email.trim());
        return;
      }
      const me = await zeninFetchJson("/api/auth/me");
      if (!me?.authenticated || !me?.user) throw new Error("Signed up but Zenin could not start your workspace session.");
      redirectToApp();
    } catch (err) {
      setError(getAuthErrorMessage(err, "Failed to create account"));
    } finally {
      setLoading(false);
    }
  };

  const onOAuthStart = async (provider) => {
    setLoading(true);
    setError("");
    try {
      const returnTo = getRedirectUrl("/auth?mode=signin");
      await import("../utils/backendOAuth").then(({ startOAuth }) => startOAuth(provider, { returnTo }));
    } catch (err) {
      setError(getAuthErrorMessage(err, "OAuth failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!isValidEmail(forgotForm.email)) throw new Error("Enter a valid email address.");
      await zeninFetchJson("/api/auth/forgot-password/request", { method: "POST", body: JSON.stringify({ email: forgotForm.email.trim() }) });
      setMode("forgot_success");
    } catch (err) {
      setError(getAuthErrorMessage(err, "Failed to send reset link"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-v3-drawer-overlay">
      <div className="auth-v2-card auth-v2-modal-card">
        <button 
          onClick={onClose}
          className="auth-v2-close-btn"
          aria-label="Close"
        >
          &times;
        </button>

        <div className="auth-v2-logo">
          <ZeninLogo size="md" />
        </div>

        {mode === "signup" && (
          <form className="auth-v2-modal-form" onSubmit={handleSignup}>
            <h1 style={{ textAlign: 'center' }}>Create account</h1>
            <p className="auth-v2-subtitle" style={{ textAlign: 'center' }}>Get started with Zenin Capital for free.</p>
            
            <label className="auth-v2-label" htmlFor="signup-fullname">Full Name</label>
            <input 
              className="auth-v2-input"
              id="signup-fullname"
              placeholder="John Doe"
              value={signupForm.fullName}
              onChange={e => setSignupForm({...signupForm, fullName: e.target.value})}
              required
            />

            <label className="auth-v2-label" htmlFor="signup-email">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
              id="signup-email"
              placeholder="name@company.com"
              value={signupForm.email}
              onChange={e => setSignupForm({...signupForm, email: e.target.value})}
              required
            />

            <label className="auth-v2-label" htmlFor="signup-password">Password</label>
            <input 
              className="auth-v2-input"
              type="password"
              id="signup-password"
              placeholder="10+ chars, number, symbol"
              value={signupForm.password}
              onChange={e => setSignupForm({...signupForm, password: e.target.value})}
              required
            />

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%' }}>
              {loading ? "Creating account..." : "Create account"}
            </button>

            <div className="auth-v2-divider"><span>OR</span></div>
            
            <button 
              className="auth-v2-btn auth-v2-btn-ghost" 
              type="button"
              style={{ width: '100%' }}
              onClick={handleGuestEntry}
            >
              Use as Guest
            </button>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center' }}>
              Already have an account? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signin")}>Sign in</button>
            </p>
          </form>
        )}

        {mode === "signin" && (
          <form className="auth-v2-modal-form" onSubmit={handleSignin}>
            <h1 style={{ textAlign: 'center' }}>Sign in</h1>
            <p className="auth-v2-subtitle" style={{ textAlign: 'center' }}>Welcome back to Zenin Capital.</p>

            <label className="auth-v2-label" htmlFor="signin-email">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
              id="signin-email"
              placeholder="name@company.com"
              value={signinForm.email}
              onChange={e => setSigninForm({...signinForm, email: e.target.value})}
              required
            />

            <div className="auth-v2-modal-forgot-row">
              <label className="auth-v2-label" htmlFor="signin-password">Password</label>
              <button type="button" className="auth-v2-link-btn auth-v2-modal-forgot-link" onClick={() => setMode("forgot")}>Forgot password?</button>
            </div>
            <input 
              className="auth-v2-input"
              type="password"
              id="signin-password"
              placeholder="••••••••"
              value={signinForm.password}
              onChange={e => setSigninForm({...signinForm, password: e.target.value})}
              required
            />

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%' }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>

            <div className="auth-v2-divider"><span>OR</span></div>

            <button 
              className="auth-v2-btn auth-v2-btn-ghost" 
              type="button"
              style={{ width: '100%' }}
              onClick={handleGuestEntry}
            >
              Use as Guest
            </button>

            <div className="auth-v2-divider"><span>OR</span></div>

            <div className="auth-v2-modal-row">
              <button 
                className="auth-v2-btn auth-v2-btn-ghost" 
                type="button"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={() => onOAuthStart("google")}
                disabled={loading}
              >
                <span style={{ fontSize: '1.2rem' }}>G</span> Google
              </button>
              <button 
                className="auth-v2-btn auth-v2-btn-ghost" 
                type="button"
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                onClick={async () => {
                  setLoading(true);
                  setError("");
                  try {
                    const opts = await startSupabasePasskeyAuthentication();
                    const authResp = await startAuthentication(opts);
                    const verify = await verifySupabasePasskeyAuthentication({ response: authResp, challengeId: opts.challengeId, rememberMe: true });
                    if (verify?.success) {
                      const me = await zeninFetchJson("/api/auth/me");
                      if (!me?.authenticated || !me?.user) throw new Error("Signed in but session not established.");
                      redirectToApp();
                    } else {
                      setError(verify?.error || "Passkey sign-in failed.");
                    }
                  } catch (err) {
                    setError(err?.message || "Passkey sign-in failed");
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
              >
                Passkey
              </button>
              {ENABLE_APPLE_OAUTH ? (
                <button 
                  className="auth-v2-btn auth-v2-btn-ghost" 
                  type="button"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                  onClick={() => onOAuthStart("apple")}
                  disabled={loading}
                >
                  <span style={{ fontSize: '1.2rem' }}></span> Apple
                </button>
              ) : null}
            </div>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center' }}>
              New to Zenin Capital? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signup")}>Create account</button>
            </p>
          </form>
        )}

        {mode === "forgot" && (
          <form className="auth-v2-modal-form" onSubmit={handleForgotRequest}>
            <h1 style={{ textAlign: 'center' }}>Reset password</h1>
            <p className="auth-v2-subtitle" style={{ textAlign: 'center' }}>Enter your email and we'll send a reset link.</p>

            <label className="auth-v2-label" htmlFor="forgot-email">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
              id="forgot-email"
              placeholder="name@company.com"
              value={forgotForm.email}
              onChange={e => setForgotForm({...forgotForm, email: e.target.value})}
              required
            />

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%' }}>
              {loading ? "Sending..." : "Send reset link"}
            </button>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center' }}>
              Remembered your password? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signin")}>Back to sign in</button>
            </p>
          </form>
        )}

        {mode === "forgot_success" && (
          <div className="auth-v2-modal-form" style={{ textAlign: 'center' }}>
            <h1>Check your email</h1>
            <p className="auth-v2-subtitle">We've sent a password reset link to <strong>{forgotForm.email}</strong>.</p>
            <div className="auth-v2-mail-illustration" style={{ fontSize: '48px' }}>✉</div>
            <button className="auth-v2-btn auth-v2-btn-primary" style={{ width: '100%' }} onClick={() => setMode("signin")}>Back to sign in</button>
          </div>
        )}

        {error && <p className="auth-v2-error" style={{ marginTop: '20px', textAlign: 'center' }}>{error}</p>}
      </div>
    </div>
  );
}
