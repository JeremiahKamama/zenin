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
    },
    build: {
      // 'hidden' generates sourcemaps for Sentry upload but omits the
      // sourceMappingURL comment from the deployed JS, so maps are never
      // served publicly — they only exist in Sentry after upload.
      sourcemap: "hidden",
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
            if (id.includes("@revenuecat/purchases-js")) return "vendor-billing";
            return undefined;
          },
        },
      },
    },
  };
});
