import { OverviewTab } from "./tabs/OverviewTab";
import { ResearchTab } from "./tabs/ResearchTab";

// v3: Asset Modal is a launcher, not a research destination. The only tab kept
// is Overview (quick glance). "Research" opens the Asset Research Workspace.
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "research", label: "Research" }
];

export function ResearchTabs({ activeTab, setActiveTab, onOpenResearch, ...rest }) {
  return (
    <section className="am-tabs" aria-label="Asset sections">
      <div className="am-tab-bar" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`am-tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="am-tab-panel" role="tabpanel">
        {activeTab === "overview" && <OverviewTab {...rest} />}
        {activeTab === "research" && <ResearchTab {...rest} onOpenResearch={onOpenResearch} />}
      </div>
    </section>
  );
}
