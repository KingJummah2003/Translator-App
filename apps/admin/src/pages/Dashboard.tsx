import { fmtNum, fmtUsd } from '../api';
import { useAdmin } from '../hooks';

interface Stats {
  users: { total: number; last7: number; last30: number };
  activeSubscriptions: { tier: string; product_id: string; n: number }[];
  revenue30d: { kind: string; n: number; usd: number }[];
  usageByDay: { day: string; requests: number; chars: number; credits: number; ocr_images: number }[];
  activePasses: number;
  settings: { servicePaused: boolean; globalDailyCharCap: number; globalDailyOcrCap: number };
}

export function Dashboard() {
  const { data, error, loading } = useAdmin<Stats>('/stats');
  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">{loading ? 'Loading…' : ''}</p>;

  const subs = (tier: string) => data.activeSubscriptions.filter((s) => s.tier === tier).reduce((a, s) => a + s.n, 0);
  const revenue = data.revenue30d.reduce((a, r) => a + r.usd, 0);
  const days = [...data.usageByDay].reverse();
  const today = data.usageByDay[0];
  const maxChars = Math.max(1, ...days.map((d) => d.chars));
  const capUse = data.settings.globalDailyCharCap ? (today?.chars ?? 0) / data.settings.globalDailyCharCap : 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Last 30 days. Revenue is gross store price from RevenueCat, before store fees.</p>
        </div>
        <span className={`badge ${data.settings.servicePaused ? 'danger' : 'ok'}`}>
          Cloud service {data.settings.servicePaused ? 'paused' : 'running'}
        </span>
      </div>

      <div className="grid stats">
        <div className="card stat">
          <div className="label">Users</div>
          <div className="value">{fmtNum(data.users.total)}</div>
          <div className="sub">+{fmtNum(data.users.last7)} this week · +{fmtNum(data.users.last30)} in 30 days</div>
        </div>
        <div className="card stat">
          <div className="label">Pro subscribers</div>
          <div className="value">{fmtNum(subs('pro'))}</div>
        </div>
        <div className="card stat">
          <div className="label">VIP subscribers</div>
          <div className="value">{fmtNum(subs('vip'))}</div>
        </div>
        <div className="card stat">
          <div className="label">Active 3-hour passes</div>
          <div className="value">{fmtNum(data.activePasses)}</div>
        </div>
        <div className="card stat">
          <div className="label">Revenue (30 days)</div>
          <div className="value">{fmtUsd(revenue)}</div>
          <div className="sub">{data.revenue30d.map((r) => `${r.kind}: ${fmtUsd(r.usd)}`).join(' · ') || 'No purchases yet'}</div>
        </div>
        <div className="card stat">
          <div className="label">Today's cloud usage</div>
          <div className="value">{fmtNum(today?.chars)}</div>
          <div className="sub">
            characters · {Math.round(capUse * 100)}% of daily cap · {fmtNum(today?.ocr_images)} images
          </div>
        </div>
      </div>

      <div className="grid two section">
        <div className="card">
          <h2>Characters translated per day</h2>
          {days.length === 0 ? (
            <div className="empty">No usage yet.</div>
          ) : (
            <>
              <div className="bars" role="img" aria-label="Characters per day for the last 30 days">
                {days.map((d) => (
                  <div key={d.day} className="bar" style={{ height: `${(d.chars / maxChars) * 100}%` }} title={`${d.day}: ${fmtNum(d.chars)} characters, ${fmtNum(d.requests)} requests`} />
                ))}
              </div>
              <div className="bars-axis">
                <span>{days[0]?.day}</span>
                <span>{days[days.length - 1]?.day}</span>
              </div>
            </>
          )}
        </div>
        <div className="card">
          <h2>Active subscriptions by product</h2>
          {data.activeSubscriptions.length === 0 ? (
            <div className="empty">No active subscriptions.</div>
          ) : (
            <table>
              <tbody>
                {data.activeSubscriptions.map((s) => (
                  <tr key={s.product_id}>
                    <td>
                      <span className={`badge ${s.tier}`}>{s.tier.toUpperCase()}</span> {s.product_id}
                    </td>
                    <td className="num">{fmtNum(s.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
