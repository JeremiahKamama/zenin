// frontend/scripts/hanging-api-proxy.mjs
// A tiny reverse proxy that accepts connections and NEVER responds.
// Simulates a Render cold start, where the edge holds the request open.
//
// Usage: node scripts/hanging-api-proxy.mjs <port> [hangMs] [mode]
//   mode = "all"   (default) -> hang every request
//   mode = "signin"          -> hang ONLY the sign-in POST; answer everything
//                              else normally. Isolates the sign-in timeout from
//                              the CSRF preflight, which also runs first.
//
//   hangMs = 0 (default) -> hang forever
//   hangMs > 0           -> hang, then respond 200 {} (wake-up simulation)

import http from "node:http";

const PORT = Number(process.argv[2] || 5199);
const HANG_MS = Number(process.argv[3] || 0);
const MODE = process.argv[4] || "all";

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Credentials": "true"
  };
}

const sockets = new Set();
const server = http.createServer((req, res) => {
  const shouldHang = MODE === "all" || req.url.includes("/auth/signin");

  if (!shouldHang) {
    // Answer normally so other boot traffic (csrf/me) succeeds quickly.
    const body = req.url.includes("/auth/csrf")
      ? JSON.stringify({ csrfToken: "test-csrf-token" })
      : JSON.stringify({ authenticated: false, user: null });
    res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
    res.end(body);
    return;
  }

  console.log(`[proxy] ${req.method} ${req.url} -> HOLDING (${HANG_MS || "forever"}ms)`);
  if (HANG_MS > 0) {
    setTimeout(() => {
      if (res.writableEnded) return;
      res.writeHead(200, { "Content-Type": "application/json", ...corsHeaders(req.headers.origin) });
      res.end(JSON.stringify({ ok: true }));
    }, HANG_MS);
  }
  // HANG_MS === 0 -> never respond; let it hang.
});

// Answer CORS preflight immediately so the app can issue the real request.
server.on("request", (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req.headers.origin),
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS,PATCH",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, Accept, X-CSRF-Token, X-Zenin-Simulate-Plan"
    });
    res.end();
  }
});

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[proxy] hanging API listening on http://127.0.0.1:${PORT} (hang=${HANG_MS || "forever"})`);
});

process.on("SIGTERM", () => {
  for (const s of sockets) s.destroy();
  server.close(() => process.exit(0));
});
