import { useState } from 'react';
import { adminApi, fmtDate, fmtNum, fmtUsd } from '../api';
import { useAdmin } from '../hooks';
import { go } from '../router';

interface Detail {
  user: { id: string; name: string; email: string; email_verified: number; created_at: string; banned: number | null; ban_reason: string | null; ban_expires: string | null };
  signInMethods: { provider: string; created_at: string }[];
  sessions: { id: string; created_at: string; expires_at: string; user_agent: string | null }[];
  entitlements: {
    tier: string;
    balance: number;
    buckets: { kind: string; balance: number; expiresAt: string | null }[];
    subscription: { productId: string; expiresAt: string; willRenew: boolean } | null;
    pass: { expiresAt: string } | null;
    passesAvailable: number;
    rateLimitPerMinute: number;
  };
  purchases: { product_id: string; kind: string; store: string | null; environment: string | null; price_usd: number | null; purchased_at: number; refunded_at: number | null }[];
  passes: { id: string; status: string; activated_at: number | null; expires_at: number | null; created_at: number }[];
  ledger: { bucket_kind: string; delta: number; reason: string; actor: string | null; created_at: number }[];
  usage: { day: string; action: string; requests: number; chars: number; credits: number }[];
  audit: { admin_email: string; action: string; details: string; created_at: number }[];
}

const PROVIDERS: Record<string, string> = { credential: 'Email + password', apple: 'Apple', google: 'Google' };

