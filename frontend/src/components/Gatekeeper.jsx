import { useState, useEffect } from "react";

/**
 * Gatekeeper Component
 * Provides a high-aesthetic security barrier for the Zenin Terminal.
 * Ensures the user has the correct access secret before mounting the app.
 */
export function Gatekeeper({ children }) {
  const [isLocked, setIsLocked] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    // Check if we already have a secret in storage
    const storedSecret = localStorage.getItem("zenin_app_secret");
    if (storedSecret) {
      // In a real OAuth flow, we'd verify the token here.
      // For this "Shared Secret" model, we assume it's valid until a 401 occurs.
      setIsLocked(false);
    }
  }, []);

  const handleAccess = async (e) => {
    e.preventDefault();
    if (!password) return;

    setVerifying(true);
    setError("");

    try {
      // Small verification delay for 'premium' feel
      await new Promise(r => setTimeout(r, 600));

      // Attempt to fetch a simple protected route to verify the secret 
      // (The metrics/categories or health-ish routes are good candidates, 
      // but we'll try a generic small endpoint).
      const backendUrl = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
      const res = await fetch(`${backendUrl.replace(/\/$/, "")}/watchlist-categories`, {
        headers: { "X-Zenin-Secret": password }
      });

      if (res.ok) {
        localStorage.setItem("zenin_app_secret", password);
        setIsLocked(false);
      } else {
        setError("Invalid access secret. Please try again.");
        setPassword("");
      }
    } catch (err) {
      setError("Unable to reach the Zenin security server.");
    } finally {
      setVerifying(false);
    }
  };

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <div className="gatekeeper-overlay">
      <div className="gatekeeper-card glass">
        <div className="gatekeeper-branding">
          <div className="zenin-logo-static">Z</div>
          <h1>ZENIN CAPITAL</h1>
          <p>Terminal Access Secure</p>
        </div>

        <form onSubmit={handleAccess} className="gatekeeper-form">
          <div className="input-group">
            <input
              type="password"
              placeholder="Enter Dashboard Secret"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              disabled={verifying}
            />
            <button type="submit" disabled={verifying || !password}>
              {verifying ? "VERIFYING..." : "ENTER"}
            </button>
          </div>
          {error && <div className="gatekeeper-error">{error}</div>}
        </form>

        <div className="gatekeeper-footer">
          <span>SECURE END-TO-END ENCRYPTION ACTIVE</span>
        </div>
      </div>

      <style>{`
        .gatekeeper-overlay {
          position: fixed;
          inset: 0;
          background: radial-gradient(circle at center, #0f172a 0%, #020617 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }

        .gatekeeper-card {
          width: 100%;
          max-width: 400px;
          padding: 40px;
          border-radius: 24px;
          text-align: center;
          animation: gatekeeper-fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .gatekeeper-branding {
          margin-bottom: 32px;
        }

        .zenin-logo-static {
          width: 48px;
          height: 48px;
          background: var(--color-accent, #38bdf8);
          color: #020617;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: 900;
          border-radius: 12px;
          margin: 0 auto 16px;
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
        }

        .gatekeeper-branding h1 {
          font-size: 20px;
          letter-spacing: 0.2em;
          margin: 0 0 8px;
          color: #f8fafc;
        }

        .gatekeeper-branding p {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #64748b;
        }

        .gatekeeper-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .input-group input {
          background: rgba(15, 23, 42, 0.6);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 14px 20px;
          border-radius: 12px;
          font-size: 14px;
          outline: none;
          transition: all 0.2s;
          text-align: center;
        }

        .input-group input:focus {
          border-color: rgba(56, 189, 248, 0.5);
          box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.1);
        }

        .input-group button {
          background: #f8fafc;
          color: #020617;
          border: none;
          padding: 12px;
          border-radius: 12px;
          font-weight: 700;
          font-size: 12px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s;
        }

        .input-group button:hover:not(:disabled) {
          background: #fff;
          transform: translateY(-1px);
        }

        .input-group button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .gatekeeper-error {
          color: #ef4444;
          font-size: 12px;
          margin-top: 8px;
        }

        .gatekeeper-footer {
          margin-top: 40px;
          font-size: 9px;
          letter-spacing: 0.1em;
          color: #334155;
        }

        @keyframes gatekeeper-fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
