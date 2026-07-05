import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { applySeo } from "./utils/seo";
import { clearPostAuthRedirect, getSignedInWorkspacePath, storePostAuthRedirect, getGuestWorkspacePath } from "./utils/authRedirect";
import { zeninFetchJson } from "./utils/zeninFetch";
import { startSupabasePasskeyAuthentication, verifySupabasePasskeyAuthentication, isSupabaseConfigured } from "./utils/backendAuth";
import { startAuthentication } from "@simplewebauthn/browser";

function getModeFromLocation() {
  if (typeof window === "undefined") return "signup";
  if (window.location.pathname.toLowerCase().startsWith("/auth/oauth/")) return "signin";
  const search = new URLSearchParams(window.location.search);
  const mode = String(search.get("mode") || "signup").toLowerCase();
  return ["signup", "signin", "forgot", "verify"].includes(mode) ? mode : "signup";
}

function getOAuthCallbackContext() {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.toLowerCase();
  if (!path.startsWith("/auth/oauth/google/callback")) return null;
  const params = new URLSearchParams(window.location.search);
  return {
    provider: "google",
    code: String(params.get("code") || "").trim(),
    state: String(params.get("state") || "").trim(),
    error: String(params.get("error") || params.get("oauthError") || "").trim()
  };
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
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const hasResetToken =
    Boolean(searchParams.get("token") || searchParams.get("t")) ||
    Boolean(hashParams.get("token") || hashParams.get("access_token"));
  const isRecoveryType =
    String(searchParams.get("type") || hashParams.get("type") || "").trim().toLowerCase() === "recovery";
  const isResetFlag = searchParams.get("reset") === "1" || hashParams.get("reset") === "1";
  return hasResetToken || isRecoveryType || isResetFlag;
}

