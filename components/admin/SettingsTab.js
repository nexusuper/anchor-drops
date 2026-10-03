import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export default function SettingsTab({ savedPassword }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');

  const fetchBlocked = useCallback(async () => {
    try {
      const data = await apiFetch('/api/blocklist', { password: savedPassword });
      setBlocked(data?.blocked || []);
    } catch (e) {
      setError(e.message);
    }
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchBlocked()); }, [fetchBlocked]);

  async function changeBlocklist(method, body) {
    setError(null);
    setSaving(true);
    try {
      const data = await apiFetch('/api/blocklist', { method, password: savedPassword, body });
      setBlocked(data?.blocked || []);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function addBlocked() {
    if (await changeBlocklist('POST', { phone: newPhone, reason: newReason || null })) {
      setNewPhone('');
      setNewReason('');
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="clay-raised rounded-2xl p-4 space-y-3">
        <div className="font-display font-bold text-clay-ink">Blocked Numbers</div>
        <p className="text-xs text-clay-ink/60">
          Blocked numbers cannot order online or by Messenger, and staff are stopped when keying a delivery for them.
        </p>
        {blocked === null && <p className="text-clay-ink/60 text-sm">Loading…</p>}
        {blocked && blocked.length === 0 && <p className="text-clay-ink/60 text-sm">No blocked numbers.</p>}
        {blocked && blocked.length > 0 && (
          <ul className="space-y-1">
            {blocked.map((b) => (
              <li key={b.phone} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-mono">{b.phone}</span>
                  {b.reason && <span className="text-clay-ink/60 text-xs"> · {b.reason}</span>}
                </span>
                <button type="button" className="text-xs text-clay-danger" onClick={() => changeBlocklist('DELETE', { phone: b.phone })} disabled={saving}>
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
        {blocked && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="tel"
              className="clay-inset rounded-xl px-3 py-2 text-sm flex-1 min-w-[10rem]"
              placeholder="09XX XXX XXXX"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
            />
            <input
              type="text"
              className="clay-inset rounded-xl px-3 py-2 text-sm flex-1 min-w-[10rem]"
              placeholder="Reason (optional)"
              maxLength={200}
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
            />
            <button type="button" className="clay-btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50" onClick={addBlocked} disabled={newPhone.trim().length < 7 || saving}>
              Block
            </button>
          </div>
        )}
        {error && <p className="text-sm text-clay-danger">{error}</p>}
      </div>
    </div>
  );
}
