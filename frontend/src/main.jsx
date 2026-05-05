import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { GenericErrorBoundary } from "./components/ErrorBoundary";

function resolveEntry(pathname) {
  if (typeof window !== "undefined" && window.__ZENIN_ENTRY__) {
    return window.__ZENIN_ENTRY__;
  }
  const path = String(pathname || "/").toLowerCase();
  if (path.startsWith("/app")) return "app";
  if (path.startsWith("/auth")) return "auth";
  return "public";
}

function redirectUnauthenticatedAppEntry(entry) {
  // Bypassed for now to allow Guest access without sign-up
  return;
}

const entry = resolveEntry(typeof window !== "undefined" ? window.location.pathname : "/");
redirectUnauthenticatedAppEntry(entry);

async function loadEntryComponent(currentEntry) {
  try {
    if (currentEntry === "app") {
      const mod = await import("./App");
      return mod.default;
    }
    if (currentEntry === "auth") {
      const mod = await import("./AuthPage");
      return mod.default;
    }
    const mod = await import("./PublicHomepage");
    return mod.default;
  } catch (err) {
    console.error("Critical entry component load failure:", err);
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
const hasPrerenderedMarkup = entry === "public" && Boolean(rootElement?.hasChildNodes());

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
      <div style="padding: 2rem; color: #ef4444; font-family: system-ui, sans-serif;">
        <h1 style="font-size: 1.5rem;">Zenin failed to start</h1>
        <p style="color: #94a3b8;">${err.message || "Unknown initialization error"}</p>
        <button onclick="window.location.reload()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer;">
          Retry Loading
        </button>
      </div>
    `;
  }
});
