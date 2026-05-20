import React, { useState, useEffect } from "react";
import { ZeninLogo } from "./Branding";
import { clearPostAuthRedirect, getGuestWorkspacePath, getPostAuthRedirectPath, storePostAuthRedirect } from "../utils/authRedirect";
import {
  ensureZeninSessionFromSupabase,
  getSupabaseClient,
  isSupabaseConfigured,
  subscribeToSupabaseAuth
} from "../utils/supabaseAuth";

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
    const target = getPostAuthRedirectPath();
    clearPostAuthRedirect();
    window.location.href = target;
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
    if (!isOpen) return () => {};
    const unsubscribe = subscribeToSupabaseAuth(async (event, session) => {
      if (event === "SIGNED_IN" && session) {
        const exchanged = await ensureZeninSessionFromSupabase({ rememberMe: true });
        if (exchanged?.user) {
          redirectToApp();
        }
      }
    });
    return unsubscribe;
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
      const exchanged = await ensureZeninSessionFromSupabase({ rememberMe: true });
      if (!exchanged?.user) {
        throw new Error("Signed in successfully, but Zenin could not start your workspace session.");
      }
      redirectToApp();
    } catch (err) {
      setError(err.message || "Failed to sign in");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
      if (!signupForm.fullName.trim()) throw new Error("Enter your full name.");
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
            display_name: signupForm.fullName.trim()
          }
        }
      });
      if (authError) throw authError;
      if (data.session?.access_token) {
        const exchanged = await ensureZeninSessionFromSupabase({ rememberMe: true });
        if (exchanged?.user) {
          redirectToApp();
          return;
        }
      }
      setSigninForm((prev) => ({ ...prev, email: signupForm.email.trim() }));
      setMode("signin");
    } catch (err) {
      setError(err.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  const onOAuthStart = async (provider) => {
    setLoading(true);
    setError("");
    try {
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
        window.location.assign(data.url);
        return;
      }
      throw new Error("Google sign-in could not start. Try again.");
    } catch (err) {
      setError(err.message || "OAuth failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (!isSupabaseConfigured()) throw new Error("Authentication is not configured for this frontend.");
      if (!isValidEmail(forgotForm.email)) throw new Error("Enter a valid email address.");
      const client = getSupabaseClient();
      const { error: authError } = await client.auth.resetPasswordForEmail(forgotForm.email.trim(), {
        redirectTo: getRedirectUrl("/auth?mode=forgot&reset=1")
      });
      if (authError) throw authError;
      setMode("forgot_success");
    } catch (err) {
      setError(err.message || "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-v3-drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', padding: '16px' }}>
      <div className="auth-v2-card auth-v2-modal-card" style={{ width: 'min(420px, 100%)', position: 'relative' }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--muted)',
            width: '30px',
            height: '30px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 10
          }}
        >
          &times;
        </button>

        <div className="auth-v2-logo" style={{ display: 'flex', justifyContent: 'center' }}>
          <ZeninLogo size="md" />
        </div>

        {mode === "signup" && (
          <form className="auth-v2-modal-form" onSubmit={handleSignup}>
            <h1 style={{ textAlign: 'center' }}>Create account</h1>
            <p className="auth-v2-subtitle" style={{ textAlign: 'center' }}>Get started with Zenin Capital for free.</p>
            
            <label className="auth-v2-label">Full Name</label>
            <input 
              className="auth-v2-input"
              placeholder="John Doe"
              value={signupForm.fullName}
              onChange={e => setSignupForm({...signupForm, fullName: e.target.value})}
              required
            />

            <label className="auth-v2-label">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
              placeholder="name@company.com"
              value={signupForm.email}
              onChange={e => setSignupForm({...signupForm, email: e.target.value})}
              required
            />

            <label className="auth-v2-label">Password</label>
            <input 
              className="auth-v2-input"
              type="password"
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
              Already have an account? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signin")}>Sign in</button>
            </p>
          </form>
        )}

        {mode === "signin" && (
          <form className="auth-v2-modal-form" onSubmit={handleSignin}>
            <h1 style={{ textAlign: 'center' }}>Sign in</h1>
            <p className="auth-v2-subtitle" style={{ textAlign: 'center' }}>Welcome back to Zenin Capital.</p>

            <label className="auth-v2-label">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
              placeholder="name@company.com"
              value={signinForm.email}
              onChange={e => setSigninForm({...signinForm, email: e.target.value})}
              required
            />

            <div className="auth-v2-modal-forgot-row">
              <label className="auth-v2-label">Password</label>
              <button type="button" className="auth-v2-link-btn auth-v2-modal-forgot-link" onClick={() => setMode("forgot")}>Forgot password?</button>
            </div>
            <input 
              className="auth-v2-input"
              type="password"
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

            <label className="auth-v2-label">Email address</label>
            <input 
              className="auth-v2-input"
              type="email"
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
