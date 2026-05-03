import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Database, 
  BarChart3, 
  Settings, 
  Search, 
  LogOut, 
  Activity,
  ShieldCheck,
  TrendingUp,
  CreditCard,
  Layers
} from 'lucide-react';

// Mock data for initial development
const MOCK_STATS = [
  { label: 'Total Users', value: '1,284', icon: <Users size={20} />, trend: '+12%', color: 'var(--accent)' },
  { label: 'Active Sessions', value: '42', icon: <Activity size={20} />, trend: '+5%', color: 'var(--success)' },
  { label: 'Total Trades', value: '18,520', icon: <TrendingUp size={20} />, trend: '+24%', color: 'var(--warning)' },
  { label: 'Pro Subscriptions', value: '156', icon: <CreditCard size={20} />, trend: '+8%', color: 'var(--danger)' },
];

const MOCK_USERS = [
  { id: 1, email: 'admin@zenin.app', name: 'System Admin', plan: 'pro', status: 'active', joined: '2026-01-15' },
  { id: 2, email: 'user@example.com', name: 'John Doe', plan: 'starter', status: 'active', joined: '2026-03-22' },
  { id: 3, email: 'jane@fintech.io', name: 'Jane Smith', plan: 'pro', status: 'inactive', joined: '2026-04-05' },
  { id: 4, email: 'dev@test.com', name: 'Developer Account', plan: 'desk', status: 'active', joined: '2026-04-10' },
];

const NavItem = ({ icon, label, active, onClick }) => (
  <button 
    className={`nav-item ${active ? 'active' : ''}`} 
    onClick={onClick}
  >
    {icon}
    <span>{label}</span>
  </button>
);

