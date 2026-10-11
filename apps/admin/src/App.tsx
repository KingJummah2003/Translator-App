import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { Purchases } from './pages/Purchases';
import { Settings } from './pages/Settings';
import { UserDetail } from './pages/UserDetail';
import { Users } from './pages/Users';
import { useAdmin } from './hooks';
import { useRoute } from './router';

const NAV = [
  ['', 'Dashboard'],
  ['users', 'Users'],
  ['purchases', 'Purchases'],
  ['audit', 'Audit log'],
  ['settings', 'Service settings'],
] as const;

export function App() {
  const [section = '', id] = useRoute();
  const me = useAdmin<{ email: string }>('/me');

  if (me.error) {
    return (
      <div className="main">
        <h1>Admin access required</h1>
        <p className="muted">{me.error}</p>
        <p className="muted">Sign in through Cloudflare Access, or ask the owner to add your email to the Access policy.</p>
      </div>
    );
  }

  let page;
  if (section === 'users' && id) page = <UserDetail id={id} />;
  else if (section === 'users') page = <Users />;
  else if (section === 'purchases') page = <Purchases />;
  else if (section === 'audit') page = <Audit />;
  else if (section === 'settings') page = <Settings />;
  else page = <Dashboard />;

  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">
          Translator <span>Admin</span>
        </div>
        {NAV.map(([path, label]) => (
          <a key={path} href={`#/${path}`} className={section === path ? 'active' : undefined} aria-current={section === path ? 'page' : undefined}>
            {label}
          </a>
        ))}
        <div className="who">{me.data?.email}</div>
      </nav>
      <main className="main">{page}</main>
    </div>
  );
}
