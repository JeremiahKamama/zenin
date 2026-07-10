// Frontend Black-Scholes engine — mirrors backend/utils/blackScholes.js so the
// Options Workbench can recompute greeks live from a WS tick (O3) without a
// backend round-trip. Vega/rho scaled by /100 to match market convention.

export function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1 + sign * y);
}

export function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// S = spot, K = strike, T = time to expiry in YEARS, r = risk-free (decimal),
// sigma = IV (decimal), type = "call" | "put".
export function blackScholes(S, K, T, r, sigma, type) {
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

// Years until expiry from an ISO date string (or Date) relative to `now`.
export function yearsToExpiry(expiry, now = new Date()) {
  if (!expiry) return null;
  const t = new Date(expiry).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = (t - now.getTime()) / (365 * 24 * 3600 * 1000);
  return diff > 0 ? diff : 0;
}

// Recompute greeks for a single contract given live spot/IV/expiry.
export function recomputeGreeks({ strike, optionType, spotPrice, impliedVolatility, expiry, riskFreeRate = 0.0425, now }) {
  const sigma = Number(impliedVolatility);
  const S = Number(spotPrice);
  const K = Number(strike);
  if (!(sigma > 0) || !(S > 0) || !(K > 0)) {
    return { delta: null, gamma: null, theta: null, vega: null, rho: null };
  }
  const T = yearsToExpiry(expiry, now);
  if (T == null || !(T > 0)) {
    return { delta: null, gamma: null, theta: null, vega: null, rho: null };
  }
  const g = blackScholes(S, K, T, Number(riskFreeRate), sigma, optionType === "put" ? "put" : "call");
  return {
    delta: Number(g.delta.toFixed(4)),
    gamma: Number(g.gamma.toFixed(6)),
    theta: Number(g.theta.toFixed(4)),
    vega: Number(g.vega.toFixed(4)),
    rho: Number(g.rho.toFixed(4)),
  };
}