function getAuthActionErrorMessage(error) {
  if (error?.code === "ACCOUNT_NOT_FOUND" || error?.status === 404) {
    return "No Zenin account exists for that email. Check the address, or create an account if this is your first time here.";
  }
  if (error?.code === "EMAIL_DELIVERY_FAILED" || error?.code === "EMAIL_DELIVERY_NOT_CONFIGURED") {
    return error?.message || "Zenin could not send this email. Please try again in a moment.";
  }
  if (error?.code === "VERIFICATION_CODE_STORAGE_FAILED") {
    return "Zenin could not create a fresh verification code. Please try again in a moment.";
  }
  if (error?.code === "AUTH_SERVICE_TIMEOUT" || error?.code === "REQUEST_TIMEOUT") {
    return "Zenin's auth service is still waking up. Please try again in a moment, or wait for the backend health check to recover.";
  }
  if (error?.status === 503 || error?.code === "NETWORK_ERROR" || error?.code === "REQUEST_ABORTED") {
    return "Zenin's auth service is temporarily unavailable or still waking up. Please wait a moment and try signing in again.";
  }
  return error?.message || "Authentication failed. Please try again.";
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
  const [oauthCallback, setOauthCallback] = useState(() => getOAuthCallbackContext());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [signupForm, setSignupForm] = useState({ email: "", password: "", displayName: "" });
  const [signinForm, setSigninForm] = useState({ email: "", password: "" });
  const [forgotForm, setForgotForm] = useState({ email: "", newPassword: "" });
  const [verificationForm, setVerificationForm] = useState({ code: "" });
  const [mfaForm, setMfaForm] = useState({ code: "" });
  const [visiblePasswords, setVisiblePasswords] = useState({ signup: false, signin: false, reset: false });
  const [rememberMe, setRememberMe] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(isRecoveryLinkActive);

  const redirectToApp = () => {
    const target = getSignedInWorkspacePath();
    clearPostAuthRedirect();
    window.location.replace(target);
  };

  const handleGuestEntry = () => {
    try {
      // Mark this browser as a guest full-access session so the app can
      // treat the user like a dev/full-access user without backend auth.
      localStorage.setItem("zenin_guest_full_access", "1");
    } catch {}
    const guestTarget = new URL(getGuestWorkspacePath(), window.location.origin);
    guestTarget.searchParams.set("guest", "1");
    clearPostAuthRedirect();
    window.location.replace(`${guestTarget.pathname}${guestTarget.search}${guestTarget.hash}`);
  };

  const runAction = async (action) => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (actionError) {
      setError(getAuthActionErrorMessage(actionError));
    } finally {
      setLoading(false);
    }
  };

  const shouldPromptForMfa = async () => {
    // Server-driven MFA will indicate when signin requires it.
    return false;
  };

  const finishSignedInSession = async () => {
    const me = await zeninFetchJson("/api/auth/me", { timeoutMs: 3500 });
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
    if (oauthCallback) return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    if (next) {
      storePostAuthRedirect(next, "/app");
    }
    const email = String(params.get("email") || "").trim().toLowerCase();
    if (email && isValidEmail(email)) {
      setSigninForm((prev) => ({ ...prev, email }));
      setForgotForm((prev) => ({ ...prev, email }));
    }
    const incomingError = String(params.get("error") || params.get("oauthError") || "").trim();
    if (incomingError) {
      setError(incomingError);
    }
    if (isRecoveryLinkActive()) {
      setRecoveryReady(true);
      setMode("forgot");
    }
  }, [oauthCallback]);

  useEffect(() => {
    if (!oauthCallback) return;
    let mounted = true;
    setLoading(true);
    setError("");
    setMessage("Finishing Google sign-in...");

    (async () => {
      try {
        if (oauthCallback.error) {
          throw new Error(oauthCallback.error);
        }
        if (!oauthCallback.code || !oauthCallback.state) {
          throw new Error("Google sign-in did not return the required callback parameters.");
        }
        const result = await zeninFetchJson("/api/auth/oauth/google/exchange", {
          method: "POST",
          body: JSON.stringify({ code: oauthCallback.code, state: oauthCallback.state }),
          timeoutMs: 15000
        });
        if (!mounted) return;
        const target = result?.returnTo || getSignedInWorkspacePath();
        clearPostAuthRedirect();
        window.location.replace(target);
      } catch (callbackError) {
        if (!mounted) return;
        setError(getAuthActionErrorMessage(callbackError));
        setMessage("Google redirected back to Zenin, but the backend could not finish the session.");
        setLoading(false);
        const url = new URL(window.location.href);
        url.pathname = "/auth";
        url.search = "?mode=signin";
        window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        setOauthCallback(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [oauthCallback]);

  useEffect(() => {
    // No client-side Supabase listener; handle recovery and sign-in via URL and backend session checks.
  }, [rememberMe]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (oauthCallback) return;
      if (!mounted) return;
      try {
        const me = await zeninFetchJson("/api/auth/me", { timeoutMs: 3500 });
        if (mounted && me?.authenticated && !isRecoveryLinkActive()) {
          redirectToApp();
        }
      } catch (err) {
        // Keep background session probes quiet. Explicit sign-in, sign-up, and
        // OAuth actions surface backend wake/failure states through runAction.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [oauthCallback]);

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
      updateMode("verify");
      setSigninForm((prev) => ({ ...prev, email: signupForm.email.trim() }));
      setMessage(data?.verificationEmailSent === false
        ? "Account created, but Zenin could not send the verification email. Try requesting a new code in a moment or contact support."
        : "Check your inbox for the 6-digit verification code.");
      return;
    }
    await finishSignedInSession();
  });

  const onSignIn = () => runAction(async () => {
    if (!isValidEmail(signinForm.email)) throw new Error("Enter a valid email address.");
    if (!signinForm.password.trim()) throw new Error("Enter your password.");
    const payload = { email: signinForm.email.trim(), password: signinForm.password, rememberMe };
    const data = await zeninFetchJson("/api/auth/signin", { method: "POST", body: JSON.stringify(payload) });
    if (data?.requiresVerification) {
      updateMode("verify");
      setMessage(data?.message || "Verify your email before opening your workspace.");
      return;
    }
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

  const onVerifyEmail = () => runAction(async () => {
    const code = String(verificationForm.code || "").trim();
    if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit verification code.");
    await zeninFetchJson("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ code }) });
    setMessage("Email verified. Opening your workspace...");
    await finishSignedInSession();
  });

  const onResendVerification = () => runAction(async () => {
    const data = await zeninFetchJson("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({}) });
    const devCode = data?.devVerificationCode ? ` Dev code: ${data.devVerificationCode}.` : "";
    setMessage(data?.verificationEmailSent === false
      ? `Zenin created a new code, but email delivery is not configured or failed.${devCode}`
      : `A new verification code was sent.${devCode}`);
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
    const params = new URLSearchParams(window.location.search);
    const next = String(params.get("next") || "/app").trim();
    const returnTo = next.startsWith("/") && !next.startsWith("//") ? next : "/app";
    await import("./utils/backendOAuth").then(({ startOAuth }) => startOAuth(provider, { returnTo }));
  });

  const onPasskeySignIn = () => runAction(async () => {
    const opts = await startSupabasePasskeyAuthentication();
    const attResp = await startAuthentication(opts);
    const verify = await verifySupabasePasskeyAuthentication({ response: attResp, challengeId: opts.challengeId, rememberMe });
    if (!verify?.success) {
      throw new Error(verify?.error || "Passkey sign-in failed.");
    }
    await finishSignedInSession();
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
    <div className="min-h-screen flex flex-col relative bg-[var(--color-bg-base)] font-sans text-[var(--color-text-secondary)]">
      <main className="flex-1 flex items-center justify-center relative z-10 p-6">
        <section className="w-full max-w-[400px] flex flex-col bg-[var(--color-surface-card)] backdrop-blur-xl border border-[var(--color-border-medium)] rounded-2xl p-8 shadow-2xl relative mx-auto my-auto">
          <button className="absolute top-6 left-6 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors bg-transparent border-none cursor-pointer flex items-center gap-2" onClick={() => { window.location.href = "/"; }}>
            <span>←</span> Back to home
          </button>

          {mode === "signup" ? (
            <>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 text-center">Create your workspace</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed text-center">Secure sign-in, email confirmation, and recovery for Zenin Capital.</p>

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="signup-name">Display name</label>
              <input
                id="signup-name"
                className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                value={signupForm.displayName}
                onChange={(e) => setSignupForm((prev) => ({ ...prev, displayName: e.target.value }))}
                placeholder="Your name"
                autoComplete="name"
              />

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="signup-email">Email address</label>
              <input
                id="signup-email"
                className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                type="email"
                value={signupForm.email}
                onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="signup-password">Password</label>
              <div className="relative flex items-center w-full">
                <input
                  id="signup-password"
                  className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                  type={visiblePasswords.signup ? "text" : "password"}
                  value={signupForm.password}
                  onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Create a strong password"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="absolute right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-1"
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

              <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading} onClick={onSignUp}>
                {loading ? "Creating account..." : "Create account"}
              </button>

              <div style={{ height: 12 }} />
              <button 
                className={cn(buttonVariants({ variant: "outline" }), "w-full")} 
                type="button"
                style={{ width: '100%' }}
                onClick={handleGuestEntry}
              >
                Continue as Guest
              </button>

              <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">Already have an account? <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("signin")}>Sign in</button></p>
            </>
          ) : null}

          {mode === "signin" ? (
            <>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 text-center">Sign in</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed text-center">Continue to your Zenin workspace with secure authentication.</p>

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="signin-email">Email address</label>
              <input
                id="signin-email"
                className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                type="email"
                value={signinForm.email}
                onChange={(e) => setSigninForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="you@example.com"
                autoComplete="email"
              />

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="signin-password">Password</label>
              <div className="relative flex items-center w-full">
                <input
                  id="signin-password"
                  className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                  type={visiblePasswords.signin ? "text" : "password"}
                  value={signinForm.password}
                  onChange={(e) => setSigninForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="absolute right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-1"
                  onClick={() => togglePasswordVisibility("signin")}
                  aria-label={visiblePasswords.signin ? "Hide password" : "Show password"}
                  title={visiblePasswords.signin ? "Hide password" : "Show password"}
                >
                  {visiblePasswords.signin ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              <div className="flex items-center justify-between mt-4 mb-6 text-sm">
                <label className="flex items-center gap-2 text-[var(--color-text-secondary)] cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span>Keep this device signed in</span>
                </label>
                <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("forgot")}>Forgot password?</button>
              </div>

              <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading} onClick={onSignIn}>
                {loading ? "Signing in..." : "Sign in"}
              </button>

              <div style={{ height: 12 }} />
              <button 
                className={cn(buttonVariants({ variant: "outline" }), "w-full")} 
                type="button"
                style={{ width: '100%' }}
                onClick={handleGuestEntry}
              >
                Continue as Guest
              </button>

              <div className="flex items-center text-xs text-[var(--color-text-dim)] my-6 uppercase tracking-wider before:content-[''] before:flex-1 before:border-t before:border-[var(--color-border-medium)] before:mr-4 after:content-[''] after:flex-1 after:border-t after:border-[var(--color-border-medium)] after:ml-4">Or continue with</div>
              <div className="flex flex-col gap-3">
                <button className={cn(buttonVariants({ variant: "outline" }), "w-full flex items-center gap-2")} disabled={loading} onClick={() => onOAuth("google")}>
                  Continue with Google
                </button>
                <button className={cn(buttonVariants({ variant: "outline" }), "w-full")} disabled={loading} onClick={onPasskeySignIn}>
                  Sign in with Passkey
                </button>
              </div>

              <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">Need an account? <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("signup")}>Create one</button></p>
            </>
          ) : null}

          {mode === "verify" ? (
            <>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 text-center">Verify your email</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed text-center">
                Enter the 6-digit code Zenin sent to {signinForm.email ? <strong>{signinForm.email}</strong> : "your inbox"}.
              </p>

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="verification-code">Verification code</label>
              <input
                id="verification-code"
                className="flex h-12 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all text-center tracking-[0.5em] font-mono text-xl"
                type="text"
                inputMode="numeric"
                value={verificationForm.code}
                onChange={(e) => setVerificationForm({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                placeholder="6-digit code"
                autoComplete="one-time-code"
              />

              <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading || !/^\d{6}$/.test(verificationForm.code)} onClick={onVerifyEmail}>
                {loading ? "Verifying..." : "Verify and continue"}
              </button>

              <button className={cn(buttonVariants({ variant: "ghost" }), "w-full mt-2")} disabled={loading} onClick={onResendVerification}>
                Resend code
              </button>

              <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
                Need another account? <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("signin")}>Back to sign in</button>
              </p>
            </>
          ) : null}

          {mode === "forgot" ? (
            <>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 text-center">{recoveryReady ? "Set a new password" : "Reset password"}</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed text-center">
                {recoveryReady
                  ? "Choose a new password for your Zenin account."
                  : "Send a recovery link to your email, then return here to complete the reset."}
              </p>

              {!recoveryReady ? (
                <>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="forgot-email">Email address</label>
                  <input
                    id="forgot-email"
                    className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                    type="email"
                    value={forgotForm.email}
                    onChange={(e) => setForgotForm((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />

                  <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading} onClick={onForgotRequest}>
                    {loading ? "Sending..." : "Send reset link"}
                  </button>
                </>
              ) : (
                <>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="reset-password">New password</label>
                  <div className="relative flex items-center w-full">
                    <input
                      id="reset-password"
                      className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                      type={visiblePasswords.reset ? "text" : "password"}
                      value={forgotForm.newPassword}
                      onChange={(e) => setForgotForm((prev) => ({ ...prev, newPassword: e.target.value }))}
                      placeholder="Enter a new password"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] bg-transparent border-none cursor-pointer p-1"
                      onClick={() => togglePasswordVisibility("reset")}
                      aria-label={visiblePasswords.reset ? "Hide password" : "Show password"}
                      title={visiblePasswords.reset ? "Hide password" : "Show password"}
                    >
                      {visiblePasswords.reset ? <EyeOffIcon /> : <EyeIcon />}
                    </button>
                  </div>

                  <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading} onClick={onResetPassword}>
                    {loading ? "Updating..." : "Update password"}
                  </button>
                </>
              )}

              <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">Back to <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("signin")}>sign in</button></p>
            </>
          ) : null}

          {mode === "mfa" ? (
            <>
              <h1 className="text-2xl font-semibold text-[var(--color-text-primary)] tracking-tight mb-2 text-center">Verify it is you</h1>
              <p className="text-sm text-[var(--color-text-muted)] mb-6 leading-relaxed text-center">This account has authenticator app MFA enabled.</p>

              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 mt-4" htmlFor="mfa-code">Authenticator code</label>
              <input
                id="mfa-code"
                className="flex h-10 w-full rounded-md border border-[var(--color-border-medium)] bg-[var(--color-surface-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--color-focus)] focus:border-transparent transition-all"
                type="text"
                inputMode="numeric"
                value={mfaForm.code}
                onChange={(e) => setMfaForm({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                placeholder="6-digit code"
                autoComplete="one-time-code"
              />

              <button className={cn(buttonVariants({ variant: "default" }), "w-full mt-2")} disabled={loading || !/^\d{6}$/.test(mfaForm.code)} onClick={onVerifyMfa}>
                {loading ? "Verifying..." : "Verify and continue"}
              </button>

              <p className="mt-8 text-center text-sm text-[var(--color-text-muted)]">
                Need to use another account? <button className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors underline decoration-[var(--color-border-medium)] underline-offset-4 bg-transparent border-none cursor-pointer text-sm p-0" onClick={() => updateMode("signin")}>Back to sign in</button>
              </p>
            </>
          ) : null}

          {error ? <p className="mt-4 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-md text-[var(--color-danger)] text-sm">{error}</p> : null}
          {message ? <p className="mt-4 p-3 bg-[rgba(16,185,129,0.1)] border border-[rgba(16,185,129,0.3)] rounded-md text-[var(--color-success)] text-sm">✓ {message}</p> : null}
          {!isSupabaseConfigured() ? (
            <p className="mt-4 p-3 bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.3)] rounded-md text-[var(--color-danger)] text-sm">Authentication environment variables are missing on this frontend build.</p>
          ) : null}
        </section>
      </main>
      <SpeedInsights />
    </div>
  );
}
