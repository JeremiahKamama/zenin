// =============================================================================
// PortfolioAnalysis — feature shell
// -----------------------------------------------------------------------------
// Orchestrates the Analysis Workspace tabs. The tab bar and the enriched tab
// panels (Holdings/Attribution/Exposure/Execution/Orders/Costs/Events) live
// here; the original Performance tab content and rebalance flow are computed in
// PortfolioModule and passed via the `renderPerformance` slot so the existing
// logic stays the single owner. New intelligence tabs (Execution/Orders/Costs/
// Events) are rendered from normalized data through the feature modules.
// =============================================================================

import { ExecutionModule } from "./modules/ExecutionModule";
import { OrdersModule } from "./modules/OrdersModule";
import { CostsModule } from "./modules/CostsModule";
import { EventsModule } from "./modules/EventsModule";

export const PORTFOLIO_ANALYSIS_TABS = [
  { id: "holdings", label: "Portfolio" },
  { id: "attribution", label: "Performance" },
  { id: "exposure", label: "Exposure" },
  { id: "execution", label: "Execution" },
  { id: "orders", label: "Orders" },
  { id: "costs", label: "Costs" },
  { id: "events", label: "Events" },
];

export function PortfolioAnalysis({
  activeTab,
  onTabChange,
  assetClassFilter = "all",
  // existing tab content (Holdings/Attribution/Exposure/Performance) computed in PortfolioModule
  renderLegacyTab,
  // normalized data for the new intelligence tabs
  orders = [],
  rawExecutions = [],
  feeDashboard = null,
  notifications = [],
  onManageConnections,
  // right rail (independently refreshable). Intelligence now lives in the
  // dedicated Intelligence workspace — pass `rail={null}` to omit it here.
  rail = null,
}) {
  const tabDef = PORTFOLIO_ANALYSIS_TABS.find((t) => t.id === activeTab) || PORTFOLIO_ANALYSIS_TABS[0];

  const renderTab = () => {
    if (tabDef.id === "execution") return <ExecutionModule rawExecutions={rawExecutions} onManageConnections={onManageConnections} />;
    if (tabDef.id === "orders") return <OrdersModule orders={orders} assetClassFilter={assetClassFilter} onManageConnections={onManageConnections} />;
    if (tabDef.id === "costs") return <CostsModule feeDashboard={feeDashboard} rawExecutions={rawExecutions} />;
    if (tabDef.id === "events") return <EventsModule rawExecutions={rawExecutions} notifications={notifications} onManageConnections={onManageConnections} />;
    // Holdings / Performance / Exposure are owned by PortfolioModule.
    if (renderLegacyTab) return renderLegacyTab(activeTab);
    return null;
  };

  return (
    <section className="portfolio-command-analysis">
      <div className="portfolio-command-tabs">
        {PORTFOLIO_ANALYSIS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`portfolio-command-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="portfolio-command-analysis-grid">
        <div className="portfolio-command-analysis-main">{renderTab()}</div>
        {rail}
      </div>
    </section>
  );
}

export default PortfolioAnalysis;
