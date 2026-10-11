import { useEffect, useState } from 'react';
import { fmtDate, fmtNum } from '../api';
import { useAdmin } from '../hooks';
import { go } from '../router';

interface UserRow {
  id: string;
  name: string;
  email: string;
  email_verified: number;
  created_at: string;
  banned: number | null;
  sub_tier: string | null;
  sub_status: string | null;
  sub_expires_at: number | null;
  balance: number;
}

export function Users() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);
  const { data, error, loading } = useAdmin<{ users: UserRow[]; limit: number }>(`/users?q=${encodeURIComponent(debounced)}&limit=50&offset=${offset}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="muted">Search by email, name or user ID.</p>
        </div>
        <input className="search" type="search" placeholder="Search users…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th className="num">Credits</th>
              <th>Joined</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.users.map((u) => {
              const active = u.sub_tier && u.sub_expires_at && u.sub_expires_at > Date.now() && u.sub_status !== 'expired';
              return (
                <tr key={u.id} className="click" onClick={() => go(`/users/${u.id}`)}>
                  <td>
                    <a href={`#/users/${u.id}`} onClick={(e) => e.stopPropagation()}>
                      {u.email}
                    </a>
                    {!u.email_verified && <span className="faint"> · unverified</span>}
                  </td>
                  <td>{active ? <span className={`badge ${u.sub_tier}`}>{u.sub_tier!.toUpperCase()}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{fmtNum(u.balance)}</td>
                  <td>{fmtDate(u.created_at, false)}</td>
                  <td>{u.banned ? <span className="badge danger">Suspended</span> : <span className="badge ok">Active</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.users.length === 0 && <div className="empty">No users found.</div>}
        {loading && !data && <div className="empty">Loading…</div>}
      </div>
      <div className="row section">
        <button className="secondary" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - 50))}>
          Previous
        </button>
        <button className="secondary" disabled={!data || data.users.length < 50} onClick={() => setOffset((o) => o + 50)}>
          Next
        </button>
      </div>
    </>
  );
}
