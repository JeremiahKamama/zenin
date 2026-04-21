import React from "react";

const CAPABILITIES = [
  "Track multi-asset portfolios with real-time market data",
  "Model options strategies and review Greeks/payoff outcomes",
  "Monitor prediction markets and whale flows",
  "Journal trades and review analytics + tax estimates"
];

function goTo(path) {
  if (typeof window !== "undefined") {
    window.location.href = path;
  }
}

export function PublicHomepage() {
  return (
    <div className="public-shell">
      <header className="public-header">
        <div className="public-brand">Zenin</div>
        <div className="public-actions">
          <button className="public-btn public-btn-ghost" onClick={() => goTo("/auth?mode=signin")}>Sign in</button>
          <button className="public-btn public-btn-primary" onClick={() => goTo("/app")}>Sign up</button>
        </div>
      </header>

      <main className="public-main">
        <section className="hero-card">
          <p className="hero-kicker">Trading intelligence workspace</p>
          <h1>Research markets, place simulated trades, and manage your decision loop in one place.</h1>
          <p>
            Zenin combines portfolio tracking, options tooling, prediction market monitoring, and journaling.
          </p>
          <div className="hero-cta">
            <button className="public-btn public-btn-primary" onClick={() => goTo("/app")}>Sign up to continue</button>
            <button className="public-btn public-btn-ghost" onClick={() => goTo("/auth?mode=signup")}>Open auth flows</button>
          </div>
        </section>

        <section className="capability-grid">
          {CAPABILITIES.map((item) => (
            <article className="capability-card" key={item}>
              <h3>{item}</h3>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}

export default PublicHomepage;
