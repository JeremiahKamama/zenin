import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173
  },
  build: {
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
          ) {
            return "vendor-react";
          }
          if (id.includes("apexcharts") || id.includes("react-apexcharts")) return "vendor-apexcharts";
          if (id.includes("recharts") || id.includes("lightweight-charts")) return "vendor-charts";
          if (id.includes("@vercel/analytics") || id.includes("@vercel/speed-insights")) return "vendor-vercel";
          if (id.includes("@simplewebauthn/browser")) return "vendor-webauthn";
          if (id.includes("@revenuecat/purchases-js")) return "vendor-billing";
          return undefined;
        }
      }
    }
  }
});
