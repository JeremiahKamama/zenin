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

// --- Components ---

const SidebarItem = ({ icon, label, active, onClick }) => (
  <div 
    className={`nav-item ${active ? 'active' : ''}`} 
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </div>
);

const AddUserModal = ({ isOpen, onClose, onAdd }) => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('starter');
  const [isAdmin, setIsAdmin] = useState(false);

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Administrator Privileges</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Grant access to this admin console</p>
              </div>
              <Toggle active={isAdmin} onClick={() => setIsAdmin(!isAdmin)} />
            </div>
          </div>
          <div style={{ marginTop: '32px', display: 'flex', gap: '12px' }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button 
              className="btn btn-primary" 
              style={{ flex: 1 }}
              onClick={() => {
                onAdd({ email, name, plan, isAdmin });
                onClose();
              }}
            >
              Create User
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
      {(title === 'System Logs' || title === 'User Management') && (
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
  <div className={`toggle-switch ${active ? 'active' : ''}`} onClick={onClick}>
    <div className="toggle-dot" />
  </div>
);

const UserDetailPanel = ({ user, onClose, onUpdate, onResetPassword }) => {
  if (!user) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, color: 'var(--accent)' }}>
              {user.name?.charAt(0) || user.email?.charAt(0)}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: 600 }}>{user.name || 'No Name'}</h2>
                {user.isAdmin && <span className="badge badge-pro" style={{ fontSize: '10px' }}>ADMIN</span>}
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{user.email}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div className="detail-content">
          <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
            <div style={{ padding: '8px 0', color: 'var(--accent)', borderBottom: '2px solid var(--accent)', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Overview</div>
            <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer' }}>Activity</div>
            <div style={{ padding: '8px 0', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer' }}>Security</div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Account Status & Plan</h4>
            <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Current Plan</span>
                <select 
                  className="filter-select" 
                  value={user.plan?.toLowerCase()} 
                  onChange={(e) => onUpdate(user.id, 'plan', e.target.value)}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px' }}
                >
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="desk">Desk</option>
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Administrative Access</span>
                <button 
                  className={`btn ${user.isAdmin ? 'btn-secondary' : 'btn-primary'}`} 
                  style={{ fontSize: '11px', padding: '4px 10px', height: '28px' }}
                  onClick={() => onUpdate(user.id, 'role', !user.isAdmin)}
                >
                  {user.isAdmin ? 'Demote to User' : 'Promote to Admin'}
                </button>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">User Summary</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Member Since</p>
                <p style={{ fontSize: '14px', fontWeight: 600 }}>{new Date(user.joined).toLocaleDateString()}</p>
              </div>
              <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</p>
                <p style={{ fontSize: '14px', fontWeight: 600, color: user.suspendedAt ? 'var(--danger)' : 'var(--success)' }}>
                  {user.suspendedAt ? 'Suspended' : 'Active'}
                </p>
              </div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Contact Information</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="detail-row">
                <div className="detail-label"><Mail size={14} /> Email</div>
                <div className="detail-value">{user.email}</div>
              </div>
              <div className="detail-row">
                <div className="detail-label"><Clock size={14} /> ID</div>
                <div className="detail-value" style={{ fontFamily: 'monospace', fontSize: '12px' }}>{user.id}</div>
              </div>
            </div>
          </div>

          <div className="detail-section" style={{ marginTop: 'auto', marginBottom: 0 }}>
            <h4 className="detail-section-title">Management Actions</h4>
            <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
              <button 
                className="btn btn-secondary" 
                style={{ flex: 1, gap: '8px', fontSize: '13px', height: '38px' }}
                onClick={() => onResetPassword(user.id)}
              >
                <Lock size={14} /> Reset Password
              </button>
              <button 
                className="btn" 
                style={{ flex: 1, gap: '8px', fontSize: '13px', height: '38px', background: 'var(--bg-tertiary)', border: '1px solid var(--border)' }}
                onClick={() => alert('Impersonation is only available on production nodes.')}
              >
                <UserPlus size={14} /> Impersonate
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
                  background: user.suspendedAt ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                  border: user.suspendedAt ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)', 
                  color: user.suspendedAt ? 'var(--success)' : '#ef4444' 
                }}
                onClick={() => onUpdate(user.id, 'suspend', !user.suspendedAt)}
              >
                {user.suspendedAt ? <CheckCircle2 size={14} /> : <ZapOff size={14} />}
                {user.suspendedAt ? 'Activate User' : 'Suspend Account'}
              </button>
              <button 
                className="btn btn-danger" 
                style={{ flex: 0.5, gap: '8px', height: '38px', fontSize: '13px' }}
                onClick={() => onUpdate(user.id, 'delete')}
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
  if (!event) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" style={{ width: '480px' }} onClick={e => e.stopPropagation()}>
        <div className="detail-header" style={{ borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600 }}>Event Details</h2>
            <span className={`badge badge-${event.severity.toLowerCase()}`}>{event.severity.toUpperCase()}</span>
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
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Role changed for user sarah.chen</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>May 29, 2025 14:32:18 (2 minutes ago)</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><Download size={14} /> Export</button>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><Search size={14} /> Inspect</button>
            <button className="btn btn-primary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><LinkIcon size={14} /> Copy Link</button>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Event Metadata</h4>
            {[
              { label: 'Event ID', value: 'evt_8f3b7a1c2d9e', copy: true },
              { label: 'Actor', value: 'Super Admin (super@zenin.com)' },
              { label: 'Actor Type', value: 'Admin' },
              { label: 'Target Type', value: 'User' },
              { label: 'Source IP', value: '203.0.113.45 \ud83c\uddfa\ud83c\uddf8' },
              { label: 'User Agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...' },
              { label: 'Session ID', value: 'sess_f7a3c2b1e8d4' },
              { label: 'Request ID', value: 'req_8f3b7a1c2d9e' }
            ].map((item, idx) => (
              <div key={idx} className="detail-row">
                <div className="detail-label">{item.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)' }}>
                  {item.value} {item.copy && <Copy size={12} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />}
                </div>
              </div>
            ))}
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Change Summary</h4>
            <div style={{ background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '12px', fontWeight: 600, background: 'var(--bg-hover)' }}>Path: role</div>
              <div style={{ padding: '12px' }}>
                <div style={{ display: 'flex', gap: '10px', fontSize: '12px', marginBottom: '8px' }}>
                  <span style={{ color: '#ef4444' }}>- Old Value</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Member</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                  <span style={{ color: '#10b981' }}>+ New Value</span>
                  <span style={{ color: 'var(--text-secondary)' }}>Pro Plan</span>
                </div>
              </div>
              <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                Full Diff (3 changes) <ChevronRight size={14} />
              </div>
            </div>
          </div>

          <div className="detail-section" style={{ marginBottom: 0 }}>
            <h4 className="detail-section-title">Additional Context</h4>
            {[
              { label: 'Reason', value: 'Promoted to Pro Plan' },
              { label: 'IP Location', value: 'San Francisco, CA, United States' },
              { label: 'Device', value: 'MacBook Pro' },
              { label: 'MFA Used', value: 'Yes', color: 'var(--success)' }
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

const LogDetailPanel = ({ log, onClose }) => {
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
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>{new Date(log.createdAt).toLocaleString()} (2 minutes ago)</p>
          <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px', lineHeight: 1.4 }}>{log.message}</h3>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><Copy size={14} /> Copy</button>
            <button className="btn btn-secondary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><Pin size={14} /> Pin</button>
            <button className="btn btn-primary" style={{ flex: 1, fontSize: '13px', gap: '8px', height: '38px' }}><CheckSquare size={14} /> Mark Resolved</button>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Message</h4>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              An error occurred while processing the order payment. The payment gateway returned a 502 Bad Gateway response.
            </p>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Stack Trace (Preview)</h4>
            <div className="stack-trace-preview">
              <span className="stack-trace-line">PaymentGatewayException: 502 Bad Gateway</span>
              <span className="stack-trace-line">  at PaymentGatewayClient.processPayment</span>
              <span className="stack-trace-line highlight">(PaymentGatewayClient.java:237)</span>
              <span className="stack-trace-line">  at OrderService.processOrder</span>
              <span className="stack-trace-line">(OrderService.java:164)</span>
              <span className="stack-trace-line">  at OrderController.createOrder</span>
              <span className="stack-trace-line">(OrderController.java:89)</span>
              <span className="stack-trace-line">at ... 12 more frames</span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View full stack trace <ExternalLink size={12} />
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">Request Metadata</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">Request ID</span><span className="log-prop-value">{log.requestId || 'req_8f3b7a1c2d9e'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Endpoint</span><span className="log-prop-value">POST /api/v1/orders</span></div>
              <div className="log-prop-item"><span className="log-prop-label">IP Address</span><span className="log-prop-value">{log.ipAddress}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">User Agent</span><span className="log-prop-value">Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...</span></div>
            </div>
          </div>

          <div className="detail-section">
            <h4 className="detail-section-title">User / Session</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">User ID</span><span className="log-prop-value">user_12a4f8b9</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Email</span><span className="log-prop-value">{log.targetEmail || 'john.doe@acme.com'}</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Session ID</span><span className="log-prop-value">sess_f7a3c2b1e8d4</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Role</span><span className="log-prop-value">Customer</span></div>
            </div>
          </div>

          <div className="detail-section" style={{ marginBottom: 0 }}>
            <h4 className="detail-section-title">Performance</h4>
            <div className="log-prop-list">
              <div className="log-prop-item"><span className="log-prop-label">Duration</span><span className="log-prop-value" style={{ color: '#ef4444', fontWeight: 600 }}>1,842 ms</span></div>
              <div className="log-prop-item"><span className="log-prop-label">Status Code</span><span className="log-prop-value">502 Bad Gateway</span></div>
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

const OverviewView = ({ stats, fetchData }) => (
  <div className="fade-in">
    <SectionHeader 
      title="System Overview" 
      description="Real-time insights and platform health at a glance." 
      breadcrumbs={['Overview']} 
    />
    
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
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

    <div style={{ display: 'grid', gridTemplateColumns: '2.1fr 1fr', gap: '24px', marginBottom: '24px' }}>
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
        </div>
      </div>
    </div>

    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Live Platform Activity</h3>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Latest events from users and infrastructure</p>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>View Full Audit Trail</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
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
  </div>
);

const UserManagementView = ({ users, searchQuery, setSearchQuery, onUpdateUser, onSelectUser, onAddUser }) => {
  const [planFilter, setPlanFilter] = useState('All Plans');
  const [statusFilter, setStatusFilter] = useState('All Status');

  const filteredUsers = (users || []).filter(u => {
    const matchesSearch = (u.name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                         (u.email || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                         String(u.id).includes(searchQuery);
    
    const matchesPlan = planFilter === 'All Plans' || u.plan?.toLowerCase() === planFilter.toLowerCase();
    const matchesStatus = statusFilter === 'All Status' || 
                          (statusFilter === 'Active' && !u.suspendedAt) || 
                          (statusFilter === 'Suspended' && u.suspendedAt);
    
    return matchesSearch && matchesPlan && matchesStatus;
  });

  return (
    <div className="fade-in">
      <SectionHeader 
        title="User Management" 
        description="Manage platform users, permissions, and subscription plans." 
        breadcrumbs={['Users']} 
        onAction={(type) => type === 'primary' && onAddUser()}
      />
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={Users} label="Total Users" value="12,842" trend="12.4% vs last 30 days" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={Activity} label="Active Users" value="2,143" trend="8.7% vs last 7 days" trendUp={true} sparklineColor="#10b981" />
        <SummaryCard icon={UserPlus} label="New This Week" value="156" trend="12% increase" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={ArrowDownRight} label="Churn Rate" value="2.4%" trend="0.5% vs last month" trendUp={false} sparklineColor="#ef4444" />
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              className="search-input" 
              placeholder="Search by name, email, or ID..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '40px' }}
            />
          </div>
          <select className="filter-select" value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
            <option>All Plans</option>
            <option>Starter</option>
            <option>Pro</option>
            <option>Desk</option>
          </select>
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option>All Status</option>
            <option>Active</option>
            <option>Suspended</option>
          </select>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px', gap: '8px' }}>
            <Filter size={14} /> More Filters
          </button>
        </div>

        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Plan</th>
                <th>Role</th>
                <th>Joined</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No users found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} onClick={() => onSelectUser(user)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: '12px', color: 'var(--accent)' }}>
                          {user.name?.charAt(0) || user.email?.charAt(0)}
                        </div>
                        <div>
                          <p style={{ fontWeight: 600, fontSize: '14px' }}>{user.name || 'No Name'}</p>
                          <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${user.suspendedAt ? 'status-inactive' : 'status-active'}`} style={{ 
                        background: user.suspendedAt ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', 
                        color: user.suspendedAt ? 'var(--danger)' : 'var(--success)' 
                      }}>
                        <div className={`dot ${user.suspendedAt ? 'dot-inactive' : 'dot-active'}`} /> {user.suspendedAt ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-${user.plan?.toLowerCase()}`} style={{ fontSize: '11px', textTransform: 'uppercase' }}>
                        {user.plan}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: user.isAdmin ? 'var(--accent)' : 'var(--text-secondary)' }}>
                        {user.isAdmin ? 'ADMIN' : 'USER'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                      {user.joined ? new Date(user.joined).toLocaleDateString() : 'N/A'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={(e) => { e.stopPropagation(); onSelectUser(user); }}>
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
          <div>Showing 1 to {Math.min(10, filteredUsers.length)} of {filteredUsers.length} users</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">2</button>
            <button className="pagination-btn">3</button>
            <span>...</span>
            <button className="pagination-btn">129</button>
            <button className="pagination-btn"><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>10 per page</span>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>
    </div>
  );
};

const DatabaseView = ({ stats, onRunMigration }) => {
  const tables = [
    { name: 'users', count: '12,842' },
    { name: 'subscriptions', count: '2,143' },
    { name: 'portfolios', count: '7,891' },
    { name: 'watchlists', count: '3,567' },
    { name: 'journal_entries', count: '9,234' },
    { name: 'option_trades', count: '15,672' },
    { name: 'logs', count: '128,451' },
    { name: 'payments', count: '6,321' },
  ];

  return (
    <div className="fade-in">
      <SectionHeader 
        title="Database Explorer" 
        description="Monitor, inspect, and safely manage platform data." 
        breadcrumbs={['Database']} 
      />
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>Connection Status</p>
              <span className="badge badge-success" style={{ padding: '4px 10px' }}>Healthy</span>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '16px' }}>Primary Database</p>
              <p style={{ fontSize: '13px', fontWeight: 600 }}>PostgreSQL 15.4</p>
            </div>
            <div style={{ width: '80px', height: '40px' }}>
              <div style={{ height: '100%', display: 'flex', alignItems: 'flex-end', gap: '2px' }}>
                {[4, 6, 4, 8, 5, 7, 6, 9].map((h, i) => (
                  <div key={i} style={{ flex: 1, height: `${h * 10}%`, background: 'var(--success)', borderRadius: '1px', opacity: 0.5 }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>Tables</p>
              <h3 style={{ fontSize: '24px', fontWeight: 700 }}>24</h3>
              <p style={{ fontSize: '12px', color: 'var(--accent)', marginTop: '4px' }}>+ 2 new this week</p>
            </div>
            <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Table size={20} color="var(--text-muted)" />
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>Storage Used</p>
              <h3 style={{ fontSize: '24px', fontWeight: 700 }}>18.6 GB</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>of 100 GB (18.6%)</p>
            </div>
            <div className="donut-chart">
              <svg viewBox="0 0 36 36">
                <circle className="circle-bg" cx="18" cy="18" r="15.915" />
                <circle className="circle-progress" cx="18" cy="18" r="15.915" strokeDasharray="18.6 100" />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <HardDrive size={14} color="var(--text-muted)" />
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>Avg Query Latency</p>
              <h3 style={{ fontSize: '24px', fontWeight: 700 }}>42 <span style={{ fontSize: '14px', fontWeight: 400, color: 'var(--text-muted)' }}>ms</span></h3>
              <p style={{ fontSize: '12px', color: 'var(--success)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ArrowDownRight size={14} /> 12% vs last 7 days
              </p>
            </div>
            <div style={{ width: '80px', height: '40px' }}>
              <div style={{ height: '100%', borderBottom: '1px solid var(--border)', position: 'relative' }}>
                <svg viewBox="0 0 100 40" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                  <path d="M0 35 L10 32 L20 38 L30 30 L40 33 L50 25 L60 28 L70 15 L80 18 L90 10 L100 12" fill="none" stroke="var(--accent)" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="db-grid">
        <div className="card" style={{ padding: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Tables</h4>
          <div className="search-input-wrapper" style={{ marginBottom: '16px' }}>
            <Search style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={14} />
            <input type="text" className="search-input" placeholder="Search tables..." style={{ fontSize: '12px' }} />
            <Filter size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {tables.map((table) => (
              <div key={table.name} className={`db-list-item ${table.name === 'users' ? 'active' : ''}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={14} />
                  <span>{table.name}</span>
                </div>
                <span style={{ fontSize: '11px', opacity: 0.6 }}>{table.count}</span>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: '20px', fontSize: '12px', justifyContent: 'space-between' }}>
            View all tables (24) <ChevronRight size={14} />
          </button>
        </div>

        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>users</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>12,842 rows</span>
            </div>
            <div style={{ display: 'flex', gap: '12px', color: 'var(--text-muted)' }}>
              <RefreshCw size={16} />
              <Maximize2 size={16} />
              <MoreHorizontal size={16} />
            </div>
          </div>
          
          <div style={{ padding: '0 20px' }}>
            <div className="db-tabs">
              <div className="db-tab active">Data</div>
              <div className="db-tab">Schema</div>
              <div className="db-tab">Indexes</div>
              <div className="db-tab">Queries</div>
            </div>

            <div className="table-container" style={{ margin: '0 -20px' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>user_id</th>
                    <th>name</th>
                    <th>email</th>
                    <th>plan</th>
                    <th>status</th>
                    <th>joined_at</th>
                    <th>last_login</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { id: 1, name: 'Super Admin', email: 'super@zenin.com', plan: 'Enterprise', status: 'Active', joined: '2025-01-01 09:12:33', login: '2025-05-29 14:22:11' },
                    { id: 2, name: 'John Doe', email: 'john.doe@example.com', plan: 'Pro', status: 'Active', joined: '2025-01-05 11:02:10', login: '2025-05-29 13:48:22' },
                    { id: 3, name: 'Jane Smith', email: 'jane.smith@example.com', plan: 'Pro', status: 'Active', joined: '2025-01-07 08:33:41', login: '2025-05-29 12:11:09' },
                    { id: 4, name: 'Michael Lee', email: 'michael.lee@example.com', plan: 'Basic', status: 'Active', joined: '2025-01-11 15:45:12', login: '2025-05-29 09:54:33' },
                    { id: 5, name: 'Emily Johnson', email: 'emily.j@example.com', plan: 'Pro', status: 'Inactive', joined: '2025-01-12 10:23:56', login: '2025-05-20 16:22:18' },
                    { id: 6, name: 'David Brown', email: 'david.brown@example.com', plan: 'Basic', status: 'Active', joined: '2025-01-14 13:17:25', login: '2025-05-28 21:44:02' },
                  ].map((row) => (
                    <tr key={row.id}>
                      <td style={{ color: 'var(--text-muted)' }}>{row.id}</td>
                      <td style={{ fontWeight: 500 }}>{row.name}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{row.email}</td>
                      <td><span style={{ fontSize: '12px' }}>{row.plan}</span></td>
                      <td>
                        <span className={`status-badge ${row.status === 'Active' ? 'status-active' : 'status-inactive'}`} style={{ padding: '2px 8px', fontSize: '11px' }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{row.joined}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{row.login}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination" style={{ borderTop: '1px solid var(--border)', margin: '0 -20px', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Rows per page</span>
                <select className="search-input" style={{ width: '60px', padding: '4px' }}><option>10</option></select>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="pagination-btn" disabled><ChevronFirst size={16} /></button>
                <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
                <button className="pagination-btn active">1</button>
                <button className="pagination-btn">2</button>
                <button className="pagination-btn">3</button>
                <button className="pagination-btn">4</button>
                <button className="pagination-btn">5</button>
                <button className="pagination-btn"><ChevronRight size={16} /></button>
                <button className="pagination-btn"><ChevronLast size={16} /></button>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>1-10 of 12,842</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: 600 }}>Row Details</h4>
              <span className="badge badge-success" style={{ fontSize: '10px', gap: '4px', background: 'rgba(16, 185, 129, 0.05)' }}><Lock size={10} /> Read-only</span>
            </div>
            <div className="prop-list">
              {[
                { label: 'user_id', value: '1' },
                { label: 'name', value: 'Super Admin' },
                { label: 'email', value: 'super@zenin.com' },
                { label: 'plan', value: 'Enterprise' },
                { label: 'status', value: 'Active', color: 'var(--success)' },
                { label: 'joined_at', value: '2025-01-01 09:12:33' },
                { label: 'last_login', value: '2025-05-29 14:22:11' },
                { label: 'is_verified', value: 'true' },
                { label: 'two_factor_enabled', value: 'true' },
                { label: 'created_at', value: '2025-01-01 09:12:33' },
                { label: 'updated_at', value: '2025-05-29 14:22:11' },
              ].map((prop) => (
                <div key={prop.label} className="prop-item">
                  <span className="prop-label">{prop.label}</span>
                  <span className="prop-value" style={prop.color ? { color: prop.color } : {}}>{prop.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '20px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Table size={16} color="var(--accent)" /> Schema Summary
            </h4>
            <div className="prop-list">
              {[
                { label: 'Primary Key', value: 'user_id (bigint)' },
                { label: 'Indexes', value: '5' },
                { label: 'Foreign Keys', value: '3' },
                { label: 'Row Count', value: '12,842' },
                { label: 'Table Size', value: '156 MB' },
              ].map((prop) => (
                <div key={prop.label} className="prop-item">
                  <span className="prop-label">{prop.label}</span>
                  <span className="prop-value">{prop.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle2 size={18} color="var(--success)" />
            </div>
            <h4 style={{ fontSize: '15px', fontWeight: 600 }}>Backup Status</h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Last Backup</span>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '13px', fontWeight: 500 }}>May 29, 2025 02:15 AM</p>
                <span className="badge badge-success" style={{ fontSize: '10px', marginTop: '4px' }}>Successful</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Next Backup</span>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '13px', fontWeight: 500 }}>May 29, 2025 08:15 AM</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', justifyContent: 'flex-end', marginTop: '4px' }}>
                  <History size={12} /> <span style={{ fontSize: '10px' }}>Scheduled</span>
                </div>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: '12px', justifyContent: 'space-between', marginTop: '12px' }}>
              View Backup History <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Server size={18} color="var(--accent)" />
            </div>
            <h4 style={{ fontSize: '15px', fontWeight: 600 }}>Replication Status</h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { label: 'Primary', value: 'us-east-1 (This DB)', status: 'Primary', color: 'var(--accent)' },
              { label: 'Replica 1', value: 'us-east-1b', status: 'Healthy', color: 'var(--success)' },
              { label: 'Replica 2', value: 'us-west-2', status: 'Healthy', color: 'var(--success)' },
            ].map((node) => (
              <div key={node.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{node.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{node.value}</span>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: node.color }}>{node.status}</span>
                </div>
              </div>
            ))}
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: '12px', justifyContent: 'space-between', marginTop: '12px' }}>
              View Replication Topology <ChevronRight size={14} />
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(139, 92, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={18} color="#8b5cf6" />
            </div>
            <h4 style={{ fontSize: '15px', fontWeight: 600 }}>Recent Maintenance</h4>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { task: 'Vacuum Analyze', time: 'May 28, 2025 11:32 PM' },
              { task: 'Index Rebuild', time: 'May 27, 2025 03:14 AM' },
              { task: 'Statistics Update', time: 'May 26, 2025 01:08 AM' },
            ].map((item) => (
              <div key={item.task} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--accent)' }} />
                  <span style={{ fontSize: '13px' }}>{item.task}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{item.time}</p>
                  <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: 600 }}>Completed</span>
                </div>
              </div>
            ))}
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: '12px', justifyContent: 'space-between', marginTop: '12px' }}>
              View All Maintenance Events <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AuditTrailView = ({ onSelectEvent }) => {
  const auditEvents = [
    { id: 1, timestamp: 'May 29, 2025 14:32:18', actor: 'Super Admin', actorEmail: 'super@zenin.com', action: 'Updated User Role', target: 'user: sarah.chen', ip: '203.0.113.45', severity: 'High', status: 'Success' },
    { id: 2, timestamp: 'May 29, 2025 14:31:52', actor: 'Michael Rodriguez', actorEmail: 'michael@zenin.com', action: 'Created Database Backup', target: 'db: prod_main', ip: '198.51.100.22', severity: 'Medium', status: 'Success' },
    { id: 3, timestamp: 'May 29, 2025 14:30:45', actor: 'Emily Johnson', actorEmail: 'emily@zenin.com', action: 'Deleted User', target: 'user: john.doe', ip: '203.0.113.78', severity: 'Critical', status: 'Success' },
    { id: 4, timestamp: 'May 29, 2025 14:29:37', actor: 'David Kim', actorEmail: 'david@zenin.com', action: 'Updated Plan', target: 'plan: enterprise', ip: '198.51.100.99', severity: 'Medium', status: 'Success' },
    { id: 5, timestamp: 'May 29, 2025 14:28:16', actor: 'API Key: deploy-bot', actorEmail: 'bot@zenin.com', action: 'API Key Used', target: 'endpoint: /api/v1/deploy', ip: '203.0.113.12', severity: 'Low', status: 'Success' },
  ];

  return (
    <div className="fade-in">
      <SectionHeader 
        title="Audit Trail" 
        description="Monitor all administrative actions, configuration changes, and security-sensitive events." 
        breadcrumbs={['Audit Trail']} 
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={History} label="Total Events Today" value="1,285" trend="18.6% vs yesterday" trendUp={true} sparklineColor="#3b82f6" />
        <SummaryCard icon={ShieldAlert} label="Critical Events" value="23" trend="15.0% vs yesterday" trendUp={true} sparklineColor="#ef4444" />
        <SummaryCard icon={UserCheck} label="Admin Actions" value="842" trend="11.3% vs yesterday" trendUp={true} sparklineColor="#8b5cf6" />
        <SummaryCard icon={Download} label="Exported Logs" value="16" trend="6.7% vs yesterday" trendUp={true} sparklineColor="#10b981" />
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={14} /> May 23, 2025 00:00 - May 29, 2025 23:59
          </div>
          <select className="filter-select"><option>All Actors</option></select>
          <select className="filter-select"><option>All Categories</option></select>
          <select className="filter-select"><option>All Severities</option></select>
          <div className="search-input-wrapper" style={{ flex: 1, maxWidth: 'none' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" className="search-input" placeholder="Search actions, targets..." style={{ paddingLeft: '40px' }} />
          </div>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px', gap: '8px' }}>
            <Filter size={14} /> Filters
          </button>
        </div>

        <div className="table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Timestamp <ChevronDown size={12} style={{ display: 'inline' }} /></th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Source IP</th>
                <th>Severity</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {auditEvents.map((event) => (
                <tr key={event.id} onClick={() => onSelectEvent(event)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{event.timestamp}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600 }}>{event.actor.charAt(0)}</div>
                      <span style={{ fontSize: '13px' }}>{event.actor}</span>
                      <CheckCircle2 size={12} style={{ color: 'var(--accent)' }} />
                    </div>
                  </td>
                  <td style={{ fontWeight: 500, fontSize: '13px' }}>{event.action}</td>
                  <td style={{ color: 'var(--accent)', fontSize: '13px' }}>{event.target}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{event.ip}</td>
                  <td><span className={`badge badge-${event.severity.toLowerCase()}`}>{event.severity}</span></td>
                  <td>
                    <span className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>
                      <div className="dot dot-active" /> {event.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}><MoreVertical size={14} color="var(--text-muted)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>Showing 1 to 10 of 1,285 events</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">2</button>
            <button className="pagination-btn">3</button>
            <span>...</span>
            <button className="pagination-btn">129</button>
            <button className="pagination-btn"><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>10 per page</span>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>
    </div>
  );
};

const BillingView = ({ stats }) => (
  <div className="fade-in">
    <SectionHeader 
      title="Billing & Subscriptions" 
      description="Manage your workspace plan, payment methods, invoices, and billing activity." 
      breadcrumbs={['Billing']} 
    />
    
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
      <SummaryCard icon={BillingIcon} label="Monthly Recurring Revenue (MRR)" value="$128,560" trend="9.8% vs last month" trendUp={true} sparklineColor="#3b82f6" />
      <SummaryCard icon={Calendar} label="Active Subscriptions" value="1,784" trend="6.3% vs last 30 days" trendUp={true} sparklineColor="#8b5cf6" />
      <SummaryCard icon={AlertCircle} label="Failed Payments" value="12" trend="14.3% vs last 30 days" trendUp={false} sparklineColor="#ef4444" />
      <SummaryCard icon={BillingIcon} label="Outstanding Invoices" value="$24,350" trend="8.2% vs last month" trendUp={true} sparklineColor="#f59e0b" />
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px', marginBottom: '24px' }}>
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(59, 130, 246, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Box size={24} color="var(--accent)" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Enterprise Plan</h3>
                <span className="badge badge-success" style={{ fontSize: '10px' }}>Active</span>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>For high-growth teams and advanced operations</p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <span className="badge" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', fontSize: '10px' }}>Annual Billing</span>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Save 20% with annual billing</span>
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>Billing Cycle</p>
            <div className="billing-cycle-toggle">
              <button className="billing-cycle-btn">Monthly</button>
              <button className="billing-cycle-btn active">Annual <span style={{ color: 'var(--accent)', marginLeft: '4px' }}>-20%</span></button>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px' }}>
          <div>
            {[
              { label: 'Renewal Date', value: 'Jun 29, 2025 (in 30 days)' },
              { label: 'Included Seats', value: '250 seats' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                <span style={{ fontWeight: 500 }}>{item.value}</span>
              </div>
            ))}
            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Current Usage</span>
                <span style={{ fontWeight: 500 }}>184 of 250 seats used</span>
              </div>
              <div className="usage-bar-container">
                <div className="usage-bar" style={{ width: '74%' }} />
              </div>
              <div style={{ textAlign: 'right', fontSize: '11px', color: 'var(--text-muted)' }}>74%</div>
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '32px' }}>
            {[
              { label: 'Next Renewal', value: 'Jun 29, 2025' },
              { label: 'Next Billing Amount', value: '$154,272.00 USD' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '13px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
                <span style={{ fontWeight: 600 }}>{item.value}</span>
              </div>
            ))}
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Includes plan, add-ons, and applicable taxes</p>
            <button className="btn btn-secondary" style={{ width: '100%', marginTop: '24px', height: '40px' }}>Manage Plan</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <div className="card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600 }}>Payment Methods</h3>
            <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <Plus size={14} /> Add Payment Method
            </button>
          </div>
          <div className="payment-method-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="card-icon" style={{ background: '#1a1f24' }}>VISA</div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <p style={{ fontSize: '14px', fontWeight: 500 }}>Visa ending in 4242</p>
                  <span className="badge badge-success" style={{ fontSize: '10px', padding: '2px 6px' }}>Default</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Expires 04/27</span>
              <MoreVertical size={16} color="var(--text-muted)" style={{ cursor: 'pointer' }} />
            </div>
          </div>

          <div className="billing-contact-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '13px', fontWeight: 600 }}>Billing Contact</h4>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px' }}>Update Contact</button>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-app)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={16} color="var(--text-muted)" />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Sarah Chen</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>sarah.chen@acme.com</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>+1 (415) 555-0198</p>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <Lock size={12} /> Your payment information is encrypted and secure.
          </div>
        </div>
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '24px' }}>
      <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recent Invoices</h3>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>View All Invoices</button>
        </div>
        <div className="table-container" style={{ margin: 0 }}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Invoice ID</th>
                <th>Customer / Workspace</th>
                <th>Status</th>
                <th>Amount</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {[
                { id: 'INV-2025-0529-1842', customer: 'Acme Corp', status: 'Paid', amount: '$154,272.00', date: 'May 29, 2025' },
                { id: 'INV-2025-0429-1721', customer: 'Acme Corp', status: 'Paid', amount: '$154,272.00', date: 'Apr 29, 2025' },
                { id: 'INV-2025-0329-1604', customer: 'Acme Corp', status: 'Paid', amount: '$154,272.00', date: 'Mar 29, 2025' },
                { id: 'INV-2025-0227-1488', customer: 'Acme Corp', status: 'Pending', amount: '$154,272.00', date: 'Feb 27, 2025' },
                { id: 'INV-2025-0129-1360', customer: 'Acme Corp', status: 'Failed', amount: '$154,272.00', date: 'Jan 29, 2025' },
              ].map((inv) => (
                <tr key={inv.id}>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{inv.id}</td>
                  <td style={{ fontSize: '13px', fontWeight: 500 }}>{inv.customer}</td>
                  <td>
                    <span className={`badge badge-${inv.status.toLowerCase()}`} style={{ fontSize: '10px' }}>{inv.status}</span>
                  </td>
                  <td style={{ fontSize: '13px', fontWeight: 600 }}>{inv.amount}</td>
                  <td style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{inv.date}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', gap: '4px' }}>
                      <Download size={12} /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination" style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Showing 1 to 5 of 42 invoices</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">2</button>
            <button className="pagination-btn">3</button>
            <span>...</span>
            <button className="pagination-btn">9</button>
            <button className="pagination-btn"><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', gap: '24px', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
          <div style={{ paddingBottom: '12px', borderBottom: '2px solid var(--accent)', color: 'var(--accent)', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Recent Transactions</div>
          <div style={{ paddingBottom: '12px', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            Dunning Alerts <span className="dunning-badge">3</span>
          </div>
        </div>

        <div className="transaction-list">
          {[
            { id: 'INV-2025-0529-1842', amount: '$154,272.00', date: 'May 29, 2025 02:15 AM', type: 'received', statusColor: 'var(--success)' },
            { id: 'INV-2025-0429-1721', amount: '$154,272.00', date: 'Apr 29, 2025 02:14 AM', type: 'received', statusColor: 'var(--success)' },
            { id: 'INV-2025-0129-1360', amount: '$154,272.00', date: 'Jan 29, 2025 02:11 AM', type: 'failed', statusColor: 'var(--danger)' },
            { id: 'INV-2024-1231-0987', amount: '-$2,500.00', date: 'Dec 31, 2024 11:45 PM', type: 'refund', statusColor: '#f59e0b' },
            { id: 'INV-2024-1231-0987', amount: '$151,772.00', date: 'Dec 31, 2024 11:42 PM', type: 'received', statusColor: 'var(--success)' },
          ].map((tx, i) => (
            <div key={i} className="transaction-item">
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: `1px solid ${tx.statusColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {tx.type === 'received' && <CheckCircle2 size={14} color={tx.statusColor} />}
                {tx.type === 'failed' && <X size={14} color={tx.statusColor} />}
                {tx.type === 'refund' && <AlertCircle size={14} color={tx.statusColor} />}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 500 }}>Payment {tx.type}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{tx.id}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{tx.amount}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{tx.date}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <button style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px', margin: '0 auto', cursor: 'pointer' }}>
            View All Transactions <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  </div>
);

const LogsView = ({ logs, onRefresh, onSelectLog }) => {
  const dummyLogs = [
    { id: 1, createdAt: '2025-05-29 14:32:18', level: 'Error', service: 'Web API', endpoint: 'POST /api/v1/orders', message: 'Failed to process order due to payment gateway error', requestId: 'req_8f3b7a1c2d9e', ipAddress: '203.0.113.45', duration: '1,842 ms' },
    { id: 2, createdAt: '2025-05-29 14:31:52', level: 'Warning', service: 'Auth Service', endpoint: 'POST /auth/login', message: 'Invalid credentials for user attempt', requestId: 'req_9d2a6b4c7e1f', ipAddress: '198.51.100.22', duration: '312 ms' },
    { id: 3, createdAt: '2025-05-29 14:31:08', level: 'Info', service: 'Web API', endpoint: 'GET /api/v1/products', message: 'Fetched 25 products successfully', requestId: 'req_7c1d2e3f4a6b', ipAddress: '203.0.113.45', duration: '156 ms' },
    { id: 4, createdAt: '2025-05-29 14:30:45', level: 'Error', service: 'Database', endpoint: 'SELECT * FROM orders', message: 'Database query timeout after 5000ms', requestId: 'req_3b8c6d1e9f2a', ipAddress: 'system', duration: '5,023 ms' },
    { id: 5, createdAt: '2025-05-29 14:29:37', level: 'Info', service: 'Billing Service', endpoint: 'POST /api/v1/invoices', message: 'Invoice created successfully', requestId: 'req_1e9f3a6b2c7d', ipAddress: 'user_55b2c1d3', duration: '428 ms' },
    { id: 6, createdAt: '2025-05-29 14:28:18', level: 'Critical', service: 'Payment Service', endpoint: 'POST /payments/charge', message: 'Payment gateway unavailable', requestId: 'req_6d4c8b2f1a9e', ipAddress: 'user_55b2c1d3', duration: '10,231 ms' },
    { id: 7, createdAt: '2025-05-29 14:27:03', level: 'Warning', service: 'Storage Service', endpoint: 'PUT /storage/upload', message: 'High latency detected for file upload', requestId: 'req_2a1f9e3b7c6d', ipAddress: 'user_12a4f8b9', duration: '3,124 ms' },
    { id: 8, createdAt: '2025-05-29 14:26:22', level: 'Info', service: 'Auth Service', endpoint: 'POST /auth/refresh', message: 'Token refreshed successfully', requestId: 'req_4f6a2d9b8c1e', ipAddress: 'user_8c7d9f12', duration: '189 ms' },
  ];

  return (
    <div className="fade-in">
      <SectionHeader title="System Logs" description="Monitor events, incidents, and platform activity in real time." breadcrumbs={['System Logs']} />
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <SummaryCard icon={AlertCircle} label="Error Rate" value="0.24%" trend="0.11% vs last 7 days" trendUp={false} sparklineColor="#ef4444" />
        <SummaryCard icon={ZapOff} label="Failed Requests" value="128" trend="12.4% vs last 7 days" trendUp={false} sparklineColor="#f59e0b" />
        <SummaryCard icon={Lock} label="Auth Failures" value="23" trend="8.2% vs last 7 days" trendUp={false} sparklineColor="#a855f7" />
        <SummaryCard icon={ActivityIcon} label="Avg Latency" value="212 ms" trend="5.6% vs last 7 days" trendUp={true} sparklineColor="#3b82f6" />
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="search-input-wrapper" style={{ flex: 1 }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" className="search-input" placeholder="Search logs..." style={{ paddingLeft: '40px' }} />
          </div>
          <select className="filter-select"><option>Level (All)</option><option>Error</option><option>Warning</option><option>Info</option></select>
          <select className="filter-select"><option>Service (All)</option><option>Web API</option><option>Auth Service</option></select>
          <select className="filter-select"><option>Environment (All)</option><option>Production</option><option>Staging</option></select>
          <div className="filter-select" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={14} /> May 23, 2025 00:00 - May 29, 2025 23:59
          </div>
          <div className="live-toggle">
            <div className="live-dot" />
            <span>Live</span>
            <div style={{ width: '32px', height: '16px', background: 'var(--accent)', borderRadius: '8px', position: 'relative', cursor: 'pointer', marginLeft: '4px' }}>
              <div style={{ width: '12px', height: '12px', background: 'white', borderRadius: '50%', position: 'absolute', right: '2px', top: '2px' }} />
            </div>
          </div>
        </div>

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
              {dummyLogs.map((log) => (
                <tr key={log.id} onClick={() => onSelectLog(log)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{log.createdAt}</td>
                  <td><span className={`badge badge-${log.level.toLowerCase()}`} style={{ fontSize: '11px', padding: '2px 8px' }}>{log.level.toUpperCase()}</span></td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{log.service}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{log.endpoint}</td>
                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13px' }}>{log.message}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{log.requestId}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{log.ipAddress}</td>
                  <td style={{ fontWeight: 500, fontSize: '12px', color: log.level === 'Error' || log.level === 'Critical' ? '#ef4444' : 'inherit' }}>{log.duration}</td>
                  <td><MoreVertical size={14} color="var(--text-muted)" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <div>Showing 1 to 8 of 12,842 logs</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">2</button>
            <button className="pagination-btn">3</button>
            <span>...</span>
            <button className="pagination-btn">1285</button>
            <button className="pagination-btn"><ChevronRight size={16} /></button>
            <button className="pagination-btn"><ChevronLast size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>10 per page</span>
            <ChevronDown size={14} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Error Trend</h3>
            <select className="search-input" style={{ width: '120px', padding: '4px' }}><option>Last 7 days</option></select>
          </div>
          <div style={{ height: '280px' }}>
            <Line 
              data={{
                labels: ['May 23', 'May 24', 'May 25', 'May 26', 'May 27', 'May 28', 'May 29'],
                datasets: [{
                  label: 'Errors',
                  data: [12, 10, 15, 12, 14, 18, 14],
                  borderColor: '#ef4444',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  fill: true,
                  tension: 0.4
                }]
              }}
              options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' } } } }}
            />
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Slow Endpoints</h3>
            <select className="search-input" style={{ width: '120px', padding: '4px' }}><option>Last 24 hours</option></select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {[
              { endpoint: 'POST /api/v1/reports/generate', avg: '3,842 ms', p95: '8,921 ms', pct: 85 },
              { endpoint: 'POST /payments/charge', avg: '2,158 ms', p95: '6,231 ms', pct: 65 },
              { endpoint: 'PUT /storage/upload', avg: '1,782 ms', p95: '4,512 ms', pct: 55 },
              { endpoint: 'GET /api/v1/analytics/dashboard', avg: '1,245 ms', p95: '3,112 ms', pct: 45 },
              { endpoint: 'POST /api/v1/orders', avg: '1,103 ms', p95: '2,864 ms', pct: 40 },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{item.endpoint}</span>
                  <div style={{ display: 'flex', gap: '16px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Avg: {item.avg}</span>
                    <span style={{ fontWeight: 600 }}>95th: {item.p95}</span>
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
    </div>
  );
};

const SettingsView = () => (
  <div className="fade-in">
    <SectionHeader title="Settings" description="Manage platform preferences, security, integrations, and defaults." breadcrumbs={['Settings']} />
    
    <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
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
            <button className="btn btn-secondary" style={{ width: '100%', fontSize: '11px', padding: '6px', height: '32px' }}>Change Logo</button>
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
            <Toggle active={true} />
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
            <Toggle active={true} />
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
            <button className="btn btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', height: '32px' }}>Manage Roles</button>
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
            { icon: Mail, label: 'Email Alerts', desc: 'General system and account notifications' },
            { icon: AlertTriangle, label: 'System Incident Alerts', desc: 'Critical system incidents and outages' },
            { icon: Lock, label: 'Failed Login Alerts', desc: 'Get notified of suspicious login attempts' },
            { icon: BillingIcon, label: 'Billing Notices', desc: 'Invoices, payments, and billing updates' },
            { icon: BarChart3, label: 'Weekly Summary', desc: 'Receive a weekly activity summary' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <item.icon size={16} color="var(--text-muted)" style={{ marginTop: '2px' }} />
                <div>
                  <p style={{ fontSize: '13px', fontWeight: 600 }}>{item.label}</p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{item.desc}</p>
                </div>
              </div>
              <Toggle active={true} />
            </div>
          ))}
          <button className="btn btn-secondary" style={{ width: '100%', marginTop: '8px', height: '38px', fontSize: '12px', color: 'var(--accent)', borderColor: 'var(--accent-soft)' }}>Manage Notification Recipients</button>
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
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }}>Manage Keys</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <LinkIcon size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Webhook Endpoint</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>https://hooks.zenin.com/webhook</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }}>Edit</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Lock size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Webhook Secret</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022</p>
              </div>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px', height: '32px' }}>Rotate Secret</button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Box size={18} color="var(--text-muted)" />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>Environment</p>
              </div>
            </div>
            <span className="badge" style={{ padding: '4px 10px', fontSize: '11px', background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)' }}>Productiont</span>
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
            <button className="btn btn-secondary" style={{ padding: '6px 16px', fontSize: '12px', height: '32px' }}>Export Data</button>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <RotateCw size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Deactivate Workspace</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Temporarily deactivate this workspace.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }}>Deactivate</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Trash2 size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Reset Sandbox Data</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Permanently delete all sandbox data.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }}>Reset Sandbox</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid rgba(239, 68, 68, 0.1)', borderRadius: '12px', background: 'rgba(0,0,0,0.2)' }}>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Users size={18} color="#ef4444" style={{ marginTop: '2px' }} />
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#ef4444' }}>Revoke All Sessions</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Sign out all users from all devices.</p>
            </div>
          </div>
          <button className="btn" style={{ borderColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', background: 'transparent', fontSize: '11px', padding: '6px 12px', height: '32px' }}>Revoke Sessions</button>
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
        <button className="btn btn-secondary" style={{ width: '120px' }}>Cancel</button>
        <button className="btn btn-primary" style={{ width: '180px' }} onClick={() => alert('Settings saved successfully.')}>Save All Changes</button>
      </div>
    </div>
  </div>
);

const IntegrationsView = () => (
  <div className="fade-in">
    <SectionHeader title="Integrations" description="Connect and manage external tools, services, and workflows." breadcrumbs={['Integrations']} />
    
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
      <SummaryCard icon={LayoutGrid} label="Connected Apps" value="12" trend="2 new this week" trendUp={true} sparklineColor="#3b82f6" />
      <SummaryCard icon={Activity} label="Sync Health" value="99.6%" trend="0.8% vs last 7 days" trendUp={true} sparklineColor="#10b981" />
      <SummaryCard icon={Webhook} label="Webhooks Active" value="18" trend="3 new this week" trendUp={true} sparklineColor="#8b5cf6" />
      <SummaryCard icon={AlertTriangle} label="Failed Syncs" value="7" trend="3 vs last 7 days" trendUp={false} sparklineColor="#ef4444" />
    </div>

    <div className="integrations-main-grid">
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>All Integrations</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="search-input-wrapper" style={{ width: '240px' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input type="text" className="search-input" placeholder="Search integrations..." style={{ paddingLeft: '32px', fontSize: '12px' }} />
            </div>
            <select className="search-input" style={{ width: '140px', fontSize: '12px' }}><option>All Categories</option></select>
            <select className="search-input" style={{ width: '120px', fontSize: '12px' }}><option>All Statuses</option></select>
            <div style={{ display: 'flex', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: '8px', padding: '2px' }}>
              <div style={{ padding: '6px', borderRadius: '6px', background: 'var(--accent)', color: 'white' }}><LayoutGrid size={16} /></div>
              <div style={{ padding: '6px', borderRadius: '6px', color: 'var(--text-muted)' }}><List size={16} /></div>
            </div>
          </div>
        </div>

        <div className="integration-card-grid">
          {[
            { name: 'Stripe', category: 'Payments', icon: CreditCard, color: '#6366f1', status: 'Active', sync: '2 minutes ago', button: 'Manage' },
            { name: 'Webhooks', category: 'Developer', icon: Webhook, color: '#8b5cf6', status: 'Active', sync: '30 seconds ago', button: 'Manage' },
            { name: 'Slack', category: 'Communication', icon: MessageSquare, color: '#10b981', status: 'Active', sync: '1 minute ago', button: 'Manage' },
            { name: 'Analytics', category: 'Analytics', icon: BarChart, color: '#f59e0b', status: 'Active', sync: '5 minutes ago', button: 'Manage' },
            { name: 'Email Service', category: 'Marketing', icon: Mail, color: '#3b82f6', status: 'Active', sync: '3 minutes ago', button: 'Manage' },
            { name: 'CRM', category: 'Sales', icon: Users, color: '#10b981', status: 'Warning', sync: '2 days ago', button: 'Reconnect', isWarning: true },
            { name: 'Storage', category: 'File Storage', icon: HardDrive, color: '#8b5cf6', status: 'Active', sync: '10 minutes ago', button: 'Manage' },
            { name: 'Custom API', category: 'Developer', icon: Code, color: 'var(--text-muted)', status: 'Inactive', sync: 'Never connected', button: 'Connect', isInactive: true },
          ].map((app, i) => (
            <div key={i} className="integration-card">
              <div style={{ display: 'flex', gap: '16px' }}>
                <div className="integration-icon-wrapper" style={{ background: `${app.color}15` }}>
                  <app.icon size={24} color={app.color} />
                </div>
                <div>
                  <h4 style={{ fontSize: '15px', fontWeight: 600 }}>{app.name}</h4>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{app.category}</p>
                  <div className="sync-status">
                    <div className="sync-dot" style={{ background: app.isInactive ? 'var(--text-muted)' : app.isWarning ? '#f59e0b' : 'var(--success)' }} />
                    Last sync: {app.sync}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button 
                  className={`btn ${app.isInactive ? 'btn-primary' : 'btn-secondary'}`} 
                  style={{ fontSize: '12px', padding: '6px 16px' }}
                  onClick={() => alert(`Managing ${app.name} integration...`)}
                >
                  {app.button}
                </button>
                <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => alert('Options: Sync now, Disconnect, View Logs')}><MoreHorizontal size={14} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="pagination" style={{ marginTop: '32px' }}>
          <div>Showing 1 to 8 of 12 integrations</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="pagination-btn" disabled><ChevronLeft size={16} /></button>
            <button className="pagination-btn active">1</button>
            <button className="pagination-btn">2</button>
            <button className="pagination-btn"><ChevronRight size={16} /></button>
          </div>
          <select className="search-input" style={{ width: '100px', fontSize: '12px' }}><option>8 per page</option></select>
        </div>
      </div>

      <div style={{ paddingTop: '56px' }}>
        <div className="integration-side-section">
          <div className="integration-side-header">
            <h4 style={{ fontSize: '14px', fontWeight: 600 }}>API Keys</h4>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>View All</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {[
              { name: 'Default API Key', value: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022abcd', status: 'Active', date: 'May 20, 2025' },
              { name: 'Read Only Key', value: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022efgh', status: 'Active', date: 'May 18, 2025' },
              { name: 'Webhook Key', value: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022ijkl', status: 'Active', date: 'May 15, 2025' },
            ].map((key, i) => (
              <div key={i} className="integration-side-item">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{key.name}</span>
                  <span className="status-badge" style={{ background: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)', padding: '2px 6px', fontSize: '10px' }}>{key.status}</span>
                </div>
                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>{key.value}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Created {key.date}</p>
              </div>
            ))}
          </div>
          <button 
            className="btn btn-secondary" 
            style={{ width: '100%', marginTop: '16px', gap: '8px', fontSize: '13px' }}
            onClick={() => alert('New API Key generated: zn_live_9f2a7c...')}
          >
            <Plus size={14} /> Create New API Key
          </button>
        </div>
      </div>
    </div>
  </div>
);

// --- Main App ---

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isEventPanelOpen, setIsEventPanelOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const [billingStats, setBillingStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [error, setError] = useState(null);

  const checkAuth = async () => {
    try {
      const data = await adminFetch('/../auth/me'); // Go up one level to standard auth
      if (data.authenticated && data.user?.isAdmin) {
        setIsAuthenticated(true);
        setUser(data.user);
      } else {
        setIsAuthenticated(false);
        setUser(null);
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      // Fallback for local development if needed, but safer to deny
      if (window.location.hostname === 'localhost') {
        setIsAuthenticated(true);
        setUser({ email: 'dev@zenin.com', displayName: 'Dev Admin', isAdmin: true });
      } else {
        setIsAuthenticated(false);
      }
    }
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
        const data = await adminFetch('/database');
        setDbStats(data);
      } else if (tab === 'billing') {
        const data = await adminFetch('/billing');
        setBillingStats(data);
      } else if (tab === 'logs' || tab === 'audit') {
        const { auditLogs, systemLogs } = await adminFetch('/logs');
        setLogs(systemLogs || []);
        setAuditLogs(auditLogs || []);
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
      fetchData();
    }
  }, [activeTab, isAuthenticated]);

  const handleUpdateUser = async (userId, type, value) => {
    try {
      if (type === 'plan') {
        await adminFetch(`/users/${userId}/plan`, {
          method: 'PATCH',
          body: JSON.stringify({ plan: value })
        });
      } else if (type === 'role') {
        await adminFetch(`/users/${userId}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ isAdmin: value })
        });
      } else if (type === 'suspend') {
        await adminFetch(`/users/${userId}/suspend`, {
          method: 'POST',
          body: JSON.stringify({ isSuspended: value })
        });
      } else if (type === 'delete') {
        if (confirm('Are you sure you want to permanently delete this user?')) {
          await adminFetch(`/users/${userId}`, { method: 'DELETE' });
          setIsPanelOpen(false);
        } else return;
      }
      await fetchData('users');
    } catch (err) {
      alert(`Action failed: ${err.message}`);
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      const { recoveryLink } = await adminFetch(`/users/${userId}/recover`, { method: 'POST' });
      alert(`Recovery link generated: ${recoveryLink}`);
    } catch (err) {
      alert(`Failed to generate recovery link: ${err.message}`);
    }
  };

  const runMigration = async () => {
    try {
      const res = await adminFetch('/migrations/admin-workspace', { method: 'POST' });
      alert('Migration successful');
      fetchData('database');
    } catch (err) {
      alert(`Migration failed: ${err.message}`);
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
              // Redirect to main Zenin Web App login
              const hostname = window.location.hostname.toLowerCase();
              let mainAppUrl;
              
              if (hostname === 'localhost' || hostname === '127.0.0.1') {
                mainAppUrl = window.location.origin.replace(':4001', ':3000');
              } else if (hostname === 'admin.zenin.capital') {
                mainAppUrl = 'https://zenin.capital';
              } else {
                // Fallback for other environments (e.g., preview)
                mainAppUrl = window.location.origin.replace('admin.', '');
              }
              
              window.location.href = `${mainAppUrl}/login?redirect=${encodeURIComponent(window.location.href)}`;
            }}
          >
            Authenticate with Zenin
          </button>
          
          <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border)' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Having trouble? <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={() => window.location.reload()}>Retry Connection</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (loading && !stats && !dbStats && !billingStats && users.length === 0 && logs.length === 0) {
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
      case 'overview': return <OverviewView stats={stats} fetchData={() => fetchData('overview')} />;
      case 'users': return (
        <UserManagementView 
          users={users} 
          searchQuery={searchQuery} 
          setSearchQuery={setSearchQuery} 
          onUpdateUser={handleUpdateUser} 
          onAddUser={() => setIsAddUserModalOpen(true)}
          onSelectUser={(user) => {
            setSelectedUser(user);
            setIsPanelOpen(true);
          }}
        />
      );
      case 'audit': return (
        <AuditTrailView 
          auditLogs={auditLogs}
          onSelectEvent={(event) => {
            setSelectedEvent(event);
            setIsEventPanelOpen(true);
          }} 
        />
      );
      case 'database': return <DatabaseView stats={dbStats} onRunMigration={runMigration} />;
      case 'billing': return <BillingView stats={billingStats} />;
      case 'logs': return (
        <LogsView 
          logs={logs} 
          onRefresh={() => fetchData('logs')} 
          onSelectLog={(log) => {
            setSelectedLog(log);
            setIsLogPanelOpen(true);
          }}
        />
      );
      case 'settings': return <SettingsView />;
      case 'integrations': return <IntegrationsView />;
      default: return <OverviewView stats={stats} fetchData={() => fetchData('overview')} />;
    }
  };

  return (
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
          <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <span>View Status Page</span> <ExternalLink size={10} />
          </div>
          <div className="nav-item" style={{ marginTop: '16px', margin: '16px -16px 0 -16px', padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }} onClick={() => setIsLogoutModalOpen(true)}>
            <LogOut size={18} style={{ transform: 'rotate(180deg)' }} />
            <span>Logout</span>
          </div>
        </div>
      </aside>

      <main className="main-wrapper">
        <header className="top-nav">
          <div className="search-input-wrapper">
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input type="text" className="search-input" placeholder="Search users, logs, databases..." />
            <div className="search-shortcut">
              <span style={{ fontSize: '12px' }}>⌘</span>
              <span>K</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <button style={{ position: 'relative', background: 'none', border: 'none', color: 'var(--text-secondary)' }}>
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
          onUpdate={handleUpdateUser}
          onResetPassword={handleResetPassword}
          onClose={() => {
            setIsPanelOpen(false);
            setSelectedUser(null);
          }} 
        />
      )}
      <AddUserModal 
        isOpen={isAddUserModalOpen} 
        onClose={() => setIsAddUserModalOpen(false)} 
        onAdd={(userData) => {
          console.log('Adding user:', userData);
          // In a real app, you'd call a POST /api/admin/users endpoint
          // For now, we'll alert and refresh users list if the endpoint existed
          alert(`In a real deployment, this would create: ${userData.email}`);
          fetchData('users');
        }}
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
          onClose={() => {
            setIsLogPanelOpen(false);
            setSelectedLog(null);
          }} 
        />
      )}
      {isLogoutModalOpen && (
        <LogoutModal 
          onClose={() => setIsLogoutModalOpen(false)} 
          onLogout={() => {
            setIsLogoutModalOpen(false);
            // In a real app, perform logout logic here
          }} 
        />
      )}
    </div>
  );
}
