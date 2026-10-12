import { fmtDate, fmtUsd } from '../api';
import { useAdmin } from '../hooks';

interface Row {
  product_id: string;
  kind: string;
  store: string | null;
  environment: string | null;
  price_usd: number | null;
  purchased_at: number;
  refunded_at: number | null;
  user_id: string | null;
  email: string | null;
}

export function Purchases() {
  const { data, error } = useAdmin<{ purchases: Row[] }>('/purchases?limit=200');
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Purchases</h1>
          <p className="muted">The latest 200 store transactions reported by RevenueCat.</p>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>User</th>
              <th>Product</th>
              <th>Store</th>
              <th className="num">Price</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.purchases.map((p, i) => (
              <tr key={i}>
                <td>{fmtDate(p.purchased_at)}</td>
                <td>{p.user_id ? <a href={`#/users/${p.user_id}`}>{p.email}</a> : <span className="faint">deleted account</span>}</td>
                <td>{p.product_id}</td>
                <td>
                  {p.store ?? '—'}
                  {p.environment === 'SANDBOX' && <span className="badge"> test</span>}
                </td>
                <td className="num">{p.price_usd != null ? fmtUsd(p.price_usd) : '—'}</td>
                <td>{p.refunded_at ? <span className="badge danger">Refunded</span> : <span className="badge ok">Paid</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.purchases.length === 0 && <div className="empty">No purchases yet.</div>}
      </div>
    </>
  );
}
