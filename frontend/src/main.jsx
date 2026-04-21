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

const entry = resolveEntry(typeof window !== "undefined" ? window.location.pathname : "/");
const RootComponent = entry === "app" ? App : entry === "auth" ? AuthPage : PublicHomepage;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
