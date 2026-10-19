import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // Tailwind v4 plugin must run before react() so utility classes are
  // available to component CSS.
  const plugins = [tailwindcss(), react()];

  // Source-map upload: only when VITE_SENTRY_AUTH_TOKEN is explicitly set.
  // Local dev builds skip this to keep the dev loop fast and avoid auth errors.
  if (env.VITE_SENTRY_AUTH_TOKEN) {
    plugins.push(
      sentryVitePlugin({
        org: env.VITE_SENTRY_ORG,
        project: env.VITE_SENTRY_FRONTEND_PROJECT || "zenin-frontend",
        authToken: env.VITE_SENTRY_AUTH_TOKEN,
        release: {
          name: env.VITE_SENTRY_RELEASE || env.RENDER_GIT_COMMIT?.slice(0, 8) || "unknown",
          deploy: { env: env.VITE_SENTRY_ENVIRONMENT || env.NODE_ENV || "production" },
        },
        sourcemaps: {
          filesToDeleteAfterUpload: ["./dist/assets/**/*.map"],
        },
        telemetry: false,
      })
    );
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Dev-only: disable HTTP caching so live verification always fetches the
      // freshest modules (prevents stale ESM module-graph when iterating).
      headers: { "Cache-Control": "no-store" },
      // Proxy /api to the local backend so the SPA talks to it same-origin.
      // The session cookie is SameSite=Lax on the http dev backend, so a
      // cross-origin fetch (5173 -> 4000) withholds it on writes (DELETE/POST),
      // causing 401s. Routing through the proxy keeps requests same-origin.
      proxy: {
        "/api": {
          target: "http://localhost:4000",
          changeOrigin: true,
        },
      },
    },
    build: {
      // 'hidden' generates sourcemaps for Sentry upload but omits the
      // sourceMappingURL comment from the deployed JS, so maps are never
      // served publicly — they only exist in Sentry after upload.
      sourcemap: "hidden",
      // Vite's default 500 kB warning is advisory, not an error. The remaining
      // chunks above it are genuinely large and intentional:
      //   - vendor-apexcharts (~515 kB): the charting engine, used across
      //     Portfolio/Analytics/Journal.
      //   - App (~520 kB): the workspace application shell.
      //   - App CSS (~1.07 MB raw / ~156 kB gzip): the single app stylesheet.
      // The RevenueCat SDK (~682 kB) was the one genuine offender — it sat on
      // the critical path for every visitor. It is now an async chunk (see the
      // manualChunks note below), so it no longer loads until a paywall opens.
      // Raise the threshold to the largest remaining intentional chunk so a
      // real regression still surfaces.
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              id.includes("react-dom") ||
              id.includes("/react/") ||
              id.includes("/scheduler/") ||
              id.includes("/react-is/") ||
              id.includes("/use-sync-external-store/")
            ) return "vendor-react";
            if (id.includes("apexcharts") || id.includes("react-apexcharts")) return "vendor-apexcharts";
            if (id.includes("lightweight-charts")) return "vendor-charts";
            if (id.includes("@tanstack/react-table") || id.includes("@tanstack/react-virtual")) return "vendor-tanstack";
            if (id.includes("/tailwindcss/") || id.includes("@tailwindcss/")) return "vendor-tailwind";
            if (id.includes("@vercel/analytics") || id.includes("@vercel/speed-insights")) return "vendor-vercel";
            if (id.includes("@simplewebauthn/browser")) return "vendor-webauthn";
            // NOTE: @revenuecat/purchases-js is deliberately NOT pinned to a
            // named chunk. Pinning it forced Vite to <link rel="modulepreload">
            // the ~670 kB billing SDK on every page load, which defeated the
            // lazy import in src/utils/revenueCat.js. Letting Rollup place it
            // keeps it in an async chunk fetched only when a paywall opens.
            return undefined;
          },
        },
      },
    },
  };
});