export function UserDetail({ id }: { id: string }) {
  const { data, error, reload } = useAdmin<Detail>(`/users/${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  async function act(name: string, fn: () => Promise<unknown>, done: string) {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', text: done });
      setAmount('');
      setReason('');
      await reload();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(null);
    }
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;
  const { user, entitlements: e } = data;
  const needsReason = reason.trim().length < 3;

  return (
    <>
      <div className="page-head">
        <div>
          <a href="#/users">← Users</a>
          <h1>{user.email}</h1>
          <p className="muted mono">{user.id}</p>
        </div>
        <div className="row">
          <span className={`badge ${e.tier}`}>{e.tier.toUpperCase()}</span>
          {user.banned ? <span className="badge danger">Suspended</span> : <span className="badge ok">Active</span>}
        </div>
      </div>

      {notice && <div className={`banner ${notice.kind === 'error' ? 'error' : ''}`}>{notice.text}</div>}

      <div className="grid two">
        <div className="card">
          <h2>Account</h2>
          <dl className="kv">
            <dt>Name</dt>
            <dd>{user.name || '—'}</dd>
            <dt>Joined</dt>
            <dd>{fmtDate(user.created_at)}</dd>
            <dt>Email verified</dt>
            <dd>{user.email_verified ? 'Yes' : 'No'}</dd>
            <dt>Sign-in methods</dt>
            <dd>{data.signInMethods.map((m) => PROVIDERS[m.provider] ?? m.provider).join(', ') || 'Email code'}</dd>
            <dt>Active sessions</dt>
            <dd>{data.sessions.length}</dd>
            {user.banned ? (
              <>
                <dt>Suspension</dt>
                <dd>
                  {user.ban_reason} {user.ban_expires ? `(until ${fmtDate(user.ban_expires, false)})` : '(permanent)'}
                </dd>
              </>
            ) : null}
          </dl>
        </div>

        <div className="card">
          <h2>Plan and credits</h2>
          <dl className="kv">
            <dt>Balance</dt>
            <dd>
              <strong>{fmtNum(e.balance)}</strong> credits
            </dd>
            <dt>Subscription</dt>
            <dd>{e.subscription ? `${e.subscription.productId} · ${e.subscription.willRenew ? 'renews' : 'ends'} ${fmtDate(e.subscription.expiresAt, false)}` : '—'}</dd>
            <dt>3-hour pass</dt>
            <dd>{e.pass ? `Active until ${fmtDate(e.pass.expiresAt)}` : `${e.passesAvailable} unused`}</dd>
            <dt>Rate limit</dt>
            <dd>{e.rateLimitPerMinute} requests/minute</dd>
            {e.buckets.map((b) => (
              <FragmentRow key={b.kind + (b.expiresAt ?? '')} label={`• ${b.kind}`} value={`${fmtNum(b.balance)}${b.expiresAt ? ` (expires ${fmtDate(b.expiresAt)})` : ''}`} />
            ))}
          </dl>
        </div>
      </div>

      <div className="card section">
        <h2>Support actions</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Every action is recorded in the audit log with your email and the reason.
        </p>
        <div className="row" style={{ marginBottom: 16 }}>
          <label className="field">
            Credits (negative to remove)
            <input type="number" value={amount} onChange={(ev) => setAmount(ev.target.value)} placeholder="e.g. 50" style={{ width: 160 }} />
          </label>
          <label className="field" style={{ flex: 1 }}>
            Reason (required)
            <input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Refund for failed document translation" />
          </label>
        </div>
        <div className="row">
          <button
            disabled={busy !== null || needsReason || !Number(amount)}
            onClick={() => {
              const n = Number(amount);
              if (Math.abs(n) >= 1000 && !confirm(`${n > 0 ? 'Give' : 'Remove'} ${Math.abs(n).toLocaleString()} credits? Please double-check the amount.`)) return;
              void act('credits', () => adminApi(`/users/${id}/credits`, { method: 'POST', json: { amount: n, reason } }), 'Credits updated.');
            }}>
            {Number(amount) < 0 ? 'Remove credits' : 'Give credits'}
          </button>
          <button
            className="secondary"
            disabled={busy !== null || needsReason}
            onClick={() => void act('pass', () => adminApi(`/users/${id}/passes`, { method: 'POST', json: { count: 1, reason } }), 'Gave one 3-hour pass.')}>
            Give a 3-hour pass
          </button>
          <button className="secondary" disabled={busy !== null} onClick={() => void act('sync', () => adminApi(`/users/${id}/sync-subscription`, { method: 'POST' }), 'Subscription re-synced from RevenueCat.')}>
            Re-sync subscription
          </button>
          <button className="secondary" disabled={busy !== null} onClick={() => void act('signout', () => adminApi(`/users/${id}/sign-out`, { method: 'POST' }), 'All sessions signed out.')}>
            Sign out everywhere
          </button>
          {user.banned ? (
            <button className="secondary" disabled={busy !== null} onClick={() => void act('unban', () => adminApi(`/users/${id}/unban`, { method: 'POST' }), 'Suspension lifted.')}>
              Lift suspension
            </button>
          ) : (
            <button
              className="danger"
              disabled={busy !== null || needsReason}
              onClick={() => {
                if (confirm(`Suspend ${user.email}? They will be signed out and blocked from signing in.`)) {
                  void act('ban', () => adminApi(`/users/${id}/ban`, { method: 'POST', json: { reason } }), 'User suspended.');
                }
              }}>
              Suspend
            </button>
          )}
          <button
            className="danger"
            disabled={busy !== null}
            onClick={() => {
              const typed = prompt(`This permanently deletes ${user.email} and all their data (purchases are kept without the link). Type the email to confirm.`);
              if (typed === user.email) {
                void act('delete', async () => {
                  await adminApi(`/users/${id}?confirm=${encodeURIComponent(id)}`, { method: 'DELETE' });
                  go('/users');
                }, 'Account deleted.');
              }
            }}>
            Delete account
          </button>
        </div>
      </div>

      <div className="grid two section">
        <Table
          title="Purchases"
          empty="No purchases."
          head={['Product', 'Store', 'Price', 'Date', '']}
          rows={data.purchases.map((p) => [
            p.product_id,
            `${p.store ?? '—'}${p.environment === 'SANDBOX' ? ' (test)' : ''}`,
            p.price_usd != null ? fmtUsd(p.price_usd) : '—',
            fmtDate(p.purchased_at),
            p.refunded_at ? <span className="badge danger">Refunded</span> : '',
          ])}
        />
        <Table
          title="Credit history"
          empty="No credit changes."
          head={['When', 'Change', 'Bucket', 'Reason']}
          rows={data.ledger.map((l) => [
            fmtDate(l.created_at),
            <span style={{ color: l.delta < 0 ? 'var(--danger)' : 'var(--success)' }}>{l.delta > 0 ? `+${l.delta}` : l.delta}</span>,
            l.bucket_kind,
            `${l.reason}${l.actor ? ` · ${l.actor}` : ''}`,
          ])}
        />
        <Table
          title="Usage (counts only, no content is stored)"
          empty="No cloud usage."
          head={['Day', 'Action', 'Requests', 'Characters', 'Credits']}
          rows={data.usage.map((u) => [u.day, u.action, fmtNum(u.requests), fmtNum(u.chars), fmtNum(u.credits)])}
        />
        <Table
          title="Admin actions on this user"
          empty="None."
          head={['When', 'Admin', 'Action', 'Details']}
          rows={data.audit.map((a) => [fmtDate(a.created_at), a.admin_email, a.action, <span className="mono">{a.details}</span>])}
        />
      </div>
    </>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="faint">{label}</dt>
      <dd className="faint">{value}</dd>
    </>
  );
}

function Table({ title, head, rows, empty }: { title: string; head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="card table-wrap">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <div className="empty">{empty}</div>
      ) : (
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
