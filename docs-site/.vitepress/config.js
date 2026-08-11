import { defineConfig } from "vitepress";

// Public VitePress portal for Zenin.
// ONLY "Get started" and "Use Zenin" are public. "Build and operate" lives
// under docs/internal/ and is intentionally excluded from this build (see
// srcDir + search exclude + the build guard in scripts/check-links.mjs).
export default defineConfig({
  title: "Zenin Docs",
  description:
    "Zenin is a multi-asset investment intelligence workspace for individual investors. Get started, connect data sources, and use Portfolio, Journal, research, and analytics.",
  lang: "en-US",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "canonical", href: "https://docs.zenin.capital/" }],
    ["meta", { name: "robots", content: "index,follow" }],
  ],
  markdown: {
    anchor: { permalink: false },
  },
  themeConfig: {
    logo: "/favicon.svg",
    nav: [
      { text: "Get started", link: "/get-started/what-is-zenin" },
      { text: "Use Zenin", link: "/use-zenin/portfolio-and-connected-accounts" },
    ],
    sidebar: {
      "/get-started/": [
        {
          text: "Get started",
          items: [
            { text: "What Zenin is", link: "/get-started/what-is-zenin" },
            { text: "Create and access a workspace", link: "/get-started/create-and-access-a-workspace" },
            { text: "Connect data sources", link: "/get-started/connect-data-sources" },
            { text: "First portfolio sync", link: "/get-started/first-portfolio-sync" },
            { text: "Set up your workspace", link: "/get-started/set-up-your-workspace" },
            { text: "Troubleshooting quickstart", link: "/get-started/troubleshooting-quickstart" },
          ],
        },
      ],
      "/use-zenin/": [
        {
          text: "Use Zenin",
          items: [
            { text: "Portfolio and connected accounts", link: "/use-zenin/portfolio-and-connected-accounts" },
            { text: "Trades and journal", link: "/use-zenin/trades-and-journal" },
            { text: "Notifications", link: "/use-zenin/notifications" },
            { text: "Watchlists and research", link: "/use-zenin/watchlists-and-research" },
            {
              text: "Analytics, intelligence, options, predictions, tax",
              link: "/use-zenin/analytics-intelligence-options-predictions-tax",
            },
            { text: "Data status glossary", link: "/use-zenin/data-status-glossary" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: "https://github.com/zenin-capital/zenin" }],
    search: {
      provider: "local",
      options: {
        // Keep internal-only content out of public search.
        _placeholder: "Search Zenin docs",
      },
    },
    footer: {
      message:
        "Zenin provides research and decision-support tools only. Not investment, tax, legal, or financial advice.",
      copyright: "© Zenin Capital",
    },
    editLink: { pattern: "https://github.com/zenin-capital/zenin/edit/main/docs-site/:path" },
    docFooter: { prev: true, next: true },
    outline: { label: "On this page", level: [2, 3] },
  },
  buildEnd: async (siteConfig) => {
    // Guard: never ship internal content in the public portal.
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const internal = join(siteConfig.srcDir, "use-zenin", "..", "internal");
    if (existsSync(internal)) {
      throw new Error(
        "Internal documentation was detected inside the public docs-site source. " +
          "Build and operate docs must live under docs/internal/ in the repo root, not in docs-site/.",
      );
    }
  },
});
