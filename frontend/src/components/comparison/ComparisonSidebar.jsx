// Left sidebar: section navigation. Identical ordering for any pair of assets.
export function ComparisonSidebar({ sections, active, onSelect }) {
  return (
    <nav className="cmp-sidebar" aria-label="Comparison sections">
      <div className="cmp-sidebar-title">Comparison Sections</div>
      <ul className="cmp-sidebar-list">
        {sections.map((s) => (
          <li key={s.key}>
            <button
              className={`cmp-sidebar-item ${active === s.key ? "active" : ""}`}
              onClick={() => onSelect(s.key)}
              aria-current={active === s.key ? "true" : undefined}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
