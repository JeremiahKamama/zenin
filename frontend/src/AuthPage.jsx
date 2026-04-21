import React, { useMemo, useState } from "react";
import { zeninFetch } from "./utils/zeninFetch";

const PROVIDERS = ["google", "apple", "github", "microsoft"];
const PASSKEY_PROVIDERS = ["iCloud Keychain", "Google Password Manager", "1Password", "Bitwarden"];

function getModeFromLocation() {
  if (typeof window === "undefined") return "signup";
  const search = new URLSearchParams(window.location.search);
  const mode = String(search.get("mode") || "signup").toLowerCase();
  return ["signup", "signin", "forgot"].includes(mode) ? mode : "signup";
}

function persistAuth(result) {
  if (!result?.token) return;
  localStorage.setItem("zenin_auth_token", result.token);
  localStorage.setItem("zenin_auth_expires_at", String(result.expiresAt || ""));
  if (result.user) {
    localStorage.setItem("zenin_auth_user", JSON.stringify(result.user));
    if (result.user.email) localStorage.setItem("zenin_email", result.user.email);
  }
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [signupForm, setSignupForm] = useState({ email: "", password: "", displayName: "" });
  const [signinForm, setSigninForm] = useState({ email: "", password: "", otpCode: "", passkeyId: "" });
  const [forgotForm, setForgotForm] = useState({ email: "", token: "", newPassword: "" });
  const [securityForm, setSecurityForm] = useState({ method: "authenticator", verificationCode: "", passkeyName: "Primary Device", passkeyProvider: PASSKEY_PROVIDERS[0] });

  const title = useMemo(() => {
    if (mode === "signin") return "Sign in";
    if (mode === "forgot") return "Reset your password";
    return "Create account";
  }, [mode]);

  const runAction = async (action) => {
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const onSignup = () => runAction(async () => {
    const res = await zeninFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify(signupForm)
    });
    const data = await readJson(res);
    persistAuth(data);
    window.location.href = "/app";
  });

  const onSignin = () => runAction(async () => {
    const res = await zeninFetch("/auth/signin", {
      method: "POST",
      body: JSON.stringify(signinForm)
    });
    const data = await readJson(res);
    persistAuth(data);
    window.location.href = "/app";
  });

  const onForgotRequest = () => runAction(async () => {
    const res = await zeninFetch("/auth/forgot-password/request", {
      method: "POST",
      body: JSON.stringify({ email: forgotForm.email })
    });
    const data = await readJson(res);
    const suffix = data?.devResetToken ? ` Dev token: ${data.devResetToken}` : "";
    setMessage(`${data?.message || "Reset request submitted."}${suffix}`);
  });

  const onForgotConfirm = () => runAction(async () => {
    const res = await zeninFetch("/auth/forgot-password/confirm", {
      method: "POST",
      body: JSON.stringify({ token: forgotForm.token, newPassword: forgotForm.newPassword })
    });
    const data = await readJson(res);
    persistAuth(data);
    window.location.href = "/app";
  });

  const onOAuthMock = (provider) => runAction(async () => {
    const res = await zeninFetch("/auth/oauth/mock", {
      method: "POST",
      body: JSON.stringify({ provider })
    });
    const data = await readJson(res);
    persistAuth(data);
    window.location.href = "/app";
  });

  const onEnableTwoFactor = () => runAction(async () => {
    const res = await zeninFetch("/auth/2fa/enable", {
      method: "POST",
      body: JSON.stringify({
        method: securityForm.method,
        verificationCode: securityForm.verificationCode
      })
    });
    const data = await readJson(res);
    localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
    setMessage("2FA enabled for this account.");
  });

  const onRegisterPasskey = () => runAction(async () => {
    const res = await zeninFetch("/auth/passkeys/register", {
      method: "POST",
      body: JSON.stringify({
        name: securityForm.passkeyName,
        provider: securityForm.passkeyProvider
      })
    });
    const data = await readJson(res);
    localStorage.setItem("zenin_auth_user", JSON.stringify(data.user));
    setSigninForm((prev) => ({ ...prev, passkeyId: data?.passkey?.id || prev.passkeyId }));
    setMessage(`Passkey registered (${data?.passkey?.id || "created"}).`);
  });

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <button className="auth-back" onClick={() => { window.location.href = "/"; }}>Back to homepage</button>
        <h1>{title}</h1>

        <div className="auth-switch">
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")}>Sign up</button>
          <button className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>Sign in</button>
          <button className={mode === "forgot" ? "active" : ""} onClick={() => setMode("forgot")}>Forgot password</button>
        </div>

        {mode === "signup" && (
          <div className="auth-form">
            <input placeholder="Name" value={signupForm.displayName} onChange={(e) => setSignupForm((p) => ({ ...p, displayName: e.target.value }))} />
            <input placeholder="Email" type="email" value={signupForm.email} onChange={(e) => setSignupForm((p) => ({ ...p, email: e.target.value }))} />
            <input placeholder="Password" type="password" value={signupForm.password} onChange={(e) => setSignupForm((p) => ({ ...p, password: e.target.value }))} />
            <button disabled={loading} onClick={onSignup}>Create account</button>
          </div>
        )}

        {mode === "signin" && (
          <div className="auth-form">
            <input placeholder="Email" type="email" value={signinForm.email} onChange={(e) => setSigninForm((p) => ({ ...p, email: e.target.value }))} />
            <input placeholder="Password" type="password" value={signinForm.password} onChange={(e) => setSigninForm((p) => ({ ...p, password: e.target.value }))} />
            <input placeholder="OTP code (if 2FA enabled)" value={signinForm.otpCode} onChange={(e) => setSigninForm((p) => ({ ...p, otpCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} />
            <input placeholder="Passkey ID (if passkey auth enabled)" value={signinForm.passkeyId} onChange={(e) => setSigninForm((p) => ({ ...p, passkeyId: e.target.value }))} />
            <button disabled={loading} onClick={onSignin}>Sign in</button>
            <div className="auth-divider">or continue with</div>
            <div className="oauth-grid">
              {PROVIDERS.map((provider) => (
                <button key={provider} disabled={loading} onClick={() => onOAuthMock(provider)}>
                  {provider[0].toUpperCase() + provider.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === "forgot" && (
          <div className="auth-form">
            <input placeholder="Email" type="email" value={forgotForm.email} onChange={(e) => setForgotForm((p) => ({ ...p, email: e.target.value }))} />
            <button disabled={loading} onClick={onForgotRequest}>Send reset token</button>
            <input placeholder="Reset token" value={forgotForm.token} onChange={(e) => setForgotForm((p) => ({ ...p, token: e.target.value }))} />
            <input placeholder="New password" type="password" value={forgotForm.newPassword} onChange={(e) => setForgotForm((p) => ({ ...p, newPassword: e.target.value }))} />
            <button disabled={loading} onClick={onForgotConfirm}>Reset password</button>
          </div>
        )}

        <section className="security-panel">
          <h2>2FA and passkeys</h2>
          <div className="auth-form">
            <select value={securityForm.method} onChange={(e) => setSecurityForm((p) => ({ ...p, method: e.target.value }))}>
              <option value="authenticator">Authenticator</option>
              <option value="sms">SMS OTP</option>
              <option value="email">Email OTP</option>
            </select>
            <input placeholder="Verification code" value={securityForm.verificationCode} onChange={(e) => setSecurityForm((p) => ({ ...p, verificationCode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} />
            <button disabled={loading} onClick={onEnableTwoFactor}>Enable 2FA</button>
            <input placeholder="Passkey name" value={securityForm.passkeyName} onChange={(e) => setSecurityForm((p) => ({ ...p, passkeyName: e.target.value }))} />
            <select value={securityForm.passkeyProvider} onChange={(e) => setSecurityForm((p) => ({ ...p, passkeyProvider: e.target.value }))}>
              {PASSKEY_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </select>
            <button disabled={loading} onClick={onRegisterPasskey}>Register passkey</button>
          </div>
        </section>

        {message ? <p className="auth-message">{message}</p> : null}
        {error ? <p className="auth-error">{error}</p> : null}
      </div>
    </div>
  );
}
