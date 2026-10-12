import { fmtDate } from '../api';
import { useAdmin } from '../hooks';

interface Entry {
  id: string;
  admin_email: string;
  action: string;
  target_user_id: string | null;
  details: string | null;
  created_at: number;
}

export function Audit() {
  const { data, error } = useAdmin<{ entries: Entry[] }>('/audit?limit=200');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Every change made from this portal, newest first.</p>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Admin</th>
              <th>Action</th>
              <th>User</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{fmtDate(e.created_at)}</td>
                <td>{e.admin_email}</td>
                <td>{e.action}</td>
                <td>{e.target_user_id ? <a href={`#/users/${e.target_user_id}`} className="mono">{e.target_user_id.slice(0, 8)}…</a> : '—'}</td>
                <td className="mono">{e.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.entries.length === 0 && <div className="empty">Nothing yet.</div>}
      </div>
    </>
  );
}
