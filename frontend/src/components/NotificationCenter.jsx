import { useEffect, useRef, useState } from "react";
import { BellRing, CircleAlert, Info, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import { RightRailDrawer } from "./CompactWorkspaceUI";

const CATEGORY_CONFIG = {
  security: { label: "Security", tone: "risk", Icon: ShieldAlert },
  account: { label: "Account", tone: "info", Icon: BellRing },
  execution: { label: "Execution", tone: "success", Icon: TrendingUp },
  portfolio: { label: "Portfolio", tone: "info", Icon: TrendingUp },
  risk: { label: "Risk", tone: "warning", Icon: CircleAlert },
  watchlist: { label: "Watchlist", tone: "info", Icon: TrendingUp },
  "market-news": { label: "Market", tone: "info", Icon: TrendingUp },
  research: { label: "Research", tone: "info", Icon: Info },
  journal: { label: "Journal", tone: "info", Icon: Info },
  workspace: { label: "Workspace", tone: "info", Icon: BellRing },
  general: { label: "Update", tone: "neutral", Icon: Info },
};

const INBOX_SECTIONS = [
  { id: "all", label: "All" },
  { id: "alerts", label: "Alerts", categories: ["risk", "watchlist", "market-news"] },
  { id: "orders", label: "Orders", categories: ["execution"] },
  { id: "updates", label: "Updates", categories: ["security", "account", "portfolio", "research", "journal", "workspace", "general"] },
];

export function normalizeWorkspaceNotification(notification = {}) {
  const type = String(notification.type || "workspace.event").toLowerCase();
  const metadata = notification.metadata && typeof notification.metadata === "object" ? notification.metadata : {};
  const severity = String(metadata.severity || notification.severity || "").toLowerCase();
  let category = String(notification.category || "").trim().toLowerCase();
  if (!CATEGORY_CONFIG[category]) category = "general";
  if (category === "general" && (type.includes("security") || type.includes("auth"))) category = "security";
  else if (category === "general" && (type.startsWith("portfolio_transaction") || type.includes("execution"))) category = "execution";
  else if (category === "general" && (type.includes("risk") || type.includes("rebalance") || type.includes("concentration"))) category = "risk";
  else if (category === "general" && (type.includes("market") || type.includes("watchlist") || type.includes("price"))) category = "market-news";
  else if (category === "general" && (type.includes("research") || type.includes("document"))) category = "research";
  else if (category === "general" && type.includes("journal")) category = "journal";
  else if (category === "general" && (type.includes("workspace") || type.includes("assignment"))) category = "workspace";

  const config = CATEGORY_CONFIG[category];
  const tone = ["critical", "danger", "risk", "high"].includes(severity)
    ? "risk"
    : ["warning", "review", "medium"].includes(severity)
      ? "warning"
      : config.tone;

  return {
    ...notification,
    metadata,
    category,
    categoryLabel: config.label,
    tone,
    Icon: config.Icon,
    actionUrl: notification.actionUrl || metadata.actionUrl || null,
    actionLabel: notification?.action?.label || metadata.actionLabel || null,
    occurrenceCount: Number(notification.occurrenceCount || 1),
    isUnread: !notification.readAt,
  };
}

function relativeTime(value) {
  if (!value) return "Just now";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
}

function NotificationItems({ items, loading, error, onRefresh, onMarkRead, onNavigate }) {
  if (error) {
    return (
      <div className="notification-center-state tone-risk" role="alert">
        <strong>Notifications are unavailable</strong>
        <p>{error}</p>
        <button type="button" onClick={onRefresh}>Try again</button>
      </div>
    );
  }

  if (loading && !items.length) {
    return (
      <div className="notification-center-loading" aria-live="polite" aria-label="Loading notifications">
        <span />
        <span />
        <span />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="notification-center-state">
        <BellRing aria-hidden="true" />
        <strong>No notifications yet</strong>
        <p>Portfolio activity, alerts, research, and workspace updates will appear here.</p>
      </div>
    );
  }

  return (
    <ol className="notification-center-list" aria-label="Workspace notifications">
      {items.map((item) => {
        const Icon = item.Icon;
        return (
          <li key={item.id} className={`notification-center-item tone-${item.tone} ${item.isUnread ? "is-unread" : ""}`.trim()}>
            <button
              type="button"
              className="notification-center-item__main"
              onClick={() => onNavigate(item)}
              aria-label={`${item.isUnread ? "Unread " : ""}${item.categoryLabel} notification: ${item.title || "Zenin update"}`}
            >
              <span className="notification-center-item__icon" aria-hidden="true"><Icon size={16} /></span>
              <span className="notification-center-item__copy">
                <span className="notification-center-item__meta">{item.categoryLabel} · {relativeTime(item.lastOccurredAt || item.createdAt)}{item.occurrenceCount > 1 ? ` · ${item.occurrenceCount} occurrences` : ""}</span>
                <strong>{item.title || "Zenin update"}</strong>
                {item.body ? <span>{item.body}</span> : null}
              </span>
              {item.isUnread ? <span className="notification-center-item__unread" aria-label="Unread" /> : null}
            </button>
            {item.isUnread ? (
              <button type="button" className="notification-center-item__read" onClick={() => onMarkRead(item)} aria-label={`Mark ${item.title || "notification"} as read`}>
                Mark read
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function NotificationInboxModal({ open, onClose, items, unreadCount, loading, error, onRefresh, onMarkRead, onMarkAllRead, onNavigate }) {
  const closeButtonRef = useRef(null);
  const [activeSection, setActiveSection] = useState("all");

  useEffect(() => {
    if (!open) return undefined;
    const handleKeydown = (event) => {
      if (event.key === "Escape") onClose();
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeydown);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKeydown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (open) setActiveSection("all");
  }, [open]);

  const section = INBOX_SECTIONS.find((entry) => entry.id === activeSection) || INBOX_SECTIONS[0];
  const sectionItems = section.categories
    ? items.filter((item) => section.categories.includes(item.category))
    : items;

  if (!open) return null;
  return (
    <div className="notification-inbox-modal-overlay" onMouseDown={onClose}>
      <section
        id="zenin-notification-inbox"
        className="notification-inbox-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-inbox-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="notification-inbox-modal__head">
          <div>
            <h2 id="notification-inbox-title">All notifications</h2>
            <p>{unreadCount ? `${unreadCount} unread` : "You’re all caught up"}</p>
          </div>
          <div className="notification-inbox-modal__actions">
            {unreadCount ? <button type="button" className="notification-center-mark-all" onClick={onMarkAllRead}>Mark all read</button> : null}
            <button type="button" className="notification-center-refresh-icon" onClick={onRefresh} disabled={loading} aria-label={loading ? "Refreshing notifications" : "Refresh notifications"} title={loading ? "Refreshing notifications" : "Refresh notifications"}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
            <button ref={closeButtonRef} type="button" className="compact-close-btn icon-button" onClick={onClose} aria-label="Close all notifications">×</button>
          </div>
        </header>
        <div className="notification-center-toolbar">
          <span>{sectionItems.length ? `${sectionItems.length} event${sectionItems.length === 1 ? "" : "s"}` : "Workspace activity"}</span>
          {loading ? <span className="notification-center-toolbar__status">Refreshing...</span> : null}
        </div>
        <div className="notification-inbox-modal__tabs" role="tablist" aria-label="Notification sections">
          {INBOX_SECTIONS.map((entry) => (
            <button
              key={entry.id}
              id={`notification-section-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={activeSection === entry.id}
              className={activeSection === entry.id ? "is-active" : ""}
              onClick={() => setActiveSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="notification-inbox-modal__body">
          <div role="tabpanel" aria-labelledby={`notification-section-${activeSection}`}>
            <NotificationItems {...{ items: sectionItems, loading, error, onRefresh, onMarkRead, onNavigate }} />
          </div>
        </div>
      </section>
    </div>
  );
}

export function NotificationCenter({
  notifications = [],
  unreadCount = 0,
  loading = false,
  error = "",
  onRefresh,
  onMarkRead,
  onMarkAllRead,
  onNavigate,
  open,
  onOpenChange,
  allOpen,
  onAllOpenChange,
}) {
  const items = [...notifications]
    .map(normalizeWorkspaceNotification)
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const previewItems = items.slice(0, 4);

  return (
    <>
    <RightRailDrawer
      id="zenin-notification-center"
      open={open}
      onClose={() => onOpenChange(false)}
      title="Notifications"
      subtitle={unreadCount ? `${unreadCount} unread` : "You’re all caught up"}
      className="notification-center-drawer"
      overlayClassName="notification-center-overlay"
      actions={
        unreadCount ? (
          <button type="button" className="notification-center-mark-all" onClick={onMarkAllRead}>
            Mark all read
          </button>
        ) : null
      }
    >
      <div className="notification-center-toolbar">
        <span>{items.length ? `${items.length} recent event${items.length === 1 ? "" : "s"}` : "Workspace activity"}</span>
        <button type="button" className="notification-center-refresh-icon" onClick={onRefresh} disabled={loading} aria-label={loading ? "Refreshing notifications" : "Refresh notifications"} title={loading ? "Refreshing notifications" : "Refresh notifications"}>
          <RefreshCw size={15} aria-hidden="true" />
        </button>
      </div>

      <NotificationItems items={previewItems} loading={loading} error={error} onRefresh={onRefresh} onMarkRead={onMarkRead} onNavigate={onNavigate} />
      <div className="notification-center-footer">
        <button type="button" onClick={() => onAllOpenChange(true)} aria-haspopup="dialog" aria-controls="zenin-notification-inbox">
          View all notifications
        </button>
      </div>
    </RightRailDrawer>
    <NotificationInboxModal
      open={allOpen}
      onClose={() => onAllOpenChange(false)}
      items={items}
      unreadCount={unreadCount}
      loading={loading}
      error={error}
      onRefresh={onRefresh}
      onMarkRead={onMarkRead}
      onMarkAllRead={onMarkAllRead}
      onNavigate={onNavigate}
    />
    </>
  );
}

export default NotificationCenter;
