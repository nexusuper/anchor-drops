import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

// Store is normally closed Sunday (lib/scheduling.js). Dates listed here let
// online ordering treat that specific day as open, e.g. a one-off Sunday sale.
export default function SettingsTab({ savedPassword }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [blocked, setBlocked] = useState(null);
  const [newPhone, setNewPhone] = useState('');
  const [newReason, setNewReason] = useState('');
  const [bands, setBands] = useState(null);

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

  const fetchDates = useCallback(async () => {
    try {
      const data = await apiFetch('/api/settings', { password: savedPassword });
      setBands(data?.bottle_delivery_bands || []);
    } catch (e) {
      setError(e.message);
    }
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchDates()); }, [fetchDates]);

  async function saveBands(event) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH', password: savedPassword,
        body: { bottle_delivery_bands: bands.map(({ max_km, fee }) => ({ max_km: Number(max_km), fee: Number(fee) })) },
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      {bands && (
        <form onSubmit={saveBands} className="clay-raised rounded-2xl p-4 space-y-3">
          <h3 className="font-display font-bold text-clay-ink">Bottled-water delivery rates</h3>
          <p className="text-xs text-clay-ink/70">Bugo is free. Enter maximum distances in ascending order. For Cagayan de Oro deliveries outside these rates, confirm the fee with the customer.</p>
          {bands.map((band, index) => (
            <div key={index} className="flex gap-2 items-end">
              {[['max_km', 'Up to (km)'], ['fee', 'Fee (₱)']].map(([key, label]) => (
                <label key={key} className="min-w-0 flex-1 text-xs">
                  {label}
                  <input required type="number" min={key === 'fee' ? '0' : '0.01'} step="0.01"
                    className="clay-input w-full" value={band[key]}
                    onChange={(e) => setBands(bands.map((row, i) => i === index ? { ...row, [key]: e.target.value } : row))}
                  />
                </label>
              ))}
              <button type="button" className="clay-btn-white rounded-lg p-2 text-xs" onClick={() => setBands(bands.filter((_, i) => i !== index))}>Remove</button>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" className="clay-btn-white rounded-lg p-2 text-sm" disabled={bands.length >= 30} onClick={() => setBands([...bands, { max_km: '', fee: '' }])}>Add rate</button>
            <button type="submit" className="clay-btn-primary rounded-lg p-2 text-sm" disabled={saving}>Save rates</button>
          </div>
        </form>
      )}
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
      </div>
    </div>
  );
}
