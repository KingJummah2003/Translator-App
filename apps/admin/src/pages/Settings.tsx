import { useEffect, useState } from 'react';
import { adminApi, fmtNum } from '../api';
import { useAdmin } from '../hooks';

interface Settings {
  servicePaused: boolean;
  globalDailyCharCap: number;
  globalDailyOcrCap: number;
  freeDailyCharCap: number;
}

export function Settings() {
  const { data, error, reload } = useAdmin<Settings>('/settings');
  const [charCap, setCharCap] = useState('');
  const [ocrCap, setOcrCap] = useState('');
  const [freeCap, setFreeCap] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) {
      setCharCap(String(data.globalDailyCharCap));
      setOcrCap(String(data.globalDailyOcrCap));
      setFreeCap(String(data.freeDailyCharCap));
    }
  }, [data]);

  async function save(patch: Partial<Settings>, message: string) {
    setBusy(true);
    setNotice(null);
    try {
      await adminApi('/settings', { method: 'PUT', json: patch });
      setNotice({ kind: 'ok', text: message });
      await reload();
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="banner error">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Service settings</h1>
          <p className="muted">These take effect within about 15 seconds, without a deploy.</p>
        </div>
      </div>
      {notice && <div className={`banner ${notice.kind === 'error' ? 'error' : ''}`}>{notice.text}</div>}

      <div className="card">
        <div className="toggle">
          <div>
            <h2 style={{ margin: 0 }}>Emergency stop</h2>
            <p className="muted">
              Pauses all cloud translation, camera OCR and document translation for everyone. Offline translation in the app keeps working. Use this
              if costs spike or the provider has an outage.
            </p>
          </div>
          <button
            className={data.servicePaused ? '' : 'danger'}
            disabled={busy}
            onClick={() => {
              if (data.servicePaused || confirm('Pause all cloud features for every user?')) {
                void save({ servicePaused: !data.servicePaused }, data.servicePaused ? 'Cloud service resumed.' : 'Cloud service paused.');
              }
            }}>
            {data.servicePaused ? 'Resume service' : 'Pause service'}
          </button>
        </div>

        <div className="toggle">
          <div>
            <h2 style={{ margin: 0 }}>Daily spending caps</h2>
            <p className="muted">
              Once reached, cloud features pause until midnight UTC. Currently {fmtNum(data.globalDailyCharCap)} characters and {fmtNum(data.globalDailyOcrCap)} images per day, of which free accounts together may use {fmtNum(data.freeDailyCharCap)} characters. Use 0 for no cap.
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field">
            Characters per day
            <input type="number" min={0} value={charCap} onChange={(e) => setCharCap(e.target.value)} />
          </label>
          <label className="field">
            Images per day
            <input type="number" min={0} value={ocrCap} onChange={(e) => setOcrCap(e.target.value)} />
          </label>
          <label className="field">
            Free accounts, characters per day
            <input type="number" min={0} value={freeCap} onChange={(e) => setFreeCap(e.target.value)} />
          </label>
          <button
            style={{ alignSelf: 'flex-end' }}
            disabled={busy || charCap === '' || ocrCap === '' || freeCap === ''}
            onClick={() => void save({ globalDailyCharCap: Number(charCap), globalDailyOcrCap: Number(ocrCap), freeDailyCharCap: Number(freeCap) }, 'Caps saved.')}>
            Save caps
          </button>
        </div>
      </div>
    </>
  );
}
