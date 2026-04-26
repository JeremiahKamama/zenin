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
  if (typeof window === "undefined" || entry !== "app") return;
  const token = String(sessionStorage.getItem("zenin_auth_token") || localStorage.getItem("zenin_auth_token") || "").trim();
  if (token) return;
  const nextPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safeNext = nextPath.startsWith("/app") ? nextPath : "/app";
  localStorage.setItem("zenin_post_auth_next", safeNext);
  window.location.replace(`/auth?mode=signin&next=${encodeURIComponent(safeNext)}`);
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
