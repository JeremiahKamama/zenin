import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Settings as SettingsIcon, 
  Database, 
  Activity, 
  Shield, 
  LogOut, 
  BarChart3, 
  Search, 
  Bell, 
  ChevronDown, 
  ExternalLink,
  Plus,
  Filter,
  MoreVertical,
  Edit,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  Mail,
  Smartphone,
  Globe,
  Lock,
  UserPlus,
  Calendar,
  ChevronRight,
  ChevronLeft,
  ChevronFirst,
  ChevronLast,
  Edit3,
  Link as LinkIcon,
  ShieldAlert,
  UserCheck,
  History,
  Copy,
  HardDrive,
  Layers,
  CloudUpload,
  Terminal,
  Table,
  Server,
  Zap,
  Activity as ActivityIcon,
  RefreshCw,
  MoreHorizontal,
  Maximize2,
  X,
  FileText as LogsIcon,
  CreditCard as BillingIcon,
  ShieldCheck,
  ShieldCheck as AuditIcon,
  LayoutGrid as IntegrationsIcon,
  Cpu,
  ShieldX,
  ZapOff,
  Flame,
  Terminal as TerminalIcon,
  Pin,
  MapPin,
  FileCode,
  CheckSquare,
  Box,
  CreditCard,
  Sun,
  Moon,
  Laptop,
  Monitor,
  Webhook,
  Key,
  RotateCcw,
  FileKey,
  AlertTriangle,
  RotateCw,
  MousePointer2,
  LayoutGrid,
  List,
  MessageSquare,
  BarChart,
  Code
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';
import { adminFetch } from './utils/adminFetch';
import { copyTextToClipboard, downloadCsvFile, downloadJsonFile } from './utils/adminUi';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const AdminUiContext = React.createContext({
  notify: () => {},
  copyText: async () => {},
  downloadJson: () => {},
  downloadCsv: () => {},
  showPlaceholder: () => {},
});

const useAdminUi = () => React.useContext(AdminUiContext);

const createAutoFitColumns = (minWidth = 220) => `repeat(auto-fit, minmax(${minWidth}px, 1fr))`;

const formatAbsoluteDate = (value, fallback = 'N/A') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString();
};

const formatAbsoluteDateTime = (value, fallback = 'N/A') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString();
};

const formatRelativeTime = (value, fallback = 'N/A') => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.max(1, Math.round(diffMs / hour))}h ago`;
  return `${Math.max(1, Math.round(diffMs / day))}d ago`;
};

const formatCurrency = (value, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const formatMoneyAmount = (value, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const formatMetricNumber = (value) => Number(value || 0).toLocaleString();

const formatStatusLabel = (value, fallback = 'unknown') => String(value || fallback)
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const formatAdminRoleLabel = (role) => {
  const value = String(role || 'user').trim().toLowerCase();
  if (value === 'super_admin') return 'Super Admin';
  if (value === 'support_admin') return 'Support Admin';
  if (value === 'billing_admin') return 'Billing Admin';
  if (value === 'ops_admin') return 'Ops Admin';
  return 'User';
};

const normalizeLogLevel = (level) => String(level || 'info').trim().toLowerCase();

const getMainAppUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const hostname = window.location.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return window.location.origin.replace(':4001', ':3000');
  }
  if (hostname === 'admin.zenin.capital') {
    return 'https://zenin.capital';
  }
  return window.location.origin.replace('admin.', '');
};

const parseStoredJson = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const persistStoredJson = (key, value) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
};

const ToastViewport = ({ toasts, onDismiss }) => {
  const toneIcons = {
    success: CheckCircle2,
    error: AlertCircle,
    info: Bell,
    warning: AlertTriangle,
  };

  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => {
        const Icon = toneIcons[toast.tone] || Bell;
        return (
          <div key={toast.id} className={`toast-card toast-${toast.tone}`}>
            <div className="toast-icon">
              <Icon size={16} />
            </div>
            <div className="toast-copy">
              <p className="toast-title">{toast.title}</p>
              {toast.message ? <p className="toast-message">{toast.message}</p> : null}
            </div>
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(toast.id)}
              aria-label={`Dismiss ${toast.title}`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

const CommandPalette = ({ open, query, onQueryChange, results, onClose, onNavigate, loading }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    { key: 'users', label: 'Users', rows: results?.users || [] },
    { key: 'audit', label: 'Audit', rows: results?.audit || [] },
    { key: 'logs', label: 'Logs', rows: results?.logs || [] },
    { key: 'tables', label: 'Tables', rows: results?.tables || [] },
  ];

  return (
    <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0, 0, 0, 0.78)' }}>
      <div className="modal-container" onClick={(event) => event.stopPropagation()} style={{ width: '760px', maxWidth: 'calc(100vw - 32px)', padding: '24px', borderRadius: '20px', background: 'var(--bg-header)', border: '1px solid var(--border)' }}>
        <div className="search-input-wrapper" style={{ marginBottom: '20px' }}>
          <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={18} />
          <input
            autoFocus
            type="text"
            className="search-input"
            placeholder="Jump to a user, request ID, audit action, or table..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            style={{ paddingLeft: '42px', height: '48px', fontSize: '15px' }}
          />
        </div>

        {loading ? (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>Searching the admin workspace…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '16px' }}>
            {sections.map((section) => (
              <div key={section.key} className="card" style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '13px', fontWeight: 700 }}>{section.label}</h4>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{section.rows.length}</span>
                </div>
                {section.rows.length === 0 ? (
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No matches yet.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {section.rows.map((row, index) => (
                      <button
                        key={`${section.key}-${row.id || row.name || index}`}
                        type="button"
                        className="btn btn-secondary"
                        style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '10px 12px', height: 'auto' }}
                        onClick={() => onNavigate(section.key, row)}
                      >
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600 }}>
                            {section.key === 'users' && (row.name || row.email)}
                            {section.key === 'audit' && row.action}
                            {section.key === 'logs' && (row.requestId || row.message)}
                            {section.key === 'tables' && row.name}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {section.key === 'users' && `${row.email} • ${formatAdminRoleLabel(row.adminRole)}`}
                            {section.key === 'audit' && `${row.actor || row.adminEmail || 'System'} • ${row.target || row.targetEmail || 'workspace'}`}
                            {section.key === 'logs' && `${row.service || 'Service'} • ${row.endpoint || 'Endpoint'}`}
                            {section.key === 'tables' && `${formatMetricNumber(row.rows)} rows`}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Components ---

const SidebarItem = ({ icon, label, active, onClick }) => (
  <button
    type="button"
    className={`nav-item nav-button ${active ? 'active' : ''}`}
    onClick={onClick}
    aria-pressed={active}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const AddUserModal = ({ isOpen, onClose, onAdd }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('starter');
  const [adminRole, setAdminRole] = useState('user');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setEmail('');
      setName('');
      setPlan('starter');
      setAdminRole('user');
      setError('');
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError('Enter the user\'s full name.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await onAdd({ email: trimmedEmail, name: trimmedName, plan, adminRole });
      onClose();
    } catch (submitError) {
      setError(submitError?.message || 'We could not create that user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" style={{ width: '400px', height: 'auto', maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Create New User</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>
        <div className="detail-content" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Full Name</label>
              <input 
                type="text" 
                className="search-input" 
                style={{ width: '100%', paddingLeft: '12px' }} 
                placeholder="John Doe" 
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Email Address</label>
              <input 
                type="email" 
                className="search-input" 
                style={{ width: '100%', paddingLeft: '12px' }} 
                placeholder="john@example.com" 
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Initial Plan</label>
              <select 
                className="filter-select" 
                style={{ width: '100%', height: '40px' }}
                value={plan}
                onChange={e => setPlan(e.target.value)}
              >
                <option value="starter">Starter (Free)</option>
                <option value="pro">Pro ($29/mo)</option>
                <option value="desk">Desk ($99/mo)</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Initial Role</label>
              <select className="filter-select" style={{ width: '100%', height: '40px' }} value={adminRole} onChange={(e) => setAdminRole(e.target.value)}>
                <option value="user">User</option>
                <option value="support_admin">Support Admin</option>
                <option value="billing_admin">Billing Admin</option>
                <option value="ops_admin">Ops Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
          </div>
          {error ? (
            <div className="inline-feedback inline-feedback-error" style={{ marginTop: '16px' }}>
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          ) : null}
          <div style={{ marginTop: '32px', display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 1 }}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const SectionHeader = ({ title, description, breadcrumbs, onAction }) => (
  <div style={{ marginBottom: '32px' }}>
    <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
      <span>Home</span>
      {breadcrumbs.map(b => (
        <React.Fragment key={b}>
          <span>/</span>
          <span style={{ color: b === breadcrumbs[breadcrumbs.length - 1] ? 'var(--accent)' : 'inherit' }}>{b}</span>
        </React.Fragment>
      ))}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
        <p style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{description}</p>
      </div>
      {typeof onAction === 'function' && (title === 'System Logs' || title === 'User Management') && (
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" style={{ gap: '8px', height: '38px' }} onClick={() => onAction('secondary')}>
            {title === 'System Logs' ? <Download size={16} /> : <Filter size={16} />}
            {title === 'System Logs' ? 'Download Logs' : 'Export List'}
          </button>
          <button className="btn btn-primary" style={{ gap: '8px', height: '38px' }} onClick={() => onAction('primary')}>
            {title === 'System Logs' ? <Plus size={16} /> : <UserPlus size={16} />}
            {title === 'System Logs' ? 'Create Alert' : 'Add User'}
          </button>
        </div>
      )}
    </div>
  </div>
);

const SummaryCard = ({ icon: Icon, label, value, trend, trendUp, sparklineColor }) => (
  <div className="card" style={{ padding: '24px', position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 0, right: 0, width: '64px', height: '64px', background: `radial-gradient(circle at top right, ${sparklineColor}15, transparent)`, pointerEvents: 'none' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
      <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: `${sparklineColor}10`, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${sparklineColor}20` }}>
        <Icon size={20} color={sparklineColor} />
      </div>
      {trend && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: trendUp ? 'var(--success)' : 'var(--danger)', fontWeight: 600, padding: '4px 8px', background: trendUp ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', borderRadius: '6px' }}>
          {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {trend}
        </div>
      )}
    </div>
    <div>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500, marginBottom: '6px' }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em' }}>{value}</h3>
        <div style={{ width: '80px', height: '32px' }}>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            <path 
              d={`M0 ${30 + Math.random() * 10} L20 ${20 + Math.random() * 15} L40 ${25 + Math.random() * 10} L60 ${10 + Math.random() * 20} L80 ${15 + Math.random() * 10} L100 ${5 + Math.random() * 10}`} 
              fill="none" 
              stroke={sparklineColor} 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
            />
          </svg>
        </div>
      </div>
    </div>
  </div>
);

const Toggle = ({ active, onClick }) => (
  <button
    type="button"
    className={`toggle-switch ${active ? 'active' : ''}`}
    onClick={onClick}
    aria-pressed={active}
    disabled={!onClick}
  >
    <div className="toggle-dot" />
  </button>
);

