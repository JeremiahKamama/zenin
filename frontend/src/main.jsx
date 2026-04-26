import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import AuthPage from "./AuthPage";
import PublicHomepage from "./PublicHomepage";
import "./styles.css";
import "./public.css";

function resolveEntry(pathname) {
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
const RootComponent = entry === "app" ? App : entry === "auth" ? AuthPage : PublicHomepage;

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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
