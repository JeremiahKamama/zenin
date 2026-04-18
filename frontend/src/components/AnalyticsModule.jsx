// AnalyticsModule.jsx
import React from "react";

export function AnalyticsModule({ backendUrl }) {
  return (
    <div style={{ padding: 24, color: "#e2e8f0" }}>
      <h2>Analytics placeholder</h2>
      <p>backendUrl: {backendUrl}</p>
      <p>If you see this, the Analytics section is wired correctly.</p>
    </div>
  );
}
