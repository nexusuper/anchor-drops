import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

// Store is normally closed Sunday (lib/scheduling.js). Dates listed here let
// online ordering treat that specific day as open, e.g. a one-off Sunday sale.
export default function SettingsTab({ savedPassword }) {
  const [dates, setDates] = useState(null);
  const [newDate, setNewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchDates = useCallback(async () => {
    try {
      const data = await apiFetch('/api/settings', { password: savedPassword });
      setDates(data?.open_override_dates || []);
    } catch (e) {
      setError(e.message);
    }
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchDates()); }, [fetchDates]);

  async function save(nextDates) {
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/api/settings', { method: 'PATCH', password: savedPassword, body: { open_override_dates: nextDates } });
      setDates(nextDates);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function addDate() {
    if (!newDate || dates.includes(newDate)) return;
    save([...dates, newDate].sort());
    setNewDate('');
  }

  function removeDate(d) {
    save(dates.filter((x) => x !== d));
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="clay-raised rounded-2xl p-4 space-y-3">
        <div className="font-display font-bold text-clay-ink">Business Hours</div>
        <p className="text-xs text-clay-ink/60">
          Store is closed Sundays by default. Add a date below to open online ordering for that Sunday specifically.
        </p>
        {dates === null && <p className="text-clay-ink/60 text-sm">Loading…</p>}
        {dates && dates.length > 0 && (
          <ul className="space-y-1">
            {dates.map((d) => (
              <li key={d} className="flex items-center justify-between text-sm">
                <span>{d}</span>
                <button type="button" className="text-xs text-clay-danger" onClick={() => removeDate(d)} disabled={saving}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {dates && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="clay-inset rounded-xl px-3 py-2 text-sm flex-1"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <button
              type="button"
              className="clay-btn-primary px-4 py-2 rounded-xl text-sm disabled:opacity-50"
              onClick={addDate}
              disabled={!newDate || saving}
            >
              Add
            </button>
          </div>
        )}
        {error && <p className="text-sm text-clay-danger">{error}</p>}
      </div>
    </div>
  );
}
