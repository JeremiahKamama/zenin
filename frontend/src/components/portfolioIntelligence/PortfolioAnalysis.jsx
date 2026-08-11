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
import { PortfolioActivity } from "../PortfolioActivity";

export const PORTFOLIO_ANALYSIS_TABS = [
  { id: "holdings", label: "Portfolio" },
  { id: "attribution", label: "Performance" },
  { id: "exposure", label: "Exposure" },
  { id: "execution", label: "Execution" },
  { id: "orders", label: "Orders" },
  { id: "costs", label: "Costs" },
  { id: "events", label: "Events" },
  { id: "activity", label: "Activity" },
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
  // unified portfolio read model (provider-neutral activity + reconciliation)
  transactions = [],
  reconciliation = null,
  syncStatus = null,
  baseCurrency = "USD",
  // Account labels (user-set in Settings) so the Activity Account dropdown can
  // show the real label instead of the raw sourceType.
  connectedAccounts = [],
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
    if (tabDef.id === "activity") return (
      <PortfolioActivity
        transactions={transactions}
        reconciliation={reconciliation}
        syncStatus={syncStatus}
        baseCurrency={baseCurrency}
        connectedAccounts={connectedAccounts}
      />
    );
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
      <div className={`portfolio-command-analysis-grid${rail ? "" : " no-rail"}`}>
        <div className="portfolio-command-analysis-main">{renderTab()}</div>
        {rail}
      </div>
    </section>
  );
}

export default PortfolioAnalysis;