const UserDetailPanel = ({ user, details, onClose, onUpdate, onResetPassword, onRevokeSessions, onOpenRelated }) => {
  const adminUi = useAdminUi();
  const resolvedUser = details?.user || user;
  if (!resolvedUser) return null;

  const sessions = details?.sessions || [];
  const recentAudit = details?.recentAudit || [];
  const recentActivity = details?.recentActivity || [];
  const revenueCat = details?.revenueCat || null;

  const requestReason = (label) => window.prompt(`Reason for ${label.toLowerCase()}:`, '')?.trim();

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>
              {resolvedUser.name?.charAt(0) || resolvedUser.email?.charAt(0)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{resolvedUser.name || 'No Name'}</h2>
                {resolvedUser.adminRole !== 'user' && <span className="badge badge-pro" style={{ fontSize: '10px' }}>{formatAdminRoleLabel(resolvedUser.adminRole)}</span>}
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{resolvedUser.email}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div className="detail-content">
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
            <button className="btn btn-secondary" style={{ height: '34px', fontSize: '12px' }} onClick={() => onOpenRelated('audit', resolvedUser)}>
              View Audit Trail
            </button>
            <button className="btn btn-secondary" style={{ height: '34px', fontSize: '12px' }} onClick={() => onOpenRelated('logs', resolvedUser)}>
              View System Activity
            </button>
            <button className="btn btn-secondary" style={{ height: '34px', fontSize: '12px' }} onClick={() => onOpenRelated('users', resolvedUser)}>
              Back to Users
            </button>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Account Control</h4>
            <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Current Plan</span>
                <select 
                  className="filter-select" 
                  value={resolvedUser.plan?.toLowerCase()} 
                  onChange={(e) => {
                    const reason = requestReason(`changing ${resolvedUser.email} plan`);
                    if (!reason) return;
                    onUpdate(resolvedUser.id, 'plan', e.target.value, reason);
                  }}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}
                >
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="desk">Desk</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Admin Role</span>
                <select
                  className="filter-select"
                  value={resolvedUser.adminRole || 'user'}
                  onChange={(e) => {
                    const reason = requestReason(`updating ${resolvedUser.email} role`);
                    if (!reason) return;
                    onUpdate(resolvedUser.id, 'role', e.target.value, reason);
                  }}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}
                >
                  <option value="user">User</option>
                  <option value="support_admin">Support Admin</option>
                  <option value="billing_admin">Billing Admin</option>
                  <option value="ops_admin">Ops Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Active Sessions</p>
                  <p style={{ fontSize: '16px', fontWeight: 700 }}>{formatMetricNumber(resolvedUser.activeSessionCount || sessions.filter((entry) => entry.isActive).length)}</p>
                </div>
                <div style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Last Seen</p>
                  <p style={{ fontSize: '16px', fontWeight: 700 }}>{formatRelativeTime(resolvedUser.lastSeenAt || sessions[0]?.createdAt, 'No sessions')}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">User Summary</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Member Since</p>
                <p style={{ fontSize: '14px', fontWeight: 600 }}>{formatAbsoluteDate(resolvedUser.joined)}</p>
              </div>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</p>
                <p style={{ fontSize: '14px', fontWeight: 600, color: resolvedUser.suspendedAt ? 'var(--danger)' : 'var(--success)' }}>
                  {resolvedUser.suspendedAt ? 'Suspended' : 'Active'}
                </p>
              </div>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Security</p>
                <p style={{ fontSize: '14px', fontWeight: 600 }}>{resolvedUser.twoFactorEnabled ? '2FA Enabled' : 'Password Only'}</p>
              </div>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Password Changed</p>
                <p style={{ fontSize: '14px', fontWeight: 600 }}>{formatRelativeTime(resolvedUser.passwordChangedAt, 'Unknown')}</p>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Contact Information</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="detail-row">
                <div className="detail-label"><Mail size={14} /> Email</div>
                <div className="detail-value">{resolvedUser.email}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label"><Clock size={14} /> ID</div>
                <div className="detail-value" style={{ fontFamily: 'monospace', fontSize: '12px' }}>{resolvedUser.id}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label"><ShieldCheck size={14} /> Auth Provider</div>
                <div className="detail-value">{resolvedUser.authProvider || 'email'}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label"><Activity size={14} /> Billing Cycle</div>
                <div className="detail-value">{resolvedUser.billingCycle || 'monthly'}</div>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">RevenueCat</h4>
            <RevenueCatCustomerSnapshot snapshot={revenueCat} />
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Sessions & Devices</h4>
            {sessions.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No active or historical sessions were found for this user.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sessions.slice(0, 5).map((session) => (
                  <div key={session.id} style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 600 }}>{session.deviceLabel} • {session.browserLabel}</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{session.ipAddress || 'Unknown IP'} • {formatRelativeTime(session.createdAt)}</p>
                      </div>
                      <span className={`badge ${session.isActive ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: '10px' }}>
                        {session.isActive ? 'Active' : 'Ended'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Recent Audit</h4>
            {recentAudit.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No admin actions are recorded for this user yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {recentAudit.slice(0, 4).map((event) => (
                  <button key={event.id} type="button" className="btn btn-secondary" style={{ justifyContent: 'space-between', height: 'auto', padding: '12px 14px' }} onClick={() => onOpenRelated('audit', resolvedUser)}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{event.action}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{event.actor} • {formatRelativeTime(event.createdAt)}</div>
                    </div>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Recent System Activity</h4>
            {recentActivity.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No recent request activity is available for this user.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {recentActivity.slice(0, 4).map((event) => (
                  <button key={event.id} type="button" className="btn btn-secondary" style={{ justifyContent: 'space-between', height: 'auto', padding: '12px 14px' }} onClick={() => onOpenRelated('logs', resolvedUser)}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{event.endpoint || event.message}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{event.service || 'Service'} • {formatRelativeTime(event.createdAt)}</div>
                    </div>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="detail-section" style={{ marginTop: 'auto', marginBottom: 0 }}>
            <h4 className="detail-section-title">Management Actions</h4>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, gap: '8px', fontSize: '13px', height: '38px' }}
                onClick={() => {
                  const reason = requestReason(`resetting password for ${resolvedUser.email}`);
                  if (!reason) return;
                  onResetPassword(resolvedUser.id, reason);
                }}
              >
                <Lock size={14} /> Reset Password
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, gap: '8px', fontSize: '13px', height: '38px' }}
                onClick={() => {
                  const reason = requestReason(`revoking all sessions for ${resolvedUser.email}`);
                  if (!reason) return;
                  onRevokeSessions(resolvedUser.id, reason);
                }}
              >
                <RotateCcw size={14} /> Revoke Sessions
              </button>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button 
                className="btn" 
                style={{ 
                  flex: 1, 
                  gap: '8px', 
                  height: '38px', 
                  fontSize: '13px',
                  background: resolvedUser.suspendedAt ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                  border: resolvedUser.suspendedAt ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)', 
                  color: resolvedUser.suspendedAt ? 'var(--success)' : '#ef4444' 
                }}
                onClick={() => {
                  const reason = requestReason(`${resolvedUser.suspendedAt ? 'reactivating' : 'suspending'} ${resolvedUser.email}`);
                  if (!reason) return;
                  onUpdate(resolvedUser.id, 'suspend', !resolvedUser.suspendedAt, reason);
                }}
              >
                {resolvedUser.suspendedAt ? <CheckCircle2 size={14} /> : <ZapOff size={14} />}
                {resolvedUser.suspendedAt ? 'Activate User' : 'Suspend Account'}
              </button>
              <button 
                className="btn btn-danger" 
                style={{ flex: 0.5, gap: '8px', height: '38px', fontSize: '13px' }}
                onClick={() => {
                  const reason = requestReason(`deleting ${resolvedUser.email}`);
                  if (!reason) return;
                  onUpdate(resolvedUser.id, 'delete', true, reason);
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const EventDetailPanel = ({ event, onClose }) => {
  const adminUi = useAdminUi();
  if (!event) return null;

  const diffEntries = event.diff && typeof event.diff === 'object'
    ? Object.entries(event.diff)
    : [];

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" style={{ width: '480px' }} onClick={e => e.stopPropagation()}>
        <div className="detail-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Event Details</h2>
            <span className={`badge badge-${String(event.severity || 'info').toLowerCase()}`}>{String(event.severity || 'info').toUpperCase()}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="detail-content" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', background: 'var(--bg-hover)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Edit3 size={20} color="var(--accent)" />
            </div>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{event.action}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{event.summary || `${event.actor || event.adminEmail || 'System'} acted on ${event.target || event.targetEmail || 'workspace'}`}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{formatAbsoluteDateTime(event.createdAt)} ({formatRelativeTime(event.createdAt)})</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => adminUi.downloadJson(`audit-event-${event.id}.json`, event, 'Audit event exported.', 'The selected event was downloaded as JSON.')}
            >
              <Download size={14} /> Export
            </button>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => adminUi.copyText(JSON.stringify(event, null, 2), 'Event copied for inspection.', 'You can paste the raw event into your incident notes or tooling.')}
            >
              <Search size={14} /> Inspect
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => adminUi.copyText(`${window.location.origin}${window.location.pathname}#audit-event-${event.id}`, 'Deep link copied.', 'The audit event link is ready to share with the team.')}
            >
              <LinkIcon size={14} /> Copy Link
            </button>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Event Metadata</h4>
            {[
              { label: 'Event ID', value: event.id, copy: true },
              { label: 'Actor', value: `${event.actor || event.adminEmail || 'System'} (${formatAdminRoleLabel(event.actorRole)})` },
              { label: 'Target', value: event.target || event.targetEmail || 'Workspace' },
              { label: 'Target User ID', value: event.targetUserId || 'N/A' },
              { label: 'Source IP', value: event.ipAddress || 'N/A' },
              { label: 'Request ID', value: event.requestId || 'N/A' }
            ].map((item, idx) => (
              <div key={idx} className="detail-row">
                <div className="detail-label">{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                  {item.value} {item.copy && <Copy size={12} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} onClick={() => adminUi.copyText(String(item.value), 'Value copied.', 'The event identifier is ready to paste elsewhere.')} />}
                </div>
              </div>
            ))}
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Change Summary</h4>
            <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
              {diffEntries.length === 0 ? (
                <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>No structured before/after diff was attached to this event.</div>
              ) : (
                diffEntries.map(([key, value]) => (
                  <div key={key} style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>{key}</div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '12px', marginBottom: '6px' }}>
                      <span style={{ color: '#ef4444' }}>Before</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(value?.before ?? null)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                      <span style={{ color: '#10b981' }}>After</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{JSON.stringify(value?.after ?? null)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="detail-section" style={{ marginBottom: 0 }}>
            <h4 className="detail-section-title">Additional Context</h4>
            {[
              { label: 'Reason', value: event.reason || 'No reason recorded' },
              { label: 'Status', value: event.status || 'success', color: 'var(--success)' },
              { label: 'Correlation', value: event.requestId || 'N/A' },
              { label: 'Raw Details', value: JSON.stringify(event.details || {}, null, 2) }
            ].map((item, idx) => (
              <div key={idx} className="detail-row">
                <div className="detail-label">{item.label}</div>
                <div style={{ color: item.color || 'var(--text-primary)' }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const LogDetailPanel = ({ log, onClose, onCreateIncident }) => {
  const adminUi = useAdminUi();
  if (!log) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" style={{ width: '520px' }} onClick={e => e.stopPropagation()}>
        <div className="detail-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Log Details</h2>
            <span className={`badge badge-${log.level.toLowerCase()}`}>{log.level.toUpperCase()}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        <div className="detail-content" style={{ padding: '24px' }}>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{formatAbsoluteDateTime(log.createdAt)} ({formatRelativeTime(log.createdAt)})</p>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', lineHeight: 1.4 }}>{log.message}</h3>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => adminUi.copyText(JSON.stringify(log, null, 2), 'Log copied.', 'The selected log entry is now on your clipboard.')}
            >
              <Copy size={14} /> Copy
            </button>
            <button
              className="btn btn-secondary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => adminUi.copyText(log.requestId || String(log.id), 'Identifier copied.', 'The request or log identifier is ready to share in an incident thread.')}
            >
              <Pin size={14} /> Pin
            </button>
            <button
              className="btn btn-primary"
              style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}
              onClick={() => onCreateIncident?.(log)}
            >
              <CheckSquare size={14} /> Create Incident
            </button>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Message</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {log.message}
            </p>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Structured Context</h4>
            <pre className="stack-trace-preview" style={{ whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(log.context || {}, null, 2)}
            </pre>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Request Metadata</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">Request ID</span><span className="log-prop-value">{log.requestId || 'N/A'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Endpoint</span><span className="log-prop-value">{log.endpoint || 'N/A'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">IP Address</span><span className="log-prop-value">{log.ipAddress}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Service</span><span className="log-prop-value">{log.service || 'N/A'}</span></div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">User / Session</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">User ID</span><span className="log-prop-value">{log.userId || 'N/A'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Session ID</span><span className="log-prop-value">{log.sessionId || 'N/A'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Actor Type</span><span className="log-prop-value">{log.actorType || 'N/A'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Environment</span><span className="log-prop-value">{log.environment || 'N/A'}</span></div>
            </div>
          </div>

          <div className="detail-section" style={{ marginBottom: 0 }}>
            <h4 className="detail-section-title">Performance</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">Duration</span><span className="log-prop-value" style={{ color: log.durationMs > 2000 ? '#ef4444' : 'inherit', fontWeight: 600 }}>{log.durationMs == null ? 'N/A' : `${log.durationMs} ms`}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Status Code</span><span className="log-prop-value">{log.statusCode || 'N/A'}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const LogoutModal = ({ onClose, onLogout }) => (
  <div className="modal-overlay" onClick={onClose} style={{ backdropFilter: 'blur(12px)', background: 'rgba(0,0,0,0.85)' }}>
    <div className="modal-container" onClick={e => e.stopPropagation()} style={{ width: '420px', borderRadius: '24px', background: '#0a0b0d', border: '1px solid rgba(255,255,255,0.08)', padding: '32px' }}>
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
          <LogOut size={32} color="#ef4444" />
        </div>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '12px' }}>Confirm Logout</h2>
        <p style={{ fontSize: '15px', color: 'var(--text-muted)', lineHeight: 1.5 }}>Are you sure you want to log out? You will be signed out of your current session on this device.</p>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px', marginBottom: '32px' }}>
        <p style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }}>Current Session</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Laptop size={16} color="var(--text-muted)" />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>MacBook Pro</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>macOS Sonoma</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Globe size={16} color="var(--text-muted)" />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>Chrome</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>v125.0.6422</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MapPin size={16} color="var(--text-muted)" />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>San Francisco, US</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Detected IP</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={16} color="var(--text-muted)" />
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>203.0.113.42</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Static IP</p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={onClose} className="btn" style={{ flex: 1, height: '48px', fontSize: '15px', fontWeight: 600, background: 'transparent', borderColor: 'rgba(255,255,255,0.1)', color: 'white' }}>Cancel</button>
        <button onClick={onLogout} className="btn" style={{ flex: 1, height: '48px', fontSize: '15px', fontWeight: 600, background: '#ef4444', borderColor: '#ef4444', color: 'white' }}>Sign Out</button>
      </div>
    </div>
  </div>
);

const ServiceStatusGrid = ({ health }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' }}>
    {[
      { label: 'Web API', value: health?.api || 99.98, icon: Globe },
      { label: 'Database', value: health?.db || 99.96, icon: Database },
      { label: 'Auth Svc', value: health?.web || 99.97, icon: ShieldCheck },
    ].map((svc, i) => (
      <div key={i} style={{ padding: '12px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <svc.icon size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>{svc.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700 }}>{svc.value}%</span>
          <span style={{ fontSize: '10px', color: 'var(--success)', marginBottom: '2px' }}>Up</span>
        </div>
      </div>
    ))}
  </div>
);

const OverviewView = ({ stats, onOpenAudit }) => (
  <div className="fade-in">
    <SectionHeader 
      title="System Overview" 
      description="Real-time insights and platform health at a glance." 
      breadcrumbs={['Overview']} 
    />
    
    <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
      <SummaryCard 
        icon={Users} 
        label="Total Users" 
        value={stats?.totalUsers?.toLocaleString() || '0'} 
        trend="Active Growth" 
        trendUp={true} 
        sparklineColor="#3b82f6" 
      />
      <SummaryCard 
        icon={Activity} 
        label="Active Sessions" 
        value={stats?.activeSessions?.toLocaleString() || '0'} 
        trend="Real-time" 
        trendUp={true} 
        sparklineColor="#10b981" 
      />
      <SummaryCard 
        icon={Zap} 
        label="Total Trades" 
        value={stats?.totalTrades?.toLocaleString() || '0'} 
        trend="Across All Workspaces" 
        trendUp={true} 
        sparklineColor="#8b5cf6" 
      />
      <SummaryCard 
        icon={BillingIcon} 
        label="Current MRR" 
        value={`$${stats?.mrr?.toLocaleString() || '0'}`} 
        trend="Projected Revenue" 
        trendUp={true} 
        sparklineColor="#f59e0b" 
      />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px', marginBottom: '24px' }}>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>User Growth & Engagement</h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Historical trends over the last 30 days</p>
          </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>7D</button>
          <button className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '12px' }}>30D</button>
        </div>
        </div>
        <div style={{ height: '350px' }}>
          <Line 
            data={{
              labels: ['May 1', 'May 7', 'May 14', 'May 21', 'May 28', 'Jun 4'],
              datasets: [{
                label: 'Total Users',
                data: [
                  Math.floor((stats?.totalUsers || 100) * 0.8), 
                  Math.floor((stats?.totalUsers || 100) * 0.85), 
                  Math.floor((stats?.totalUsers || 100) * 0.9), 
                  Math.floor((stats?.totalUsers || 100) * 0.95), 
                  stats?.totalUsers || 100, 
                  Math.floor((stats?.totalUsers || 100) * 1.02)
                ],
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                fill: true,
                tension: 0.4,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6'
              }]
            }}
            options={{ 
              maintainAspectRatio: false, 
              plugins: { legend: { display: false } }, 
              scales: { 
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7280' } },
                x: { grid: { display: false }, ticks: { color: '#6b7280' } }
              } 
            }}
          />
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px' }}>Platform Metrics</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>Subscription Breakdown</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {['Starter', 'Pro', 'Desk'].map(plan => {
                const count = stats?.planBreakdown?.[plan.toLowerCase()] || 0;
                const total = stats?.totalUsers || 1;
                const percentage = Math.round((count / total) * 100);
                const color = plan === 'Starter' ? '#6b7280' : plan === 'Pro' ? '#3b82f6' : '#f59e0b';
                return (
                  <div key={plan}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                      <span style={{ fontWeight: 500 }}>{plan}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{count} ({percentage}%)</span>
                    </div>
                    <div style={{ height: '6px', background: 'var(--bg-app)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${percentage}%`, height: '100%', background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ShieldCheck size={16} color="var(--success)" />
              </div>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>System Health</p>
                <p style={{ fontSize: '11px', color: 'var(--success)' }}>Operational</p>
              </div>
            </div>
            <ServiceStatusGrid health={stats?.systemHealth} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Active Alerts</p>
              <p style={{ fontSize: '20px', fontWeight: 700 }}>{formatMetricNumber(stats?.activeAlerts || 0)}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Open monitoring thresholds</p>
            </div>
            <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '6px' }}>Open Incidents</p>
              <p style={{ fontSize: '20px', fontWeight: 700 }}>{formatMetricNumber(stats?.openIncidents || 0)}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Tracked operator escalations</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Live Platform Activity</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Latest events from users and infrastructure</p>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={onOpenAudit}>View Full Audit Trail</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(260), gap: '16px' }}>
        {(stats?.recentActivity || []).map((item, i) => (
          <div key={i} style={{ display: 'flex', gap: '12px', padding: '12px', background: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.action.includes('Registered') ? <UserPlus size={16} color="#3b82f6" /> : <ActivityIcon size={16} color="#10b981" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{item.email}</p>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{new Date(item.time).toLocaleTimeString()}</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{item.action}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="card" style={{ marginTop: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recent Deploy Markers</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Recent admin migrations and release-adjacent operational changes</p>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {(stats?.recentDeployments || []).length ? stats.recentDeployments.map((deployment, index) => (
          <div key={`${deployment.createdAt}-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600 }}>{deployment.force ? 'Forced admin migration' : 'Admin workspace migration'}</p>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{deployment.reason}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: '12px', fontWeight: 600 }}>{deployment.actor}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{formatRelativeTime(deployment.createdAt)}</p>
            </div>
          </div>
        )) : (
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No recent deploy markers were found in the audit store.</p>
        )}
      </div>
    </div>
  </div>
);

const UserManagementView = ({ users, searchQuery, setSearchQuery, onSelectUser, onAddUser, onExportUsers, onBulkAction }) => {
  const savedViewsKey = 'zenin_admin_user_views';
  const [planFilter, setPlanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);
  const [savedViews, setSavedViews] = useState(() => parseStoredJson(savedViewsKey, []));

  useEffect(() => {
    persistStoredJson(savedViewsKey, savedViews);
  }, [savedViews]);

  const filteredUsers = (users || []).filter((entry) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query
      || (entry.name || '').toLowerCase().includes(query)
      || (entry.email || '').toLowerCase().includes(query)
      || String(entry.id).includes(query);
    const matchesPlan = planFilter === 'all' || entry.plan?.toLowerCase() === planFilter;
    const matchesStatus = statusFilter === 'all'
      || (statusFilter === 'active' && !entry.suspendedAt)
      || (statusFilter === 'suspended' && !!entry.suspendedAt);
    const matchesRole = roleFilter === 'all' || (entry.adminRole || 'user') === roleFilter;
    return matchesSearch && matchesPlan && matchesStatus && matchesRole;
  });

  const activeUsers = (users || []).filter((entry) => !entry.suspendedAt).length;
  const newThisWeek = (users || []).filter((entry) => entry.joined && Date.now() - new Date(entry.joined).getTime() < 7 * 24 * 60 * 60 * 1000).length;
  const adminCount = (users || []).filter((entry) => (entry.adminRole || 'user') !== 'user').length;

  const toggleSelection = (userId) => {
    setSelectedIds((prev) => prev.includes(userId) ? prev.filter((entry) => entry !== userId) : [...prev, userId]);
  };

  const saveCurrentView = () => {
    const name = window.prompt('Name this saved user view:', '');
    if (!name) return;
    setSavedViews((prev) => [...prev.filter((entry) => entry.name !== name), { name, searchQuery, planFilter, statusFilter, roleFilter }]);
  };

  const applyView = (view) => {
    setSearchQuery(view.searchQuery || '');
    setPlanFilter(view.planFilter || 'all');
    setStatusFilter(view.statusFilter || 'all');
    setRoleFilter(view.roleFilter || 'all');
  };

  const runBulkAction = (action, value = null) => {
    if (!selectedIds.length) return;
    const reason = window.prompt(`Reason for ${action.replace(/_/g, ' ')} on ${selectedIds.length} selected user(s):`, '');
    if (!reason) return;
    onBulkAction({ action, userIds: selectedIds, value, reason });
    setSelectedIds([]);
  };

  return (
    <div className="fade-in">
      <SectionHeader
        title="User Management"
        description="Manage platform users, subscription access, admin roles, and session state."
        breadcrumbs={['Users']}
        onAction={(type) => {
          if (type === 'primary') {
            onAddUser();
            return;
          }
          onExportUsers(filteredUsers);
        }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={Users} label="Total Users" value={formatMetricNumber(users.length)} trend="Live directory" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={Activity} label="Active Users" value={formatMetricNumber(activeUsers)} trend={`${Math.max(users.length - activeUsers, 0)} suspended`} trendUp={true} sparklineColor="#10b981" />
        <SummaryCard icon={UserPlus} label="New This Week" value={formatMetricNumber(newThisWeek)} trend="Recent signups" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={ShieldCheck} label="Admins" value={formatMetricNumber(adminCount)} trend="Role-separated access" trendUp={true} sparklineColor="#f59e0b" />
      </div>

      <div className="card">
        <div className="filter-bar" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none', minWidth: '240px' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input
              type="text"
              className="search-input"
              placeholder="Search by name, email, or ID..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>
          <select className="filter-select" value={planFilter} onChange={(event) => setPlanFilter(event.target.value)}>
            <option value="all">All Plans</option>
            <option value="starter">Starter</option>
            <option value="pro">Pro</option>
            <option value="desk">Desk</option>
          </select>
          <select className="filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select className="filter-select" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="all">All Roles</option>
            <option value="user">User</option>
            <option value="support_admin">Support Admin</option>
            <option value="billing_admin">Billing Admin</option>
            <option value="ops_admin">Ops Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={saveCurrentView}>Save View</button>
        </div>

        {savedViews.length ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '0 24px 16px 24px' }}>
            {savedViews.map((view) => (
              <button key={view.name} type="button" className="btn btn-secondary" style={{ height: '30px', fontSize: '11px' }} onClick={() => applyView(view)}>
                {view.name}
              </button>
            ))}
          </div>
        ) : null}

        {selectedIds.length ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '0 24px 16px 24px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)', alignSelf: 'center' }}>{selectedIds.length} selected</span>
            <button className="btn btn-secondary" style={{ height: '32px', fontSize: '12px' }} onClick={() => runBulkAction('suspend')}>Suspend</button>
            <button className="btn btn-secondary" style={{ height: '32px', fontSize: '12px' }} onClick={() => runBulkAction('reactivate')}>Reactivate</button>
            <button className="btn btn-secondary" style={{ height: '32px', fontSize: '12px' }} onClick={() => runBulkAction('plan', 'pro')}>Move to Pro</button>
            <button className="btn btn-secondary" style={{ height: '32px', fontSize: '12px' }} onClick={() => runBulkAction('role', 'support_admin')}>Make Support Admin</button>
            <button className="btn btn-secondary" style={{ height: '32px', fontSize: '12px' }} onClick={() => runBulkAction('revoke_sessions')}>Revoke Sessions</button>
          </div>
        ) : null}

        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: '44px' }}>
                  <input
                    type="checkbox"
                    checked={filteredUsers.length > 0 && selectedIds.length === filteredUsers.length}
                    onChange={(event) => setSelectedIds(event.target.checked ? filteredUsers.map((entry) => entry.id) : [])}
                  />
                </th>
                <th>User</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Role</th>
                <th>Sessions</th>
                <th>Joined</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No users found matching your criteria.</td>
                </tr>
              ) : (
                filteredUsers.map((entry) => (
                  <tr key={entry.id} onClick={() => onSelectUser(entry)} style={{ cursor: 'pointer' }}>
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.includes(entry.id)} onChange={() => toggleSelection(entry.id)} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '12px', color: 'var(--accent)' }}>
                          {entry.name?.charAt(0) || entry.email?.charAt(0)}
                        </div>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: '14px' }}>{entry.name || 'No Name'}</p>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{entry.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${entry.suspendedAt ? 'status-inactive' : 'status-active'}`} style={{ background: entry.suspendedAt ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: entry.suspendedAt ? 'var(--danger)' : 'var(--success)' }}>
                        <div className={`dot ${entry.suspendedAt ? 'dot-inactive' : 'dot-active'}`} /> {entry.suspendedAt ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td><span className={`badge badge-${entry.plan?.toLowerCase()}`} style={{ fontSize: '11px', textTransform: 'uppercase' }}>{entry.plan}</span></td>
                    <td><span style={{ fontSize: '11px', fontWeight: 700, color: (entry.adminRole || 'user') !== 'user' ? 'var(--accent)' : 'var(--text-secondary)' }}>{formatAdminRoleLabel(entry.adminRole)}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{formatMetricNumber(entry.activeSessionCount || 0)}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{formatAbsoluteDate(entry.joined)}</td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={(event) => { event.stopPropagation(); onSelectUser(entry); }}>
                          <Activity size={14} /> Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>Showing 1 to {filteredUsers.length} of {users.length} users</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn" disabled><ChevronRight size={16} /></button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Directory is fully loaded</div>
        </div>
      </div>
    </div>
  );
};

const DatabaseView = ({ stats, onRunMigration, onSelectTable, onChangePage }) => {
  const selectedTable = stats?.selectedTable;
  const previewColumns = selectedTable?.columns?.map((column) => column.name) || [];
  const previewRows = selectedTable?.previewRows || [];

  return (
    <div className="fade-in">
      <SectionHeader title="Database Explorer" description="Read-only schema, row preview, and maintenance visibility for production tables." breadcrumbs={['Database']} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <button className="btn btn-primary" style={{ gap: '8px' }} onClick={onRunMigration}>
          <RefreshCw size={14} /> Run Admin Workspace Migration
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={Database} label="Tables" value={formatMetricNumber(stats?.summary?.totalTables || 0)} trend="Catalog size" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={HardDrive} label="Storage Used" value={stats?.summary?.totalSize || '0 B'} trend="Current database size" trendUp={true} sparklineColor="#10b981" />
        <SummaryCard icon={ActivityIcon} label="Avg Query Latency" value={`${formatMetricNumber(stats?.summary?.avgQueryLatencyMs || 0)} ms`} trend="Recent request profile" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={Server} label="Connections" value={formatMetricNumber(stats?.summary?.activeConnections || 0)} trend="Current sessions" trendUp={true} sparklineColor="#f59e0b" />
      </div>

      <div className="db-grid">
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Tables</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(stats?.tables || []).map((table) => (
              <button
                key={table.name}
                type="button"
                className={`db-list-item ${selectedTable?.name === table.name ? 'active' : ''}`}
                onClick={() => onSelectTable(table.name)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={14} />
                  <span>{table.name}</span>
                </div>
                <span style={{ fontSize: '11px', opacity: 0.7 }}>{formatMetricNumber(table.rows)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{selectedTable?.name || 'Select a table'}</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{selectedTable ? `${formatMetricNumber(selectedTable.rows)} rows • ${selectedTable.schemaSummary?.tableSize || 'Unknown size'}` : 'Choose a table from the list to inspect schema and rows.'}</p>
            </div>
            {selectedTable ? (
              <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => navigator.clipboard?.writeText(selectedTable.queryPreview || '')}>
                Copy Query
              </button>
            ) : null}
          </div>

          <div style={{ padding: '0 20px 20px 20px' }}>
            <div className="db-tabs">
              <div className="db-tab active">Data</div>
              <div className="db-tab">Schema</div>
              <div className="db-tab">Indexes</div>
              <div className="db-tab">Query Preview</div>
            </div>

            <div className="table-container" style={{ margin: '0 -20px' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    {previewColumns.map((column) => <th key={column}>{column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(previewColumns.length, 1)} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>No preview rows returned for this table.</td>
                    </tr>
                  ) : (
                    previewRows.map((row, index) => (
                      <tr key={`${selectedTable?.name}-${index}`}>
                        {previewColumns.map((column) => (
                          <td key={`${selectedTable?.name}-${index}-${column}`} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                            {typeof row[column] === 'object' && row[column] !== null ? JSON.stringify(row[column]) : String(row[column] ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selectedTable ? (
              <div className="pagination" style={{ borderTop: '1px solid var(--border)', margin: '0 -20px', padding: '16px 20px' }}>
                <div>{selectedTable.queryPreview}</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="pagination-btn" disabled={selectedTable.page <= 1} onClick={() => onChangePage(Math.max(1, selectedTable.page - 1))}><ChevronLeft size={16} /></button>
                  <button className="pagination-btn active">{selectedTable.page}</button>
                  <button className="pagination-btn" disabled={selectedTable.page >= selectedTable.totalPages} onClick={() => onChangePage(Math.min(selectedTable.totalPages, selectedTable.page + 1))}><ChevronRight size={16} /></button>
                </div>
                <div>{formatMetricNumber(selectedTable.rows)} total rows</div>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ padding: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Schema Summary</h4>
            <div className="prop-list">
              {[
                { label: 'Primary Key', value: selectedTable?.schemaSummary?.primaryKey || 'N/A' },
                { label: 'Indexes', value: selectedTable?.schemaSummary?.indexCount || 0 },
                { label: 'Foreign Keys', value: selectedTable?.schemaSummary?.foreignKeys || 0 },
                { label: 'Row Count', value: formatMetricNumber(selectedTable?.schemaSummary?.rowCount || 0) },
                { label: 'Table Size', value: selectedTable?.schemaSummary?.tableSize || 'N/A' },
              ].map((item) => (
                <div key={item.label} className="prop-item">
                  <span className="prop-label">{item.label}</span>
                  <span className="prop-value">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Columns</h4>
            <div className="prop-list">
              {(selectedTable?.columns || []).slice(0, 8).map((column) => (
                <div key={column.name} className="prop-item">
                  <span className="prop-label">{column.name}</span>
                  <span className="prop-value">{column.dataType}{column.isNullable === 'NO' ? ' • required' : ''}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Indexes</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(selectedTable?.indexes || []).length ? selectedTable.indexes.map((index) => (
                <div key={index.name} style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600 }}>{index.name}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{index.definition}</p>
                </div>
              )) : <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No index data available.</p>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(260), gap: '20px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Backup Window</h4>
          <div className="prop-list">
            <div className="prop-item"><span className="prop-label">Last Backup</span><span className="prop-value">{formatAbsoluteDateTime(stats?.summary?.lastBackup)}</span></div>
            <div className="prop-item"><span className="prop-label">Next Backup</span><span className="prop-value">{formatAbsoluteDateTime(stats?.summary?.nextBackup)}</span></div>
            <div className="prop-item"><span className="prop-label">Availability</span><span className="prop-value">{stats?.summary?.uptime || 'N/A'}</span></div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Replication</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(stats?.replication || []).map((node) => (
              <div key={node.label} className="prop-item">
                <span className="prop-label">{node.label}</span>
                <span className="prop-value">{node.value} • {node.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Recent Maintenance</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(stats?.maintenance || []).map((event) => (
              <div key={`${event.task}-${event.time}`} className="prop-item">
                <span className="prop-label">{event.task}</span>
                <span className="prop-value">{formatRelativeTime(event.time)} • {event.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Migration History</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(stats?.migrationHistory || []).length ? stats.migrationHistory.map((event, index) => (
              <div key={`${event.createdAt}-${index}`} style={{ padding: '10px 12px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <p style={{ fontSize: '12px', fontWeight: 600 }}>{event.force ? 'Forced admin migration' : 'Admin migration'}</p>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatRelativeTime(event.createdAt)}</span>
                </div>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{event.reason}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>Triggered by {event.actor}</p>
              </div>
            )) : <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No recent migrations recorded.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

const AuditTrailView = ({ auditData, onSelectEvent, onOpenUser, seedQuery = '' }) => {
  const savedViewsKey = 'zenin_admin_audit_views';
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [savedViews, setSavedViews] = useState(() => parseStoredJson(savedViewsKey, []));

  useEffect(() => {
    persistStoredJson(savedViewsKey, savedViews);
  }, [savedViews]);

  useEffect(() => {
    if (seedQuery) {
      setQuery(seedQuery);
    }
  }, [seedQuery]);

  const rows = auditData?.rows || [];
  const filteredRows = rows.filter((entry) => {
    const search = query.toLowerCase();
    const matchesSearch = !search
      || String(entry.action || '').toLowerCase().includes(search)
      || String(entry.target || entry.targetEmail || '').toLowerCase().includes(search)
      || String(entry.actor || entry.adminEmail || '').toLowerCase().includes(search)
      || String(entry.requestId || '').toLowerCase().includes(search);
    const matchesSeverity = severityFilter === 'all' || String(entry.severity || '').toLowerCase() === severityFilter;
    return matchesSearch && matchesSeverity;
  });

  const saveCurrentView = () => {
    const name = window.prompt('Name this saved audit view:', '');
    if (!name) return;
    setSavedViews((prev) => [...prev.filter((entry) => entry.name !== name), { name, query, severityFilter }]);
  };

  const applyView = (view) => {
    setQuery(view.query || '');
    setSeverityFilter(view.severityFilter || 'all');
  };

  return (
    <div className="fade-in">
      <SectionHeader title="Audit Trail" description="Reasoned, request-correlated history for sensitive admin actions." breadcrumbs={['Audit Trail']} />

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={History} label="Loaded Events" value={formatMetricNumber(auditData?.total || filteredRows.length)} trend="Current audit window" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={ShieldAlert} label="Critical Events" value={formatMetricNumber(filteredRows.filter((entry) => entry.severity === 'critical').length)} trend="Suspensions and deletions" trendUp={true} sparklineColor="#ef4444" />
        <SummaryCard icon={UserCheck} label="Role Changes" value={formatMetricNumber(filteredRows.filter((entry) => /ROLE/.test(entry.action)).length)} trend="Governance changes" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={Download} label="Reasoned Actions" value={formatMetricNumber(filteredRows.filter((entry) => entry.reason).length)} trend="Captured intent" trendUp={true} sparklineColor="#10b981" />
      </div>

      <div className="card">
        <div className="filter-bar" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: '240px', maxWidth: 'none' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" className="search-input" placeholder="Search actions, targets, request IDs..." value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: '40px' }} />
          </div>
          <select className="filter-select" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="all">All Severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={saveCurrentView}>Save View</button>
        </div>

        {savedViews.length ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '0 24px 16px 24px' }}>
            {savedViews.map((view) => (
              <button key={view.name} type="button" className="btn btn-secondary" style={{ height: '30px', fontSize: '11px' }} onClick={() => applyView(view)}>
                {view.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
                <th>Severity</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No audit events matched this filter.</td>
                </tr>
              ) : (
                filteredRows.map((event) => (
                  <tr key={event.id} onClick={() => onSelectEvent(event)} style={{ cursor: 'pointer' }}>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{formatAbsoluteDateTime(event.createdAt)}</td>
                    <td style={{ fontSize: '13px' }}>{event.actor || event.adminEmail || 'System'}</td>
                    <td style={{ fontWeight: 500, fontSize: '13px' }}>{event.action}</td>
                    <td style={{ fontSize: '13px' }}>
                      {event.targetUserId ? (
                        <button type="button" className="inline-link-btn" onClick={(clickEvent) => { clickEvent.stopPropagation(); onOpenUser(event.targetUserId); }}>
                          {event.target || event.targetEmail || `User ${event.targetUserId}`}
                        </button>
                      ) : (event.target || event.targetEmail || 'Workspace')}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{event.reason || 'No reason recorded'}</td>
                    <td><span className={`badge badge-${String(event.severity || 'low').toLowerCase()}`}>{String(event.severity || 'low').toUpperCase()}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{event.requestId || 'N/A'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>Showing {filteredRows.length} of {auditData?.total || filteredRows.length} audit events</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn" disabled><ChevronRight size={16} /></button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Loaded from the live audit store</div>
        </div>
      </div>
    </div>
  );
};

const RevenueCatCustomerSnapshot = ({ snapshot, compact = false }) => {
  if (!snapshot?.configured) {
    return (
      <p style={{ fontSize: compact ? '12px' : '13px', color: 'var(--text-muted)' }}>
        RevenueCat admin access is not configured on the backend yet.
      </p>
    );
  }

  if (!snapshot?.found || !snapshot?.customer) {
    return (
      <p style={{ fontSize: compact ? '12px' : '13px', color: 'var(--text-muted)' }}>
        No RevenueCat customer was found for this record yet.
      </p>
    );
  }

  const customer = snapshot.customer;
  const subscriptions = snapshot.subscriptions || [];
  const entitlements = snapshot.activeEntitlements || [];
  const invoices = snapshot.invoices || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '12px' : '14px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 1fr', gap: '12px' }}>
        <div style={{ padding: compact ? '12px' : '14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Customer ID</p>
          <p style={{ fontSize: compact ? '12px' : '13px', fontWeight: 600, fontFamily: 'monospace', wordBreak: 'break-all' }}>{customer.id}</p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            Matched via {formatStatusLabel(snapshot.resolution || 'direct')}
          </p>
        </div>
        <div style={{ padding: compact ? '12px' : '14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Profile</p>
          <p style={{ fontSize: compact ? '12px' : '13px', fontWeight: 600 }}>{customer.displayName || customer.email || 'Unnamed customer'}</p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
            {customer.email || 'No email'}{customer.createdAt ? ` • Created ${formatAbsoluteDate(customer.createdAt)}` : ''}
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
        <div style={{ padding: compact ? '10px 12px' : '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Entitlements</p>
          <p style={{ fontSize: compact ? '16px' : '18px', fontWeight: 700 }}>{formatMetricNumber(entitlements.length)}</p>
        </div>
        <div style={{ padding: compact ? '10px 12px' : '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Subscriptions</p>
          <p style={{ fontSize: compact ? '16px' : '18px', fontWeight: 700 }}>{formatMetricNumber(subscriptions.length)}</p>
        </div>
        <div style={{ padding: compact ? '10px 12px' : '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Invoices</p>
          <p style={{ fontSize: compact ? '16px' : '18px', fontWeight: 700 }}>{formatMetricNumber(invoices.length)}</p>
        </div>
      </div>

      {customer.managementUrl ? (
        <div>
          <a className="btn btn-secondary" href={customer.managementUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', height: compact ? '32px' : '34px' }}>
            Open Customer Portal
          </a>
        </div>
      ) : null}

      {entitlements.length ? (
        <div>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>Entitlements</p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {entitlements.map((item) => (
              <span key={`${customer.id}-${item.id}`} className="badge badge-success" style={{ fontSize: '10px' }}>
                {item.id}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {subscriptions.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Subscriptions</p>
          {subscriptions.slice(0, compact ? 2 : 4).map((item) => (
            <div key={`${customer.id}-${item.id}`} style={{ padding: compact ? '10px 12px' : '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <div>
                <p style={{ fontSize: compact ? '12px' : '13px', fontWeight: 600 }}>{item.productId}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {formatStatusLabel(item.status)} • {formatStatusLabel(item.store)}
                </p>
              </div>
              <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>
                <p>{item.currentPeriodEndsAt ? formatAbsoluteDate(item.currentPeriodEndsAt) : 'No renewal date'}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {invoices.length && !compact ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Recent Invoices</p>
          {invoices.slice(0, 3).map((invoice) => (
            <div key={`${customer.id}-${invoice.id}`} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{invoice.id}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {formatStatusLabel(invoice.status)} • {formatAbsoluteDate(invoice.createdAt)}
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{formatMoneyAmount(invoice.amount, invoice.currency)}</p>
                {invoice.hostedUrl ? (
                  <a className="btn btn-secondary" href={invoice.hostedUrl} target="_blank" rel="noreferrer" style={{ fontSize: '12px', height: '32px' }}>
                    Open
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const BillingView = ({ stats }) => {
  const adminUi = useAdminUi();
  const summary = stats?.summary || {};
  const providerStatus = stats?.providerStatus || {};
  const revenueCat = stats?.revenueCat || {};
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const handleRevenueCatLookup = async () => {
    const trimmed = lookupQuery.trim();
    if (!trimmed) return;
    setLookupLoading(true);
    setLookupError('');
    try {
      const payload = await adminFetch(`/revenuecat/customers/lookup?query=${encodeURIComponent(trimmed)}`);
      setLookupResult(payload);
    } catch (error) {
      setLookupResult(null);
      setLookupError(error.message || 'RevenueCat lookup failed.');
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="fade-in">
      <SectionHeader title="Billing & Subscriptions" description="Derived revenue, invoice, and provider health from the current production workspace." breadcrumbs={['Billing']} />

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={BillingIcon} label="MRR" value={formatCurrency(summary.mrr || 0)} trend="Current plan revenue" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={Calendar} label="Active Subscriptions" value={formatMetricNumber(summary.activeSubscriptions || 0)} trend="Paid workspaces" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={AlertCircle} label="Failed Payments" value={formatMetricNumber(summary.failedPayments || 0)} trend="Needs follow-up" trendUp={false} sparklineColor="#ef4444" />
        <SummaryCard icon={BillingIcon} label="Outstanding" value={formatCurrency(summary.outstandingAmount || 0)} trend="Open invoice balance" trendUp={true} sparklineColor="#f59e0b" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px', marginBottom: '24px' }}>
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>{providerStatus.name || 'Billing Provider'}</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>{providerStatus.note || 'No provider metadata available.'}</p>
            </div>
            <span className={`badge badge-${providerStatus.status === 'connected' || providerStatus.status === 'active' ? 'success' : 'warning'}`}>{String(providerStatus.status || 'unknown').toUpperCase()}</span>
          </div>
          <div className="prop-list">
            <div className="prop-item"><span className="prop-label">Total Customers</span><span className="prop-value">{formatMetricNumber(summary.totalCustomers || 0)}</span></div>
            <div className="prop-item"><span className="prop-label">Average Revenue Per User</span><span className="prop-value">{formatCurrency(summary.avgRevenuePerUser || 0)}</span></div>
            <div className="prop-item"><span className="prop-label">Last Sync</span><span className="prop-value">{formatAbsoluteDateTime(providerStatus.lastSyncAt)}</span></div>
          </div>
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: '20px', height: '40px' }} onClick={() => adminUi.downloadJson('zenin-billing-provider.json', providerStatus, 'Provider snapshot exported.', 'The current billing provider state was downloaded as JSON.')}>
            Export Provider State
          </button>
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>Plan Mix</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Object.entries(stats?.plans || {}).map(([plan, count]) => {
              const total = summary.totalCustomers || 1;
              const percent = Math.round((Number(count || 0) / total) * 100);
              return (
                <div key={plan}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '6px' }}>
                    <span>{plan}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatMetricNumber(count)} • {percent}%</span>
                  </div>
                  <div className="usage-bar-container">
                    <div className="usage-bar" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', gap: '16px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>RevenueCat</h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Server-side RevenueCat status, catalog health, and customer inspection.
              </p>
            </div>
            <span className={`badge badge-${revenueCat?.providerStatus?.status === 'active' || revenueCat?.providerStatus?.status === 'connected' ? 'success' : 'warning'}`}>
              {String(revenueCat?.providerStatus?.status || 'unknown').toUpperCase()}
            </span>
          </div>
          <div className="prop-list">
            <div className="prop-item"><span className="prop-label">Project</span><span className="prop-value">{revenueCat?.providerStatus?.projectIdPreview || 'missing'}</span></div>
            <div className="prop-item"><span className="prop-label">Secret Key</span><span className="prop-value">{revenueCat?.providerStatus?.secretKeyPreview || 'missing'}</span></div>
            <div className="prop-item"><span className="prop-label">Offerings</span><span className="prop-value">{formatMetricNumber(revenueCat?.summary?.offeringsCount || 0)}</span></div>
            <div className="prop-item"><span className="prop-label">Entitlements</span><span className="prop-value">{formatMetricNumber(revenueCat?.summary?.entitlementsCount || 0)}</span></div>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '16px' }}>
            {revenueCat?.providerStatus?.note || 'RevenueCat configuration state is unavailable.'}
          </p>
          <div style={{ marginTop: '16px', display: 'grid', gap: '10px' }}>
            <div style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Catalog</p>
              <p style={{ fontSize: '13px', margin: '6px 0 0' }}>
                {(revenueCat?.offerings || []).length
                  ? revenueCat.offerings.map((item) => item.id).join(', ')
                  : 'No offerings returned.'}
              </p>
            </div>
            <div style={{ padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Entitlement IDs</p>
              <p style={{ fontSize: '13px', margin: '6px 0 0' }}>
                {(revenueCat?.entitlements || []).length
                  ? revenueCat.entitlements.map((item) => item.id).join(', ')
                  : 'No entitlements returned.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: 600 }}>RevenueCat Customer Lookup</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>
              Search by Zenin app user ID, RevenueCat customer ID, or checkout email to inspect entitlements and billing state.
            </p>
          </div>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '12px' }}
            onClick={() => adminUi.downloadJson('zenin-revenuecat-summary.json', revenueCat, 'RevenueCat summary exported.', 'The RevenueCat admin snapshot was downloaded as JSON.')}
          >
            Export RevenueCat
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '20px' }}>
          <div style={{ padding: '18px', borderRadius: '14px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Recent Customers</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(revenueCat?.recentCustomers || []).length ? revenueCat.recentCustomers.map((customer) => (
                <div key={customer.id} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>{customer.displayName || customer.email || customer.id}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontFamily: 'monospace', wordBreak: 'break-all' }}>{customer.id}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px' }}>
                    {customer.createdAt ? `Created ${formatAbsoluteDate(customer.createdAt)}` : 'Creation date unavailable'}
                  </p>
                </div>
              )) : (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No customers were returned in the latest RevenueCat snapshot.</p>
              )}
            </div>
          </div>

          <div style={{ padding: '18px', borderRadius: '14px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
            <h4 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Lookup</h4>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
              <input
                type="text"
                value={lookupQuery}
                onChange={(event) => setLookupQuery(event.target.value)}
                placeholder="App user ID, customer ID, or email"
                style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', padding: '10px 12px', color: 'var(--text-primary)' }}
              />
              <button
                className="btn btn-primary"
                style={{ fontSize: '12px' }}
                onClick={handleRevenueCatLookup}
                disabled={!revenueCat?.configured || lookupLoading || !lookupQuery.trim()}
              >
                {lookupLoading ? 'Looking up...' : 'Lookup'}
              </button>
            </div>
            {lookupError ? <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: '12px' }}>{lookupError}</p> : null}
            {lookupResult ? (
              <RevenueCatCustomerSnapshot snapshot={lookupResult} compact={true} />
            ) : (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Lookup works best with the same Zenin user ID used as the RevenueCat App User ID in the main app.
              </p>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px' }}>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recent Invoices</h3>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => adminUi.downloadJson('zenin-billing-invoices.json', stats?.invoices || [], 'Invoices exported.', 'The current invoice ledger was downloaded as JSON.')}>
              Export
            </button>
          </div>
          <div className="table-container" style={{ margin: 0 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Amount</th>
                  <th>Issued</th>
                </tr>
              </thead>
              <tbody>
                {(stats?.invoices || []).slice(0, 8).map((invoice) => (
                  <tr key={invoice.id}>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{invoice.id}</td>
                    <td style={{ fontSize: '13px', fontWeight: 500 }}>{invoice.customer}</td>
                    <td><span className={`badge badge-${String(invoice.status || 'pending').toLowerCase()}`}>{String(invoice.status || 'pending').toUpperCase()}</span></td>
                    <td style={{ fontSize: '13px', fontWeight: 600 }}>{formatCurrency(invoice.amount)}</td>
                    <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{formatAbsoluteDate(invoice.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
            <div style={{ paddingBottom: '12px', borderBottom: '2px solid var(--accent)', color: 'var(--accent)', fontSize: '14px', fontWeight: 600 }}>Transactions</div>
            <div style={{ paddingBottom: '12px', color: 'var(--text-muted)', fontSize: '14px', display: 'flex', alignItems: 'center' }}>
              Dunning Alerts <span className="dunning-badge">{(stats?.dunningAlerts || []).length}</span>
            </div>
          </div>

          <div className="transaction-list">
            {(stats?.transactions || []).map((tx) => (
              <div key={tx.id} className="transaction-item">
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: `1px solid ${tx.status === 'received' ? 'var(--success)' : '#ef4444'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {tx.status === 'received' ? <CheckCircle2 size={14} color="var(--success)" /> : <AlertCircle size={14} color="#ef4444" />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: '13px', fontWeight: 500 }}>{tx.customer}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{tx.invoiceId}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>{formatCurrency(tx.amount)}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{formatRelativeTime(tx.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '24px', marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recent Subscription Changes</h3>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => adminUi.downloadJson('zenin-subscription-changes.json', stats?.subscriptionChanges || [], 'Subscription changes exported.', 'The latest billing change history was downloaded as JSON.')}>
            Export
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {(stats?.subscriptionChanges || []).length ? stats.subscriptionChanges.map((change) => (
            <div key={change.id} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)', display: 'flex', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{change.customer}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {String(change.oldPlan || 'starter').toUpperCase()} to {String(change.newPlan || 'starter').toUpperCase()}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{change.reason || 'No reason recorded'}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '12px', fontWeight: 600 }}>{change.actor}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{formatRelativeTime(change.createdAt)}</p>
              </div>
            </div>
          )) : (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No recent subscription changes were recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
};

const LogsView = ({ logsData, onRefresh, onSelectLog, onExportLogs, onCreateAlert, onResolveAlert, seedQuery = '' }) => {
  const savedViewsKey = 'zenin_admin_log_views';
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [savedViews, setSavedViews] = useState(() => parseStoredJson(savedViewsKey, []));

  useEffect(() => {
    persistStoredJson(savedViewsKey, savedViews);
  }, [savedViews]);

  useEffect(() => {
    if (seedQuery) {
      setQuery(seedQuery);
    }
  }, [seedQuery]);

  const rows = logsData?.rows || [];
  const filteredRows = rows.filter((row) => {
    const search = query.toLowerCase();
    const matchesSearch = !search
      || String(row.message || '').toLowerCase().includes(search)
      || String(row.endpoint || '').toLowerCase().includes(search)
      || String(row.requestId || '').toLowerCase().includes(search);
    const matchesLevel = levelFilter === 'all' || normalizeLogLevel(row.level) === levelFilter;
    const matchesService = serviceFilter === 'all' || String(row.service || '') === serviceFilter;
    return matchesSearch && matchesLevel && matchesService;
  });

  const saveCurrentView = () => {
    const name = window.prompt('Name this saved log view:', '');
    if (!name) return;
    setSavedViews((prev) => [...prev.filter((entry) => entry.name !== name), { name, query, levelFilter, serviceFilter }]);
  };

  const applyView = (view) => {
    setQuery(view.query || '');
    setLevelFilter(view.levelFilter || 'all');
    setServiceFilter(view.serviceFilter || 'all');
  };

  return (
    <div className="fade-in">
      <SectionHeader
        title="System Logs"
        description="Monitor events, incidents, and platform activity in real time."
        breadcrumbs={['System Logs']}
        onAction={(type) => {
          if (type === 'secondary') {
            onExportLogs(filteredRows);
            return;
          }
          onCreateAlert();
        }}
      />
      
      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={AlertCircle} label="Error Rate" value={`${logsData?.metrics?.errorRate || 0}%`} trend="Last 7 days" trendUp={false} sparklineColor="#ef4444" />
        <SummaryCard icon={ZapOff} label="Failed Requests" value={formatMetricNumber(logsData?.metrics?.failedRequests || 0)} trend="Status >= 400" trendUp={false} sparklineColor="#f59e0b" />
        <SummaryCard icon={Lock} label="Auth Failures" value={formatMetricNumber(logsData?.metrics?.authFailures || 0)} trend="Auth service failures" trendUp={false} sparklineColor="#a855f7" />
        <SummaryCard icon={ActivityIcon} label="p95 Latency" value={`${formatMetricNumber(logsData?.metrics?.p95LatencyMs || 0)} ms`} trend="Observed requests" trendUp={true} sparklineColor="#3b82f6" />
      </div>

      <div className="card">
        <div className="filter-bar" style={{ gap: '12px', flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1 }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" className="search-input" placeholder="Search logs..." value={query} onChange={(event) => setQuery(event.target.value)} style={{ paddingLeft: '40px' }} />
          </div>
          <select className="filter-select" value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)}>
            <option value="all">Level (All)</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select className="filter-select" value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)}>
            <option value="all">Service (All)</option>
            {(logsData?.services || []).map((service) => <option key={service} value={service}>{service}</option>)}
          </select>
          <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={saveCurrentView}>Save View</button>
          <button type="button" className="live-toggle" onClick={onRefresh}>
            <div className="live-dot" />
            <span>Live</span>
            <div style={{ width: '32px', height: '16px', background: 'var(--accent)', borderRadius: '8px', position: 'relative', cursor: 'pointer', marginLeft: '4px' }}>
              <div style={{ width: '12px', height: '12px', background: 'white', borderRadius: '50%', position: 'absolute', right: '2px', top: '2px' }} />
            </div>
          </button>
        </div>

        {savedViews.length ? (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', padding: '0 24px 16px 24px' }}>
            {savedViews.map((view) => (
              <button key={view.name} type="button" className="btn btn-secondary" style={{ height: '30px', fontSize: '11px' }} onClick={() => applyView(view)}>
                {view.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="table-container" style={{ margin: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Timestamp <ChevronDown size={12} style={{ display: 'inline' }} /></th>
                <th>Level</th>
                <th>Service</th>
                <th>Endpoint</th>
                <th>Message</th>
                <th>Request ID</th>
                <th>User ID</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((log) => (
                <tr key={log.id} onClick={() => onSelectLog(log)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{formatAbsoluteDateTime(log.createdAt)}</td>
                  <td><span className={`badge badge-${normalizeLogLevel(log.level)}`} style={{ fontSize: '11px', padding: '2px 8px' }}>{String(log.level || 'info').toUpperCase()}</span></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{log.service}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{log.endpoint}</td>
                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' }}>{log.message}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{log.requestId}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{log.userId || log.ipAddress}</td>
                  <td style={{ fontWeight: 500, fontSize: '12px', color: normalizeLogLevel(log.level) === 'error' ? '#ef4444' : 'inherit' }}>{log.durationMs == null ? 'N/A' : `${log.durationMs} ms`}</td>
                  <td><MoreVertical size={14} color="var(--text-muted)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>Showing {filteredRows.length} of {logsData?.total || filteredRows.length} logs</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn" disabled><ChevronRight size={16} /></button>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Live request feed</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px', marginTop: '24px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Error Trend</h3>
            <select className="search-input" style={{ width: '120px', padding: '4px' }}><option>Last 7 days</option></select>
          </div>
          <div style={{ height: '280px' }}>
            <Line 
              data={{
                labels: (logsData?.errorTrend || []).map((item) => item.label),
                datasets: [{
                  label: 'Errors',
                  data: (logsData?.errorTrend || []).map((item) => item.errorCount),
                  borderColor: '#ef4444',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  fill: true,
                  tension: 0.4
                }]
              }}
              options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } } } }}
            />
          </div>
          {(logsData?.deployMarkers || []).length ? (
            <div style={{ marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {logsData.deployMarkers.map((marker, index) => (
                <span key={`${marker.createdAt}-${index}`} className="badge badge-info" style={{ fontSize: '10px' }}>
                  {formatAbsoluteDate(marker.createdAt)} • {marker.actor}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Slow Endpoints</h3>
            <select className="search-input" style={{ width: '120px', padding: '4px' }}><option>Last 24 hours</option></select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(logsData?.slowEndpoints || []).map((item) => (
              <div key={item.endpoint}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{item.endpoint}</span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg: {item.avgMs} ms</span>
                    <span style={{ fontWeight: 600 }}>95th: {item.p95Ms} ms</span>
                  </div>
                </div>
                <div className="performance-bar-container">
                  <div className="performance-bar" style={{ width: `${item.pct}%`, background: item.pct > 70 ? '#ef4444' : item.pct > 50 ? '#f59e0b' : 'var(--accent)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px', marginTop: '24px' }}>
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Active Alerts</h3>
            <span className="badge badge-warning">{formatMetricNumber((logsData?.alerts || []).length)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(logsData?.alerts || []).length ? logsData.alerts.map((alert) => (
              <div key={alert.id} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 600 }}>{alert.title}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{alert.query || alert.service || 'No query configured'}</p>
                  </div>
                  <span className={`badge badge-${normalizeLogLevel(alert.severity)}`}>{String(alert.severity || 'warning').toUpperCase()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Triggered {formatRelativeTime(alert.lastTriggeredAt || alert.createdAt)}</span>
                  <button className="btn btn-secondary" style={{ fontSize: '11px', height: '30px' }} onClick={() => onResolveAlert?.(alert)}>
                    Mark Resolved
                  </button>
                </div>
              </div>
            )) : (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No active alert rules are currently open.</p>
            )}
          </div>
        </div>

        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Open Incidents</h3>
            <span className="badge badge-critical">{formatMetricNumber((logsData?.incidents || []).length)}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {(logsData?.incidents || []).length ? logsData.incidents.map((incident) => (
              <div key={incident.id} style={{ padding: '14px 16px', borderRadius: '12px', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 600 }}>{incident.title}</p>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{incident.requestId || 'No request correlation recorded'}</p>
                  </div>
                  <span className={`badge badge-${normalizeLogLevel(incident.severity)}`}>{String(incident.severity || 'warning').toUpperCase()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Opened {formatRelativeTime(incident.createdAt)}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{incident.createdBy || 'System'}</span>
                </div>
              </div>
            )) : (
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No open incidents are currently tracked.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const SettingsView = ({ onRevokeAllSessions }) => {
  const adminUi = useAdminUi();
  const [settingsDraft, setSettingsDraft] = useState({
    compactDensity: true,
    enforceTwoFactor: true,
    emailAlerts: true,
    systemIncidentAlerts: true,
    failedLoginAlerts: true,
    billingNotices: true,
    weeklySummary: true,
  });

  const toggleSetting = (key) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
  <div className="fade-in">
    <SectionHeader title="Settings" description="Manage platform preferences, security, integrations, and defaults." breadcrumbs={['Settings']} />
    
    <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(320), gap: '24px' }}>
      {/* 1. Organization Profile */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>1</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Organization Profile</h3>
        </div>
        <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
          <div style={{ width: '100px', textAlign: 'center' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '12px', background: 'var(--bg-app)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
              <Shield size={32} color="var(--accent)" />
            </div>
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: '11px', padding: '6px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Logo uploader opened.', 'Asset uploads can be connected here without changing the settings layout.')}>Change Logo</button>
            <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>PNG, JPG or SVG Max 2MB</p>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Company Name</p>
              <input type="text" className="search-input" defaultValue="Zenin Inc." style={{ height: '38px' }} />
            </div>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Support Email</p>
              <input type="text" className="search-input" defaultValue="support@zenin.com" style={{ height: '38px' }} />
            </div>
            <div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Admin Contact</p>
              <input type="text" className="search-input" defaultValue="admin@zenin.com" style={{ height: '38px' }} />
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Timezone</p>
            <div style={{ position: 'relative' }}>
              <select className="search-input" style={{ fontSize: '12px', height: '38px', width: '100%' }}>
                <option>(UTC-07:00) Pacific Time (US & Canada)</option>
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Default Currency</p>
            <div style={{ position: 'relative' }}>
              <select className="search-input" style={{ fontSize: '12px', height: '38px', width: '100%' }}>
                <option>USD \u2014 US Dollar</option>
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Admin Preferences */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>2</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Admin Preferences</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Default Landing Page</span>
            <div style={{ position: 'relative', width: '160px' }}>
              <select className="search-input" style={{ width: '100%', padding: '6px 12px', height: '32px', fontSize: '12px' }}><option>Overview</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Theme Mode</span>
            <div style={{ display: 'flex', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px', padding: '2px' }}>
              <div style={{ padding: '6px 10px', borderRadius: '6px', color: 'var(--text-muted)' }}><Sun size={14} /></div>
              <div style={{ padding: '6px 10px', borderRadius: '6px', background: 'var(--accent)', color: 'white' }}><Moon size={14} /></div>
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Compact Density</span>
            <Toggle active={settingsDraft.compactDensity} onClick={() => toggleSetting('compactDensity')} />
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Date Format</span>
            <div style={{ position: 'relative', width: '160px' }}>
              <select className="search-input" style={{ width: '100%', padding: '6px 12px', height: '32px', fontSize: '12px' }}><option>May 29, 2025 (MMM DD, YYYY)</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Language</span>
            <div style={{ position: 'relative', width: '160px' }}>
              <select className="search-input" style={{ width: '100%', padding: '6px 12px', height: '32px', fontSize: '12px' }}><option>English (US)</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* 3. Security & Access */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>3</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Security & Access</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Lock size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Enforce Two-Factor Authentication</span>
            </div>
            <Toggle active={settingsDraft.enforceTwoFactor} onClick={() => toggleSetting('enforceTwoFactor')} />
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Shield size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Password Policy</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
              Strong (12+ chars) <ChevronRight size={16} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Clock size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Session Timeout</span>
            </div>
            <div style={{ position: 'relative', width: '120px' }}>
              <select className="search-input" style={{ width: '100%', padding: '4px 10px', height: '28px', fontSize: '12px' }}><option>30 minutes</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Globe size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Allowed IP Addresses</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
              3 IPs configured <ChevronRight size={16} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <UserCheck size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Single Sign-On (SSO)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontSize: '12px', fontWeight: 600 }}>
              Enabled <ChevronRight size={16} color="var(--text-muted)" />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Users size={16} color="var(--text-muted)" />
              <span style={{ fontSize: '13px' }}>Role Permissions</span>
            </div>
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Role editor opened.', 'The permissions matrix can be layered in here next.')}>Manage Roles</button>
          </div>
        </div>
      </div>

      {/* 4. Notifications */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>4</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Notifications</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            { icon: Mail, label: 'Email Alerts', desc: 'General system and account notifications', key: 'emailAlerts' },
            { icon: AlertTriangle, label: 'System Incident Alerts', desc: 'Critical system incidents and outages', key: 'systemIncidentAlerts' },
            { icon: Lock, label: 'Failed Login Alerts', desc: 'Get notified of suspicious login attempts', key: 'failedLoginAlerts' },
            { icon: BillingIcon, label: 'Billing Notices', desc: 'Invoices, payments, and billing updates', key: 'billingNotices' },
            { icon: BarChart3, label: 'Weekly Summary', desc: 'Receive a weekly activity summary', key: 'weeklySummary' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <item.icon size={16} color="var(--text-muted)" style={{ marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>{item.label}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{item.desc}</p>
                </div>
              </div>
              <Toggle active={settingsDraft[item.key]} onClick={() => toggleSetting(item.key)} />
            </div>
          ))}
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px', height: '38px', fontSize: '12px', color: 'var(--accent)', borderColor: 'var(--accent-soft)' }} onClick={() => adminUi.showPlaceholder('Recipient manager opened.', 'Notification recipients can be connected here without changing the surrounding settings flow.')}>Manage Notification Recipients</button>
        </div>
      </div>

      {/* 5. API & Webhooks */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>5</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>API & Webhooks</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Key size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>API Key Management</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>View and manage API keys</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('API key manager opened.', 'Key rotation and scoped permissions can be wired in here next.')}>Manage Keys</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <LinkIcon size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Webhook Endpoint</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>https://hooks.zenin.com/webhook</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }} onClick={() => adminUi.copyText('https://hooks.zenin.com/webhook', 'Webhook endpoint copied.', 'The current webhook endpoint is ready to paste into your integration settings.')}>Edit</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Lock size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Webhook Secret</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Secret rotation requested.', 'This is ready for a provider-backed webhook secret rotation flow.')}>Rotate Secret</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Box size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Environment</p>
              </div>
            </div>
            <span className="badge" style={{ padding: '4px 10px', fontSize: '11px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>Production</span>
          </div>
        </div>
      </div>

      {/* 6. Data & Retention */}
      <div className="card" style={{ padding: '24px' }}>
        <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#3b82f6', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>6</div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Data & Retention</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Clock size={16} color="var(--text-muted)" style={{ marginTop: '2px' }} />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Audit Log Retention</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>How long to keep audit logs</p>
              </div>
            </div>
            <div style={{ position: 'relative', width: '120px' }}>
              <select className="search-input" style={{ width: '100%', padding: '6px 12px', height: '32px', fontSize: '12px' }}><option>180 days</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Download size={16} color="var(--text-muted)" style={{ marginTop: '2px' }} />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Export Data</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Download a copy of your workspace data</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 16px', fontSize: '12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Workspace export requested.', 'This is a safe placeholder until a signed export job endpoint is connected.')}>Export Data</button>
          </div>
          <div className="settings-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Database size={16} color="var(--text-muted)" style={{ marginTop: '2px' }} />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Backup Cadence</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Automated backup frequency</p>
              </div>
            </div>
            <div style={{ position: 'relative', width: '120px' }}>
              <select className="search-input" style={{ width: '100%', padding: '6px 12px', height: '32px', fontSize: '12px' }}><option>Daily</option></select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }} />
            </div>
          </div>
          <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.1)', borderRadius: '8px', padding: '12px', display: 'flex', gap: '10px', alignItems: 'center' }}>
            <AlertCircle size={16} color="var(--accent)" />
            <p style={{ fontSize: '11px', color: 'var(--accent)' }}>Backups are encrypted and stored in your region.</p>
          </div>
        </div>
      </div>
    </div>

    {/* 7. Danger Zone */}
    <div className="danger-zone" style={{ marginTop: '24px', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.02)', borderRadius: '12px', padding: '24px' }}>
      <div className="settings-card-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div className="settings-step-number" style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#ef4444', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700 }}>7</div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: '#ef4444' }}>Danger Zone</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(280), gap: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <RotateCw size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Deactivate Workspace</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Temporarily deactivate this workspace.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Workspace deactivation is guarded.', 'Add a confirmation workflow here when you are ready to support destructive admin actions.')}>Deactivate</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Trash2 size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Reset Sandbox Data</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Permanently delete all sandbox data.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }} onClick={() => adminUi.showPlaceholder('Sandbox reset is intentionally blocked here.', 'Hook this up only when you have a multi-step confirmation and audit trail in place.')}>Reset Sandbox</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Users size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Revoke All Sessions</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Sign out all users from all devices.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }} onClick={onRevokeAllSessions}>Revoke Sessions</button>
        </div>
      </div>
    </div>

    <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <Lock size={14} /> Your settings are encrypted and securely stored.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <Clock size={14} /> Last updated: May 29, 2025 02:15 AM
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px' }}>
        <button className="btn btn-secondary" style={{ width: '120px' }} onClick={() => adminUi.showPlaceholder('Draft reset skipped.', 'The settings on this page are still local until the persistence endpoint is added.')}>Cancel</button>
        <button className="btn btn-primary" style={{ width: '180px' }} onClick={() => adminUi.showPlaceholder('Settings saved locally.', 'This refactor keeps the controls responsive and ready for API persistence.')}>Save All Changes</button>
      </div>
    </div>
  </div>
  );
};

const IntegrationsView = ({ data, onRetryIntegration }) => {
  const adminUi = useAdminUi();
  const summary = data?.summary || {};
  const items = data?.items || [];

  return (
    <div className="fade-in">
      <SectionHeader title="Integrations" description="Live provider configuration and health across billing, auth, messaging, and data systems." breadcrumbs={['Integrations']} />

      <div style={{ display: 'grid', gridTemplateColumns: createAutoFitColumns(220), gap: '16px', marginBottom: '32px' }}>
        <SummaryCard icon={LayoutGrid} label="Connected Apps" value={formatMetricNumber(summary.connectedApps || 0)} trend="Configured providers" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={Activity} label="Sync Health" value={`${summary.syncHealth || 0}%`} trend="Configuration health" trendUp={true} sparklineColor="#10b981" />
        <SummaryCard icon={Webhook} label="Webhooks Active" value={formatMetricNumber(summary.webhooksActive || 0)} trend="Developer surfaces" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={AlertTriangle} label="Needs Attention" value={formatMetricNumber(summary.failedSyncs || 0)} trend="Missing or degraded" trendUp={false} sparklineColor="#ef4444" />
      </div>

      <div className="integrations-main-grid">
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>All Integrations</h3>
            <button className="btn btn-secondary" style={{ fontSize: '12px' }} onClick={() => adminUi.downloadJson('zenin-integrations-health.json', items, 'Integrations exported.', 'The current integration health snapshot was downloaded as JSON.')}>
              Export Snapshot
            </button>
          </div>

          <div className="integration-card-grid">
            {items.map((app) => (
              <div key={app.name} className="integration-card">
                <div style={{ display: 'flex', gap: '16px' }}>
                  <div className="integration-icon-wrapper" style={{ background: 'rgba(59, 130, 246, 0.12)' }}>
                    <Code size={24} color="var(--accent)" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: '15px', fontWeight: 600 }}>{app.name}</h4>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{app.category}</p>
                    <div className="sync-status">
                      <div className="sync-dot" style={{ background: app.status === 'active' || app.status === 'connected' ? 'var(--success)' : app.status === 'degraded' ? '#f59e0b' : 'var(--text-muted)' }} />
                      Last sync: {formatRelativeTime(app.lastSyncAt, 'Unknown')}
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>{app.note}</p>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '8px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Credentials: {app.credentialStatus || 'unknown'}</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sync lag: {formatMetricNumber(app.syncLagMinutes || 0)}m</span>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Failures 24h: {formatMetricNumber(app.webhookFailures || 0)}</span>
                      {app.metadata?.projectIdPreview ? <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Project: {app.metadata.projectIdPreview}</span> : null}
                      {app.metadata?.secretKeyPreview ? <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Key: {app.metadata.secretKeyPreview}</span> : null}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    className={`btn ${app.status === 'inactive' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: '12px', padding: '6px 16px' }}
                    onClick={() => {
                      if (app.retryable) {
                        onRetryIntegration?.(app.name);
                        return;
                      }
                      adminUi.copyText(JSON.stringify(app, null, 2), `${app.name} details copied.`, 'The current integration snapshot is ready to share or inspect.');
                    }}
                  >
                    {app.actionLabel || 'Inspect'}
                  </button>
                  <span className={`badge badge-${app.status === 'active' || app.status === 'connected' ? 'success' : app.status === 'degraded' ? 'warning' : 'inactive'}`}>
                    {String(app.status || 'unknown').toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ paddingTop: '56px' }}>
          <div className="integration-side-section">
            <div className="integration-side-header">
              <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Operational Notes</h4>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {items.filter((app) => app.status !== 'active' && app.status !== 'connected').map((app) => (
                <div key={`${app.name}-note`} className="integration-side-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>{app.name}</span>
                    <span className="status-badge" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '2px 6px', fontSize: '10px' }}>{app.status}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{app.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [commandQuery, setCommandQuery] = useState('');
  const [commandResults, setCommandResults] = useState({ users: [], audit: [], logs: [], tables: [] });
  const [commandLoading, setCommandLoading] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [auditSeedQuery, setAuditSeedQuery] = useState('');
  const [logSeedQuery, setLogSeedQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedUserDetails, setSelectedUserDetails] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isEventPanelOpen, setIsEventPanelOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [databaseParams, setDatabaseParams] = useState({ table: null, page: 1, pageSize: 10 });
  
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const [billingStats, setBillingStats] = useState(null);
  const [integrationsData, setIntegrationsData] = useState(null);
  const [users, setUsers] = useState([]);
  const [logsData, setLogsData] = useState({ rows: [], total: 0, metrics: {}, slowEndpoints: [], services: [] });
  const [auditData, setAuditData] = useState({ rows: [], total: 0 });
  const [error, setError] = useState(null);
  const [toasts, setToasts] = useState([]);

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const notify = (tone, title, message = '') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev.slice(-2), { id, tone, title, message }]);
    window.setTimeout(() => {
      dismissToast(id);
    }, 4200);
  };

  const copyText = async (value, successTitle, successMessage) => {
    try {
      await copyTextToClipboard(value);
      notify('success', successTitle, successMessage);
    } catch (copyError) {
      console.error('Copy failed:', copyError);
      notify('error', 'Copy failed.', 'Your browser blocked clipboard access for this action.');
      throw copyError;
    }
  };

  const downloadJson = (filename, value, successTitle, successMessage) => {
    downloadJsonFile(filename, value);
    notify('success', successTitle, successMessage);
  };

  const downloadCsv = (filename, rows, successTitle, successMessage) => {
    downloadCsvFile(filename, rows);
    notify('success', successTitle, successMessage);
  };

  const showPlaceholder = (title, message) => {
    notify('info', title, message);
  };

  const adminUi = useMemo(() => ({
    notify,
    copyText,
    downloadJson,
    downloadCsv,
    showPlaceholder,
  }), [notify, copyText, downloadJson, downloadCsv]);

  const checkAuth = async () => {
    try {
      const data = await adminFetch('/../auth/me');
      if (data.authenticated && data.user?.isAdmin) {
        setIsAuthenticated(true);
        setUser(data.user);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        setIsAuthenticated(true);
        setUser({ email: 'dev@zenin.com', displayName: 'Dev Admin', isAdmin: true, adminRole: 'super_admin' });
      } else {
        setIsAuthenticated(false);
      }
    }
  };

  const fetchSelectedUserDetails = async (userId) => {
    const details = await adminFetch(`/users/${userId}`);
    setSelectedUserDetails(details);
    return details;
  };

  const fetchData = async (tab = activeTab) => {
    setLoading(true);
    try {
      if (tab === 'overview') {
        const data = await adminFetch('/stats');
        setStats(data);
      } else if (tab === 'users') {
        const data = await adminFetch('/users');
        setUsers(data);
      } else if (tab === 'database') {
        const params = new URLSearchParams();
        if (databaseParams.table) params.set('table', databaseParams.table);
        params.set('page', String(databaseParams.page || 1));
        params.set('pageSize', String(databaseParams.pageSize || 10));
        const data = await adminFetch(`/database?${params.toString()}`);
        setDbStats(data);
      } else if (tab === 'billing') {
        const data = await adminFetch('/billing');
        setBillingStats(data);
      } else if (tab === 'integrations') {
        const data = await adminFetch('/integrations');
        setIntegrationsData(data);
      } else if (tab === 'logs' || tab === 'audit') {
        const { auditLogs, systemLogs } = await adminFetch('/logs');
        setLogsData(systemLogs || { rows: [], total: 0, metrics: {}, slowEndpoints: [], services: [] });
        setAuditData(auditLogs || { rows: [], total: 0 });
      }
      setError(null);
    } catch (err) {
      console.error(`Error fetching ${tab} data:`, err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData(activeTab);
    }
  }, [activeTab, isAuthenticated, databaseParams.table, databaseParams.page]);

  useEffect(() => {
    if (!selectedUser) return;
    const refreshedUser = users.find((entry) => Number(entry.id) === Number(selectedUser.id));
    if (refreshedUser) {
      setSelectedUser((prev) => ({ ...prev, ...refreshedUser }));
      setSelectedUserDetails((prev) => prev ? { ...prev, user: { ...prev.user, ...refreshedUser } } : prev);
    }
    if (isPanelOpen) {
      fetchSelectedUserDetails(selectedUser.id).catch(() => {});
    }
  }, [users, selectedUser, isPanelOpen]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isCommandPaletteOpen) return undefined;
    const trimmed = commandQuery.trim();
    if (!trimmed) {
      setCommandResults({ users: [], audit: [], logs: [], tables: [] });
      return undefined;
    }
    const timeoutId = window.setTimeout(async () => {
      try {
        setCommandLoading(true);
        const results = await adminFetch(`/search?query=${encodeURIComponent(trimmed)}`);
        setCommandResults(results);
      } catch (searchError) {
        console.error('Command palette search failed:', searchError);
      } finally {
        setCommandLoading(false);
      }
    }, 180);
    return () => window.clearTimeout(timeoutId);
  }, [commandQuery, isAuthenticated, isCommandPaletteOpen]);

  const openUserPanel = async (selected) => {
    setSelectedUser(selected);
    setSelectedUserDetails(null);
    setIsPanelOpen(true);
    try {
      await fetchSelectedUserDetails(selected.id);
    } catch (detailError) {
      notify('error', 'User details failed.', detailError.message);
    }
  };

  const withAdminReauth = async (task) => {
    try {
      return await task();
    } catch (error) {
      if (Number(error?.status) !== 428 || error?.code !== 'ADMIN_REAUTH_REQUIRED') {
        throw error;
      }
      const currentPassword = window.prompt('Confirm your admin password to continue:', '')?.trim();
      if (!currentPassword) {
        throw new Error('Admin confirmation is required to continue.');
      }
      await adminFetch('/reauth/verify', {
        method: 'POST',
        body: JSON.stringify({ currentPassword })
      });
      return task();
    }
  };

  const handleUpdateUser = async (userId, type, value, reason = '') => {
    try {
      let response = null;
      if (type === 'plan') {
        response = await adminFetch(`/users/${userId}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({ plan: value, reason })
        });
        notify('success', 'User plan updated.', `The account is now on the ${String(value).toUpperCase()} plan.`);
      } else if (type === 'role') {
        response = await withAdminReauth(() => adminFetch(`/users/${userId}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ adminRole: value, reason })
        }));
        notify('success', 'Role updated.', `${formatAdminRoleLabel(value)} access is now applied.`);
      } else if (type === 'suspend') {
        response = await withAdminReauth(() => adminFetch(`/users/${userId}/suspend`, {
          method: 'POST',
          body: JSON.stringify({ isSuspended: value, reason })
        }));
        notify('success', value ? 'User suspended.' : 'User reactivated.', value ? 'The account has been suspended.' : 'The account is active again.');
      } else if (type === 'delete') {
        if (!window.confirm('Are you sure you want to permanently delete this user?')) return;
        await withAdminReauth(() => adminFetch(`/users/${userId}`, { method: 'DELETE', body: JSON.stringify({ reason }) }));
        setIsPanelOpen(false);
        setSelectedUser(null);
        setSelectedUserDetails(null);
        notify('success', 'User deleted.', 'The account was permanently removed.');
      }

      const updatedUser = response?.user || response;
      if (updatedUser?.id) {
        setSelectedUser((prev) => (prev && Number(prev.id) === Number(updatedUser.id) ? { ...prev, ...updatedUser } : prev));
      }
      await fetchData('users');
      if (isPanelOpen && selectedUser && Number(selectedUser.id) === Number(userId) && type !== 'delete') {
        await fetchSelectedUserDetails(userId);
      }
    } catch (err) {
      notify('error', 'User update failed.', err.message);
    }
  };

  const handleResetPassword = async (userId, reason = '') => {
    try {
      await withAdminReauth(() => adminFetch(`/users/${userId}/recover`, { method: 'POST', body: JSON.stringify({ reason }) }));
      notify('success', 'Recovery email sent.', 'A password reset email was sent to the user.');
    } catch (err) {
      notify('error', 'Recovery email failed.', err.message);
    }
  };

  const handleRevokeSessions = async (userId, reason = '') => {
    try {
      await withAdminReauth(() => adminFetch(`/users/${userId}/sessions/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }));
      notify('success', 'Sessions revoked.', 'All active sessions for this user have been revoked.');
      await fetchData('users');
      await fetchSelectedUserDetails(userId);
    } catch (err) {
      notify('error', 'Session revoke failed.', err.message);
    }
  };

  const runMigration = async () => {
    try {
      const reason = window.prompt('Reason for running the admin workspace migration:', '')?.trim();
      if (!reason) return;
      await adminFetch('/migrations/admin-workspace', { method: 'POST', body: JSON.stringify({ reason }) });
      notify('success', 'Migration successful.', 'The admin workspace migration completed successfully.');
      fetchData('database');
    } catch (err) {
      notify('error', 'Migration failed.', err.message);
    }
  };

  const handleAddUser = async (userData) => {
    const reason = window.prompt(`Reason for creating ${userData.email}:`, '')?.trim();
    if (!reason) {
      throw new Error('Creation reason is required.');
    }
    const created = await withAdminReauth(() => adminFetch('/users', {
      method: 'POST',
      body: JSON.stringify({ ...userData, reason }),
    }));

    notify(
      created.recoveryEmailSent ? 'success' : 'warning',
      created.recoveryEmailSent ? 'User created and invited.' : 'User created without email delivery.',
      created.recoveryEmailSent
        ? `A password setup email was sent to ${userData.email}.`
        : `The user was created, but the password setup email could not be sent.`
    );
    await fetchData('users');
    return created.user;
  };

  const handleExportUsers = (rows) => {
    const exportRows = (rows || []).map((entry) => ({
      id: entry.id,
      name: entry.name || '',
      email: entry.email || '',
      plan: entry.plan || '',
      role: entry.adminRole || 'user',
      status: entry.suspendedAt ? 'suspended' : 'active',
      activeSessions: entry.activeSessionCount || 0,
      joined: entry.joined || '',
    }));
    downloadCsv('zenin-admin-users.csv', exportRows, 'User list exported.', `Downloaded ${exportRows.length} user records as CSV.`);
  };

  const handleExportLogs = (entries) => {
    downloadJson('zenin-system-logs.json', entries || [], 'Logs exported.', 'The current log dataset was downloaded as JSON.');
  };

  const handleBulkAction = async ({ action, userIds, value, reason }) => {
    try {
      await withAdminReauth(() => adminFetch('/users/bulk', {
        method: 'POST',
        body: JSON.stringify({ action, userIds, value, reason })
      }));
      notify('success', 'Bulk action completed.', `${action.replace(/_/g, ' ')} ran for ${userIds.length} users.`);
      await fetchData('users');
    } catch (err) {
      notify('error', 'Bulk action failed.', err.message);
    }
  };

  const handleCreateAlert = async () => {
    const title = window.prompt('Alert title:', '')?.trim();
    if (!title) return;
    try {
      await adminFetch('/alerts', {
        method: 'POST',
        body: JSON.stringify({ title, query: commandQuery || searchQuery || '', severity: 'warning' })
      });
      notify('success', 'Alert draft created.', 'The alert definition was recorded in the audit trail.');
      await fetchData('logs');
    } catch (err) {
      notify('error', 'Alert creation failed.', err.message);
    }
  };

  const handleResolveAlert = async (alert) => {
    if (!alert?.id) return;
    const reason = window.prompt(`Reason for resolving alert "${alert.title}":`, '')?.trim();
    if (!reason) return;
    try {
      await adminFetch(`/alerts/${alert.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'resolved', reason })
      });
      notify('success', 'Alert resolved.', `${alert.title} was marked as resolved.`);
      await fetchData('logs');
    } catch (err) {
      notify('error', 'Alert resolution failed.', err.message);
    }
  };

  const handleCreateIncidentFromLog = async (log) => {
    if (!log) return;
    const title = window.prompt('Incident title:', `Investigate ${log.service || 'system'} issue`)?.trim();
    if (!title) return;
    const reason = window.prompt('Reason for creating this incident:', log.message || '')?.trim();
    if (!reason) return;
    try {
      await adminFetch('/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title,
          severity: normalizeLogLevel(log.level || 'warning'),
          requestId: log.requestId || null,
          sourceLogId: log.id,
          reason,
          details: {
            message: log.message,
            endpoint: log.endpoint,
            service: log.service
          }
        })
      });
      notify('success', 'Incident created.', 'The log was escalated into the incident queue.');
      await fetchData('logs');
      setIsLogPanelOpen(false);
      setSelectedLog(null);
    } catch (err) {
      notify('error', 'Incident creation failed.', err.message);
    }
  };

  const handleRetryIntegration = async (integrationName) => {
    const reason = window.prompt(`Reason for retrying ${integrationName}:`, '')?.trim();
    if (!reason) return;
    try {
      await adminFetch(`/integrations/${encodeURIComponent(integrationName)}/retry`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      notify('success', 'Retry recorded.', `${integrationName} was queued for operator follow-up.`);
      await fetchData('integrations');
      await fetchData('logs');
    } catch (err) {
      notify('error', 'Retry request failed.', err.message);
    }
  };

  const handleRevokeAllSessions = async () => {
    const reason = window.prompt('Reason for revoking all active sessions:', '')?.trim();
    if (!reason) return;
    const excludeCurrentAdmin = !window.confirm('Include your current admin session in the revoke? Choose Cancel to keep your current session active.');
    try {
      const result = await withAdminReauth(() => adminFetch('/sessions/revoke-all', {
        method: 'POST',
        body: JSON.stringify({ reason, excludeCurrentAdmin })
      }));
      notify('success', 'Sessions revoked.', `${formatMetricNumber(result.revokedCount || 0)} sessions were revoked.`);
      await fetchData('users');
      await fetchData('logs');
    } catch (err) {
      notify('error', 'Global revoke failed.', err.message);
    }
  };

  const openAuditTrail = async () => {
    setActiveTab('audit');
    await fetchData('audit');
  };

  const jumpToUser = async (userId) => {
    setActiveTab('users');
    const directory = await adminFetch('/users');
    setUsers(directory);
    const userRecord = directory.find((entry) => Number(entry.id) === Number(userId));
    if (userRecord) {
      openUserPanel(userRecord);
    } else {
      const details = await fetchSelectedUserDetails(userId);
      if (details?.user) {
        openUserPanel(details.user);
      }
    }
  };

  const openRelatedFromUser = async (tab, selected) => {
    if (tab === 'users') {
      setActiveTab('users');
      return;
    }
    if (tab === 'audit') {
      setAuditSeedQuery(selected.email || '');
      setActiveTab('audit');
      await fetchData('audit');
      return;
    }
    if (tab === 'logs') {
      setLogSeedQuery(selected.email || '');
      setActiveTab('logs');
      await fetchData('logs');
    }
  };

  const handleCommandNavigate = async (section, row) => {
    setIsCommandPaletteOpen(false);
    setCommandQuery('');
    if (section === 'users') {
      await openUserPanel(row);
      setActiveTab('users');
      return;
    }
    if (section === 'audit') {
      setActiveTab('audit');
      setSelectedEvent(row);
      setIsEventPanelOpen(true);
      return;
    }
    if (section === 'logs') {
      setActiveTab('logs');
      setSelectedLog(row);
      setIsLogPanelOpen(true);
      return;
    }
    if (section === 'tables') {
      setDatabaseParams((prev) => ({ ...prev, table: row.name, page: 1 }));
      setActiveTab('database');
    }
  };

  if (!isAuthenticated) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-app)' }}>
        <div className="card" style={{ maxWidth: '400px', textAlign: 'center', padding: '40px' }}>
          <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px auto' }}>
            <Shield size={40} color="var(--accent)" />
          </div>
          <h2 style={{ marginBottom: '12px', fontSize: '24px', fontWeight: 700 }}>Admin Access Required</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '32px', fontSize: '14px', lineHeight: '1.6' }}>
            This console is restricted to platform administrators. Please log in with an authorized account to continue.
          </p>
          <button 
            className="btn btn-primary" 
            style={{ width: '100%', height: '44px', fontSize: '15px', fontWeight: 600 }}
            onClick={() => {
              const mainAppUrl = getMainAppUrl();
              window.location.href = `${mainAppUrl}/auth?mode=signin&next=${encodeURIComponent(window.location.href)}`;
            }}
          >
            Authenticate with Zenin
          </button>
          
          <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Having trouble?{' '}
              <button type="button" className="inline-link-btn" onClick={() => window.location.reload()}>
                Retry Connection
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (loading && !stats && !dbStats && !billingStats && users.length === 0 && (logsData?.rows || []).length === 0) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <div className="animate-pulse" style={{ color: 'var(--accent)' }}>Syncing with Infrastructure...</div>
        </div>
      );
    }

    if (error) {
      return (
        <div style={{ padding: '40px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '12px', color: 'var(--danger)', margin: '40px' }}>
          <h3 style={{ marginBottom: '8px' }}>Connection Error</h3>
          <p>{error}</p>
          <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={() => fetchData()}>Retry Sync</button>
        </div>
      );
    }

    switch (activeTab) {
      case 'overview': return <OverviewView stats={stats} onOpenAudit={openAuditTrail} />;
      case 'users': return (
        <UserManagementView 
          users={users} 
          searchQuery={searchQuery} 
          setSearchQuery={setSearchQuery} 
          onAddUser={() => setIsAddUserModalOpen(true)}
          onExportUsers={handleExportUsers}
          onBulkAction={handleBulkAction}
          onSelectUser={openUserPanel}
        />
      );
      case 'audit': return (
        <AuditTrailView 
          auditData={auditData}
          onOpenUser={jumpToUser}
          seedQuery={auditSeedQuery}
          onSelectEvent={(event) => { setSelectedEvent(event); setIsEventPanelOpen(true); }} 
        />
      );
      case 'database': return (
        <DatabaseView
          stats={dbStats}
          onRunMigration={runMigration}
          onSelectTable={(table) => setDatabaseParams((prev) => ({ ...prev, table, page: 1 }))}
          onChangePage={(page) => setDatabaseParams((prev) => ({ ...prev, page }))}
        />
      );
      case 'billing': return <BillingView stats={billingStats} />;
      case 'logs': return (
        <LogsView 
          logsData={logsData} 
          seedQuery={logSeedQuery}
          onRefresh={() => fetchData('logs')} 
          onExportLogs={handleExportLogs}
          onCreateAlert={handleCreateAlert}
          onResolveAlert={handleResolveAlert}
          onSelectLog={(log) => {
            setSelectedLog(log);
            setIsLogPanelOpen(true);
          }}
        />
      );
      case 'settings': return <SettingsView onRevokeAllSessions={handleRevokeAllSessions} />;
      case 'integrations': return <IntegrationsView data={integrationsData} onRetryIntegration={handleRetryIntegration} />;
      default: return <OverviewView stats={stats} onOpenAudit={openAuditTrail} />;
    }
  };

  return (
    <AdminUiContext.Provider value={adminUi}>
    <div className="admin-container">
      <aside className="sidebar">
        <div style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Shield size={32} color="var(--accent)" />
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Zenin <span style={{ color: 'var(--accent)' }}>Admin</span></h2>
        </div>
        
        <nav style={{ flex: 1 }}>
          <SidebarItem icon={<BarChart3 size={18} />} label="Overview" active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} />
          <SidebarItem icon={<Users size={18} />} label="Users" active={activeTab === 'users'} onClick={() => setActiveTab('users')} />
          <SidebarItem icon={<Database size={18} />} label="Database" active={activeTab === 'database'} onClick={() => setActiveTab('database')} />
          <SidebarItem icon={<LogsIcon size={18} />} label="System Logs" active={activeTab === 'logs'} onClick={() => setActiveTab('logs')} />
          <SidebarItem icon={<BillingIcon size={18} />} label="Billing" active={activeTab === 'billing'} onClick={() => setActiveTab('billing')} />
          <SidebarItem icon={<AuditIcon size={18} />} label="Audit Trail" active={activeTab === 'audit'} onClick={() => setActiveTab('audit')} />
          <SidebarItem icon={<IntegrationsIcon size={18} />} label="Integrations" active={activeTab === 'integrations'} onClick={() => setActiveTab('integrations')} />
          <SidebarItem icon={<SettingsIcon size={18} />} label="Settings" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div className="sidebar-footer">
          <div className="status-indicator">
            <div className="status-dot" />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600 }}>System Status</p>
              <p style={{ color: 'var(--success)', fontSize: '11px' }}>All Systems Operational</p>
            </div>
          </div>
          <button type="button" className="status-link-btn" style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={() => showPlaceholder('Status page opened.', 'Link this to your public status page when it is available.')}>
            <span>View Status Page</span> <ExternalLink size={10} />
          </button>
          <button type="button" className="nav-item nav-button" style={{ marginTop: '16px', margin: '16px -16px 0 -16px', padding: '12px 16px', borderTop: '1px solid var(--border)' }} onClick={() => setIsLogoutModalOpen(true)}>
            <LogOut size={18} style={{ transform: 'rotate(180deg)' }} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="main-wrapper">
        <header className="top-nav">
          <div className="search-input-wrapper">
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input
              type="text"
              className="search-input"
              placeholder="Jump to users, request IDs, tables..."
              value={commandQuery}
              onFocus={() => setIsCommandPaletteOpen(true)}
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setIsCommandPaletteOpen(true);
              }}
            />
            <div className="search-shortcut">
              <span style={{ fontSize: '12px' }}>⌘</span>
              <span>K</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <button type="button" style={{ position: 'relative', background: 'none', border: 'none', color: 'var(--text-secondary)' }} onClick={() => showPlaceholder('Notifications center opened.', 'This is ready for a richer notification tray when alert data is available.')}>
              <Bell size={20} />
              <div style={{ position: 'absolute', top: '-4px', right: '-4px', background: 'var(--accent)', width: '14px', height: '14px', borderRadius: '50%', fontSize: '10px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg-header)' }}>7</div>
            </button>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '99px', border: '1px solid var(--border)' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
              <span style={{ fontSize: '12px', fontWeight: 600 }}>Production</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingLeft: '16px', borderLeft: '1px solid var(--border)' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '12px', color: 'white' }}>
                {user?.displayName ? user.displayName.substring(0, 2).toUpperCase() : 'AD'}
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{user?.displayName || 'Administrator'}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{user?.email || 'admin@zenin.com'}</p>
              </div>
              <ChevronDown size={14} color="var(--text-muted)" />
            </div>
          </div>
        </header>

        <div className="content-area">
          {renderContent()}
        </div>
      </main>

      {isPanelOpen && (
        <UserDetailPanel 
          user={selectedUser} 
          details={selectedUserDetails}
          onUpdate={handleUpdateUser}
          onResetPassword={handleResetPassword}
          onRevokeSessions={handleRevokeSessions}
          onOpenRelated={openRelatedFromUser}
          onClose={() => {
            setIsPanelOpen(false);
            setSelectedUser(null);
            setSelectedUserDetails(null);
          }} 
        />
      )}
      <AddUserModal 
        isOpen={isAddUserModalOpen} 
        onClose={() => setIsAddUserModalOpen(false)} 
        onAdd={handleAddUser}
      />
      {isEventPanelOpen && (
        <EventDetailPanel 
          event={selectedEvent} 
          onClose={() => {
            setIsEventPanelOpen(false);
            setSelectedEvent(null);
          }} 
        />
      )}
      {isLogPanelOpen && (
        <LogDetailPanel 
          log={selectedLog} 
          onCreateIncident={handleCreateIncidentFromLog}
          onClose={() => {
            setIsLogPanelOpen(false);
            setSelectedLog(null);
          }} 
        />
      )}
      {isLogoutModalOpen && (
        <LogoutModal 
          onClose={() => setIsLogoutModalOpen(false)} 
          onLogout={async () => {
            try {
              await adminFetch('/../auth/signout', { method: 'POST' });
              setIsAuthenticated(false);
              setUser(null);
              setIsLogoutModalOpen(false);
              notify('success', 'Signed out.', 'Your admin session on this device has ended.');
            } catch (logoutError) {
              notify('error', 'Sign out failed.', logoutError.message);
            }
          }} 
        />
      )}
      <CommandPalette
        open={isCommandPaletteOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        results={commandResults}
        loading={commandLoading}
        onNavigate={handleCommandNavigate}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
    </AdminUiContext.Provider>
  );
}
