export function NotesTab({ assetSymbol }) {
  const sections = [
    "Research Notes",
    "Journal Links",
    "Decision Links",
    "Saved Research"
  ];
  return (
    <div className="am-tab-content">
      <div className="am-empty-state">
        <p className="am-empty-title">No notes attached to {assetSymbol || "this asset"}.</p>
        <p className="am-empty-hint">Keep research notes, link journal and decision entries, and save referenced research from here.</p>
        <ul className="am-empty-list">
          {sections.map((s) => (
            <li key={s} className="am-empty-item">{s}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