const StatCard = ({ label, value, icon, trend, color }) => (
  <div className="card">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
      <div style={{ padding: '0.5rem', background: 'var(--bg-tertiary)', borderRadius: '0.5rem', color: color }}>
        {icon}
      </div>
      <span style={{ fontSize: '0.75rem', color: trend.startsWith('+') ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
        {trend}
      </span>
    </div>
    <h3 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{value}</h3>
    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{label}</p>
  </div>
);

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [recoveryLink, setRecoveryLink] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const statsRes = await fetch('/api/admin/stats');
      if (!statsRes.ok) {
        if (statsRes.status === 403 || statsRes.status === 401) {
          setIsAuthenticated(false);
          return;
        }
        throw new Error('Failed to fetch stats');
      }
      const statsData = await statsRes.json();
      setIsAuthenticated(true);
      
      setStats([
        { label: 'Total Users', value: statsData.totalUsers.toLocaleString(), icon: <Users size={20} />, trend: '+0%', color: 'var(--accent)' },
        { label: 'Active Sessions', value: statsData.activeSessions.toLocaleString(), icon: <Activity size={20} />, trend: '+0%', color: 'var(--success)' },
        { label: 'Total Trades', value: statsData.totalTrades.toLocaleString(), icon: <TrendingUp size={20} />, trend: '+0%', color: 'var(--warning)' },
        { label: 'Pro Subscriptions', value: statsData.proSubscriptions.toLocaleString(), icon: <CreditCard size={20} />, trend: '+0%', color: 'var(--danger)' },
      ]);

      const usersRes = await fetch('/api/admin/users');
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData);
      }
      
      setError(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      
      await fetchData();
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePlan = async (userId, plan) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan })
      });
      if (res.ok) fetchData();
    } catch (err) {
      alert('Failed to update plan');
    }
  };

  const handleToggleAdmin = async (userId, currentStatus) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAdmin: !currentStatus })
      });
      if (res.ok) fetchData();
    } catch (err) {
      alert('Failed to update admin status');
    }
  };

  const handleRecover = async (userId) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/recover`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        setRecoveryLink(data.recoveryLink);
      }
    } catch (err) {
      alert('Failed to generate recovery link');
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/signout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setIsAuthenticated(false);
      setUsers([]);
      setStats([]);
      setActiveTab('overview');
      // Force return to admin homepage/login
      window.location.href = window.location.origin;
    }
  };

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      if (res.ok) setForgotSent(true);
      else throw new Error('Could not send reset link');
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated && !error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div className="glass-card" style={{ width: '100%', maxWidth: '400px', padding: '3rem' }}>
          <div className="logo" style={{ justifyContent: 'center' }}>
            <ShieldCheck size={32} color="var(--accent)" />
            Zenin<span>Admin</span>
          </div>
          
          {showForgot ? (
            <>
              <h2 style={{ textAlign: 'center', marginBottom: '1rem' }}>Recover Access</h2>
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '2rem' }}>
                Enter your admin email to receive a secure recovery link.
              </p>
              
              {forgotSent ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--success)', marginBottom: '1.5rem' }}>✓ Reset link sent to your email</div>
                  <button onClick={() => setShowForgot(false)} className="btn-secondary" style={{ width: '100%' }}>Back to Login</button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Admin Email</label>
                    <input 
                      type="email" 
                      required 
                      style={{ width: '100%' }} 
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="admin@zenin.capital"
                    />
                  </div>
                  <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%' }}>
                    {loading ? 'Sending...' : 'Send Recovery Link'}
                  </button>
                  <button type="button" onClick={() => setShowForgot(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.875rem', cursor: 'pointer' }}>
                    Cancel
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <h2 style={{ textAlign: 'center', marginBottom: '2rem' }}>Sign In</h2>
              
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Admin Email</label>
                  <input 
                    type="email" 
                    required 
                    style={{ width: '100%' }} 
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="admin@zenin.capital"
                  />
                </div>
                
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Password</label>
                    <button type="button" onClick={() => setShowForgot(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer' }}>
                      Forgot?
                    </button>
                  </div>
                  <input 
                    type="password" 
                    required 
                    style={{ width: '100%' }} 
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                {loginError && (
                  <p style={{ color: 'var(--danger)', fontSize: '0.875rem', textAlign: 'center' }}>{loginError}</p>
                )}

                <button type="submit" className="btn-primary" disabled={loading} style={{ width: '100%', padding: '0.75rem' }}>
                  {loading ? 'Authenticating...' : 'Access Dashboard'}
                </button>
              </form>
            </>
          )}
          
          <p style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Strictly authorized access only. All actions are logged.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <ShieldCheck size={28} color="var(--accent)" />
          Zenin<span>Admin</span>
        </div>
        
        <nav style={{ flex: 1 }}>
          <NavItem 
            icon={<BarChart3 size={20} />} 
            label="Overview" 
            active={activeTab === 'overview'} 
            onClick={() => setActiveTab('overview')}
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="Users" 
            active={activeTab === 'users'} 
            onClick={() => setActiveTab('users')}
          />
          <NavItem 
            icon={<Database size={20} />} 
            label="Database" 
            active={activeTab === 'database'} 
            onClick={() => setActiveTab('database')}
          />
          <NavItem 
            icon={<Layers size={20} />} 
            label="System Logs" 
            active={activeTab === 'logs'} 
            onClick={() => setActiveTab('logs')}
          />
        </nav>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <NavItem 
            icon={<Settings size={20} />} 
            label="Settings" 
            active={activeTab === 'settings'}
            onClick={() => setActiveTab('settings')}
          />
          <NavItem icon={<LogOut size={20} />} label="Logout" onClick={handleLogout} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.875rem' }}>
              {activeTab === 'overview' ? 'System Overview' : 
               activeTab === 'users' ? 'User Management' : 
               activeTab === 'database' ? 'Database Explorer' : 'System Logs'}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>Welcome back, Super Admin</p>
          </div>

          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} size={16} />
            <input 
              type="text" 
              placeholder="Search data..." 
              style={{ paddingLeft: '2.5rem', width: '300px' }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        {activeTab === 'overview' && (
          <>
            <div className="stats-grid">
              {loading && stats.length === 0 ? (
                [1, 2, 3, 4].map(i => (
                  <div key={i} className="card" style={{ height: '120px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <div style={{ width: '40px', height: '40px', background: 'var(--bg-tertiary)', borderRadius: '50%', marginBottom: '1rem' }} className="animate-pulse" />
                    <div style={{ width: '60%', height: '1.5rem', background: 'var(--bg-tertiary)', marginBottom: '0.5rem' }} className="animate-pulse" />
                  </div>
                ))
              ) : (
                stats.map((stat, idx) => (
                  <StatCard key={idx} {...stat} />
                ))
              )}
            </div>

            <div className="card">
              <h3 style={{ marginBottom: '1.5rem' }}>Recent Activity</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {users.slice(0, 3).map((user, i) => (
                  <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--bg-tertiary)', borderRadius: '0.75rem' }}>
                    <div style={{ padding: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', color: 'var(--accent)', borderRadius: '50%' }}>
                      <Activity size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 500 }}>User registration active</p>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{user.email} joined the platform</p>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(user.joined).toLocaleDateString()}
                    </span>
                  </div>
                ))}
                {users.length === 0 && !loading && (
                  <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No recent activity detected.</p>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'users' && (
          <>
            {recoveryLink && (
              <div className="glass-card" style={{ marginBottom: '2rem', border: '1px solid var(--accent)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Temporary Recovery Link Generated:</p>
                  <code style={{ color: 'var(--accent)', fontSize: '1rem' }}>{recoveryLink}</code>
                </div>
                <button className="btn-primary" onClick={() => setRecoveryLink(null)}>Dismiss</button>
              </div>
            )}
            
            <div className="card">
              {loading && users.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '4rem' }}>
                  <Activity className="animate-spin" size={32} style={{ opacity: 0.5 }} />
                  <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>Syncing with platform data...</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Plan</th>
                      <th>Status</th>
                      <th>Role</th>
                      <th>Joined</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users
                      .filter(u => 
                        u.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
                        (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase()))
                      )
                      .map(user => (
                      <tr key={user.id}>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600 }}>{user.name || 'No Name'}</span>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{user.email}</span>
                          </div>
                        </td>
                        <td>
                          <select 
                            value={user.plan} 
                            onChange={(e) => handleUpdatePlan(user.id, e.target.value)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }}
                          >
                            <option value="starter">Starter</option>
                            <option value="pro">Pro</option>
                            <option value="desk">Desk</option>
                          </select>
                        </td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--success)' }} />
                            Active
                          </span>
                        </td>
                        <td>
                          <button 
                            onClick={() => handleToggleAdmin(user.id, user.isAdmin)}
                            className={`badge ${user.isAdmin ? 'badge-danger' : 'badge-success'}`}
                          >
                            {user.isAdmin ? 'Admin' : 'User'}
                          </button>
                        </td>
                        <td style={{ color: 'var(--text-secondary)' }}>
                          {new Date(user.joined).toLocaleDateString()}
                        </td>
                        <td>
                          <button 
                            style={{ color: 'var(--accent)', marginRight: '1rem' }}
                            onClick={() => handleRecover(user.id)}
                          >
                            Recover
                          </button>
                        </td>
                      </tr>
                    ))}
                    {users.length > 0 && users.filter(u => 
                      u.email.toLowerCase().includes(searchQuery.toLowerCase()) || 
                      (u.name && u.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    ).length === 0 && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                          No users found matching "{searchQuery}"
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {activeTab === 'database' && (
          <div className="glass-card" style={{ textAlign: 'center', padding: '4rem' }}>
            <Database size={48} style={{ marginBottom: '1rem', opacity: 0.5 }} />
            <h2>Database Explorer</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Direct database management is coming soon.</p>
            <button className="btn-primary">Connect External DB</button>
          </div>
        )}

        {activeTab === 'settings' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
            <div className="card" style={{ alignSelf: 'start' }}>
              <h3 style={{ marginBottom: '1.5rem' }}>Profile</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <div style={{ width: '80px', height: '80px', background: 'var(--bg-tertiary)', borderRadius: '50%', margin: '0 auto 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--accent)' }}>
                    <ShieldCheck size={40} color="var(--accent)" />
                  </div>
                  <h4 style={{ fontSize: '1.125rem' }}>Super Admin</h4>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Full platform access</p>
                </div>
                <button className="btn-secondary" style={{ width: '100%' }}>Update Avatar</button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              <div className="card">
                <h3 style={{ marginBottom: '1.5rem' }}>Platform Configuration</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontWeight: 500 }}>Maintenance Mode</p>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Disable public access to the main platform</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" />
                      <span className="slider round"></span>
                    </label>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontWeight: 500 }}>New User Registrations</p>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Allow new guests to create accounts</p>
                    </div>
                    <label className="switch">
                      <input type="checkbox" defaultChecked />
                      <span className="slider round"></span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 style={{ marginBottom: '1.5rem' }}>API & Integration</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Resend API Key</label>
                    <input type="password" value="••••••••••••••••••••" readOnly style={{ width: '100%' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>EODHD Token</label>
                    <input type="password" value="••••••••••••••••••••" readOnly style={{ width: '100%' }} />
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>* Secrets are managed via environment variables and masked here for security.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
