import { SidebarItem } from "../CompactWorkspaceUI";

// Left sidebar: section navigation. Identical ordering for any pair of assets.
// Uses the shared SidebarItem primitive so ARW and Compare share item styling
// and keyboard behaviour.
export function ComparisonSidebar({ sections, active, onSelect }) {
  return (
    <nav className="cmp-sidebar" aria-label="Comparison sections">
      <div className="cmp-sidebar-title">Comparison Sections</div>
      <ul className="cmp-sidebar-list">
        {sections.map((s) => (
          <li key={s.key}>
            <SidebarItem
              label={s.label}
              active={active === s.key}
              onClick={() => onSelect(s.key)}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
