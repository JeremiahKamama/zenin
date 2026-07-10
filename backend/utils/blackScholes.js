// Black-Scholes option pricing engine (CommonJS) — backend port of the proven
// frontend implementation in OptionsCalculator.jsx, extended with rho (which the
// frontend omitted and Massive/Deribit do not always supply).
//
// Used by:
//   - O1: compute rho per underlying (Massive chain lacks it)
//   - O3: live equity greeks recompute on WS ticks (cached-IV, BS engine)
//   - O5: OptionsCalculator saved-calcs server-side recompute
//
// All inputs in consistent units:
//   S = spot price, K = strike, T = time to expiry in YEARS, r = risk-free rate
//   (decimal, e.g. 0.0425), sigma = IV (decimal, e.g. 0.30), type = "call"|"put".
// Greeks are per-share except vega/rho which are scaled by /100 (per 1 vol point
// / 1 rate point) to match market convention.

"use strict";

function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function blackScholes(S, K, T, r, sigma, type) {
  if (!(T > 0) || !(sigma > 0) || !(S > 0) || !(K > 0)) {
    return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);
  const Nd1Neg = normCdf(-d1);
  const Nd2Neg = normCdf(-d2);
  const Nprime = normPdf(d1);

  let price, delta, theta, rho;
  if (type === "call") {
    price = S * Nd1 - K * Math.exp(-r * T) * Nd2;
    delta = Nd1;
    theta = (-S * Nprime * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * Nd2) / 365;
    rho = (K * T * Math.exp(-r * T) * Nd2) / 100;
  } else {
    price = K * Math.exp(-r * T) * Nd2Neg - S * Nd1Neg;
    delta = Nd1 - 1;
    theta = (-S * Nprime * sigma / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * Nd2Neg) / 365;
    rho = (-K * T * Math.exp(-r * T) * Nd2Neg) / 100;
  }
  const gamma = Nprime / (S * sigma * Math.sqrt(T));
  const vega = (S * Nprime * Math.sqrt(T)) / 100;

  return { price, delta, gamma, theta, vega, rho };
}

module.exports = { blackScholes, normCdf, normPdf };
