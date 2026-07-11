// Sentry must initialize before React/ReactDOM so the tracing + React error
// integrations attach to the correct globals. The module self-initializes on
// import (no-op when VITE_SENTRY_FRONTEND_DSN is unset).
import "./sentry";
import {
  addBreadcrumb,
  reportChunkLoadFailure,
  isChunkLoadError
} from "./sentry";

// Tailwind v4 entry — must load once, before any component renders. Aliases
// the Zenin token system into Tailwind's @theme namespace.
import "./index.css";
import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { GenericErrorBoundary } from "./components/ErrorBoundary";

function resolveEntry(pathname) {
  if (typeof window !== "undefined" && window.__ZENIN_ENTRY__) {
    return window.__ZENIN_ENTRY__;
  }
  const path = String(pathname || "/").toLowerCase();
  if (path.startsWith("/app")) return "app";
  if (path.startsWith("/onboarding")) return "app";
  if (path.startsWith("/auth")) return "auth";
  if (path.startsWith("/terms")) return "terms";
  if (path.startsWith("/privacy")) return "privacy";
  return "public";
}

const entry = resolveEntry(typeof window !== "undefined" ? window.location.pathname : "/");

async function loadEntryComponent(currentEntry) {
  // Record the route transition so Sentry replays/traces show entry navigation.
  addBreadcrumb({
    category: "navigation",
    type: "navigation",
    message: `entry:${currentEntry}`,
    data: { entry: currentEntry }
  });
  try {
    if (currentEntry === "app") {
      const mod = await import("./App");
      return mod.default;
    }
    if (currentEntry === "auth") {
      const mod = await import("./AuthPage");
      return mod.default;
    }
    if (currentEntry === "terms") {
      const mod = await import("./LegalPage");
      return (props) => <mod.default {...props} type="terms" />;
    }
    if (currentEntry === "privacy") {
      const mod = await import("./LegalPage");
      return (props) => <mod.default {...props} type="privacy" />;
    }
    const mod = await import("./PublicHomepage");
    return mod.default;
  } catch (err) {
    console.error("Critical entry component load failure:", err);
    // Chunk/dynamic-import failures usually mean a new deploy invalidated the
    // cached bundle. Tag distinctly so the UI can prompt a reload, and surface
    // a recovery path instead of leaving the user on a blank screen.
    if (isChunkLoadError(err)) {
      reportChunkLoadFailure(err, currentEntry);
      if (typeof window !== "undefined") {
        // Force a reload once to pick up the freshly deployed bundle. Guarded
        // by a session flag so we don't reload-loop if the new build is also
        // broken.
        try {
          if (!window.sessionStorage.getItem("zenin_chunk_reload")) {
            window.sessionStorage.setItem("zenin_chunk_reload", "1");
            window.location.reload();
            return () => null; // render nothing while reloading
          }
          window.sessionStorage.removeItem("zenin_chunk_reload");
        } catch {}
      }
    }
    throw err;
  }
}

function applyGlobalTheme() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return;
  const saved = String(localStorage.getItem("zenin_global_theme") || "").trim().toLowerCase();
  const isLight = saved === "light";
  root.classList.toggle("light-theme-active", isLight);
  body.classList.toggle("light-theme-active", isLight);
  root.classList.toggle("page-dark-theme", !isLight);
  body.classList.toggle("page-dark-theme", !isLight);
  root.style.colorScheme = isLight ? "light" : "dark";
  body.style.colorScheme = isLight ? "light" : "dark";
}

applyGlobalTheme();

const rootElement = document.getElementById("root");
const hasPrerenderedMarkup =
  entry === "public" &&
  rootElement?.dataset?.prerendered === "public";

loadEntryComponent(entry).then((RootComponent) => {
  const app = (
    <React.StrictMode>
      <GenericErrorBoundary>
        <RootComponent />
      </GenericErrorBoundary>
    </React.StrictMode>
  );

  if (hasPrerenderedMarkup) {
    hydrateRoot(rootElement, app);
    return;
  }

  createRoot(rootElement).render(app);
}).catch(err => {
  console.error("Fatal startup error:", err);
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 2rem; color: var(--color-danger); font-family: system-ui, sans-serif;">
        <h1 style="font-size: 1.5rem;">Zenin failed to start</h1>
        <p style="color: var(--color-text-muted);">${err.message || "Unknown initialization error"}</p>
        <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: var(--color-danger); color: var(--color-text-inverse); border: none; border-radius: 6px; cursor: pointer;">
          Retry Loading
        </button>
      </div>
    `;
  }
});
