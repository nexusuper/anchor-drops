import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Web port of anchor-drops-system/app/(app)/history.tsx — the signed-in
// driver's own completed deliveries, last 30 days. Online-only, straight
// query against proof_of_delivery joined to its order (no offline cache on
// web, mirrors the app's online-only scope for this screen).
function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function groupByDay(rows) {
  const map = new Map();
  for (const r of rows) {
    const d = new Date(r.delivered_at);
    const dateKey = d.toDateString();
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const entry = map.get(dateKey) ?? { label, count: 0, total: 0 };
    entry.count += 1;
    entry.total += r.orders?.total_amount ?? 0;
    map.set(dateKey, entry);
  }
  return [...map.entries()].map(([dateKey, v]) => ({ dateKey, ...v }));
}

export default function HistoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (isRefresh) => {
    const supabase = getSupabaseBrowser();
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const driverId = session?.user.id;
      if (!driverId) { setRows([]); return; }
      const { data, error } = await supabase
        .from('proof_of_delivery')
        .select('id, delivered_at, photo_path, orders(customer_name, address, barangay, total_amount, payment_method)')
        .eq('driver_id', driverId)
        .gte('delivered_at', daysAgoIso(30))
        .order('delivered_at', { ascending: false });
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load(false)); }, [load]);

  const days = groupByDay(rows);

  return (
    <OpsShell
      title="Delivery History"
      allow={['owner', 'admin', 'staff', 'driver']}
      actions={
        <ClayButton variant="white" size="sm" onClick={() => load(true)} disabled={refreshing}>
          <ClayIcon name="refresh" className="w-4 h-4" /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </ClayButton>
      }
    >
      <div className="space-y-3">
        <h2 className="font-display font-semibold text-clay-ink">Last 30 Days</h2>

        {loading && <p className="text-sm text-clay-ink/50">Loading…</p>}
        {error && <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>}

        {!loading && days.length === 0 && !error && (
          <p className="text-sm text-clay-ink/50">No completed deliveries in the last 30 days</p>
        )}

        {days.map(({ dateKey, label, count, total }) => (
          <ClayCard key={dateKey} className="p-4 flex items-center justify-between">
            <div>
              <p className="font-semibold text-clay-ink">{label}</p>
              <p className="text-xs text-clay-ink/60">{count} stop{count === 1 ? '' : 's'}</p>
            </div>
            <p className="text-xl font-bold text-clay-ink">₱{total.toFixed(2)}</p>
          </ClayCard>
        ))}
      </div>
    </OpsShell>
  );
}
