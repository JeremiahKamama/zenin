import React, { useState, useEffect } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import { ZeninLogo } from "./Branding";

function writeStoredAuthUser(user, expiresAt = null) {
  if (user) {
    localStorage.setItem("zenin_auth_user", JSON.stringify(user));
    if (user.email) localStorage.setItem("zenin_email", user.email);
  }
  if (expiresAt) {
    localStorage.setItem("zenin_auth_expires_at", String(expiresAt));
  } else {
    localStorage.removeItem("zenin_auth_expires_at");
  }
}

function getPostAuthRedirectPath() {
  const stored = String(localStorage.getItem("zenin_post_auth_next") || "").trim();
  if (stored.startsWith("/") && !stored.startsWith("//")) {
    return stored;
  }
  return "/app";
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

/**
 * AuthModal provides a Sign In / Sign Up flow as a modal.
 * Includes a "Continue as Guest" option.
 */
export default function AuthModal({ isOpen, initialMode = "signup", onClose }) {
  const [mode, setMode] = useState(initialMode); // 'signin', 'signup', 'forgot', 'forgot_success'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Forms
  const [signinForm, setSigninForm] = useState({ email: "", password: "" });
  const [signupForm, setSignupForm] = useState({ email: "", password: "", fullName: "" });
  const [forgotForm, setForgotForm] = useState({ email: "" });

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setError("");
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const redirectToApp = () => {
    const target = getPostAuthRedirectPath();
    localStorage.removeItem("zenin_post_auth_next");
    window.location.href = target;
  };

  const handleSignin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await zeninFetch("/auth/signin", {
        method: "POST",
        body: JSON.stringify(signinForm),
      });
      const data = await readJson(res);
      writeStoredAuthUser(data?.user, data?.expiresAt || null);
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
      const res = await zeninFetch("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: signupForm.email,
          password: signupForm.password,
          displayName: signupForm.fullName
        }),
      });
      const data = await readJson(res);
      writeStoredAuthUser(data?.user, data?.expiresAt || null);
      redirectToApp();
    } catch (err) {
      setError(err.message || "Failed to create account");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotRequest = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await zeninFetch("/auth/forgot-password/request", {
        method: "POST",
        body: JSON.stringify(forgotForm),
      });
      await readJson(res);
      setMode("forgot_success");
    } catch (err) {
      setError(err.message || "Failed to send reset link");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-v3-drawer-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)' }}>
      <div className="auth-v2-card" style={{ width: 'min(480px, 95vw)', position: 'relative', maxHeight: '90vh', overflowY: 'auto', padding: '40px' }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--muted)',
            width: '32px',
            height: '32px',
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

        <div className="auth-v2-logo" style={{ marginBottom: '32px', display: 'flex', justifyContent: 'center' }}>
          <ZeninLogo size="md" />
        </div>

        {mode === "signup" && (
          <form onSubmit={handleSignup}>
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
              placeholder="Min 8 characters"
              value={signupForm.password}
              onChange={e => setSignupForm({...signupForm, password: e.target.value})}
              required
            />

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%', marginTop: '12px' }}>
              {loading ? "Creating account..." : "Create account"}
            </button>

            <div className="auth-v2-divider"><span>OR</span></div>
            
            <button 
              className="auth-v2-btn auth-v2-btn-ghost" 
              type="button"
              style={{ width: '100%' }}
              onClick={() => window.location.href = "/app"}
            >
              Use as Guest
            </button>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center', marginTop: '24px' }}>
              Already have an account? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signin")}>Sign in</button>
            </p>
          </form>
        )}

        {mode === "signin" && (
          <form onSubmit={handleSignin}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <label className="auth-v2-label">Password</label>
              <button type="button" className="auth-v2-link-btn" style={{ marginBottom: '10px', fontSize: '0.8rem' }} onClick={() => setMode("forgot")}>Forgot password?</button>
            </div>
            <input 
              className="auth-v2-input"
              type="password"
              placeholder="••••••••"
              value={signinForm.password}
              onChange={e => setSigninForm({...signinForm, password: e.target.value})}
              required
            />

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%', marginTop: '12px' }}>
              {loading ? "Signing in..." : "Sign in"}
            </button>

            <div className="auth-v2-divider"><span>OR</span></div>

            <button 
              className="auth-v2-btn auth-v2-btn-ghost" 
              type="button"
              style={{ width: '100%' }}
              onClick={() => window.location.href = "/app"}
            >
              Use as Guest
            </button>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center', marginTop: '24px' }}>
              New to Zenin Capital? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signup")}>Create account</button>
            </p>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={handleForgotRequest}>
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

            <button className="auth-v2-btn auth-v2-btn-primary" disabled={loading} type="submit" style={{ width: '100%', marginTop: '12px' }}>
              {loading ? "Sending..." : "Send reset link"}
            </button>

            <p className="auth-v2-bottom-link" style={{ textAlign: 'center', marginTop: '24px' }}>
              Remembered your password? <button type="button" className="auth-v2-link-btn" onClick={() => setMode("signin")}>Back to sign in</button>
            </p>
          </form>
        )}

        {mode === "forgot_success" && (
          <div style={{ textAlign: 'center' }}>
            <h1>Check your email</h1>
            <p className="auth-v2-subtitle">We've sent a password reset link to <strong>{forgotForm.email}</strong>.</p>
            <div className="auth-v2-mail-illustration" style={{ fontSize: '48px', margin: '24px 0' }}>✉</div>
            <button className="auth-v2-btn auth-v2-btn-primary" style={{ width: '100%' }} onClick={() => setMode("signin")}>Back to sign in</button>
          </div>
        )}

        {error && <p className="auth-v2-error" style={{ marginTop: '20px', textAlign: 'center' }}>{error}</p>}
      </div>
    </div>
  );
}
