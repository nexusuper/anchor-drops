import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayButton from '@/components/ui/ClayButton';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import {
  fetchStaffRoute,
  formatTime,
  fullRouteUrl,
  navigateUrl,
  peso,
} from '@/components/admin/ops/RouteData';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Web port of the app's app/(app)/delivery.tsx: today's staff route board plus
// the Needs Review list of sync_conflicts (terminal offline-sync failures a
// driver's device could not retry). Staff/admin/owner only — drivers have no
// UPDATE policy on sync_conflicts, so they could see but never resolve.

// confirmed -> out_for_delivery -> delivered. Terminal states show no button.
// Cancelling is deliberately NOT offered here: it needs the container_ledger
// reversal the app's useUpdateOrder does, which is out of scope for this board.
const NEXT_STEP = {
  confirmed: { status: 'out_for_delivery', label: 'Mark Out for Delivery' },
  out_for_delivery: { status: 'delivered', label: 'Mark Delivered' },
};

function StaffRouteSection() {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const load = useCallback(async () => {
    try {
      setGroups(await fetchStaffRoute(getSupabaseBrowser()));
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load today’s route.');
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  async function advance(stop) {
    const next = NEXT_STEP[stop.status];
    if (!next || pendingId) return;
    setPendingId(stop.id);
    try {
      const { error: err } = await getSupabaseBrowser()
        .from('orders')
        .update({ status: next.status })
        .eq('id', stop.id);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(e.message || 'Could not update the order.');
    } finally {
      setPendingId(null);
    }
  }

  const allStops = (groups ?? []).flatMap((g) => g.stops);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display font-bold text-lg text-clay-ink">Today’s Route</h2>
        <p className="text-sm text-clay-muted">Confirmed and out-for-delivery orders scheduled for today.</p>
      </div>

      {error && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>
      )}
      {groups === null && !error && <p className="text-center py-8 text-gray-400">Loading route…</p>}

      {allStops.length > 0 && (
        <ClayButton variant="primary" className="w-full" href={fullRouteUrl(allStops)} target="_blank" rel="noreferrer">
          <ClayIcon name="truck" className="w-5 h-5" />
          Open full route in Google Maps ({allStops.length} stop{allStops.length === 1 ? '' : 's'})
        </ClayButton>
      )}

      {groups !== null && allStops.length === 0 && !error && (
        <ClayCard className="p-6 text-center text-sm text-clay-muted">No deliveries scheduled for today.</ClayCard>
      )}

      {(groups ?? []).map((group) => (
        <div key={group.barangay} className="space-y-2">
          <h3 className="font-semibold text-clay-ink">
            {group.barangay || 'Unspecified'} ({group.stops.length})
          </h3>
          {group.stops.map((stop) => {
            const next = NEXT_STEP[stop.status];
            return (
              <ClayCard key={stop.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display font-semibold text-clay-ink truncate">{stop.customer_name}</p>
                  <span className="shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 bg-clay-sky/25 text-clay-skydeep">
                    {String(stop.status).replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="text-sm text-clay-ink">{stop.address}</p>
                <p className="text-xs text-clay-muted">
                  {stop.product_type} ×{stop.quantity} · {peso(stop.total_amount)} · {formatTime(stop.delivery_time)}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <ClayButton variant="outline" size="sm" href={`tel:${stop.phone}`}>
                    <ClayIcon name="phone" className="w-4 h-4" />
                    Call
                  </ClayButton>
                  <ClayButton variant="outline" size="sm" href={navigateUrl(stop)} target="_blank" rel="noreferrer">
                    Navigate
                  </ClayButton>
                </div>
                {next && (
                  <ClayButton
                    variant="primary"
                    size="sm"
                    className="w-full"
                    loading={pendingId === stop.id}
                    onClick={() => advance(stop)}
                  >
                    {next.label}
                  </ClayButton>
                )}
              </ClayCard>
            );
          })}
        </div>
      ))}
    </section>
  );
}

function NeedsReviewSection() {
  const [conflicts, setConflicts] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await getSupabaseBrowser()
        .from('sync_conflicts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });
      if (err) throw err;
      setConflicts(data ?? []);
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load conflicts.');
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  async function resolve(id) {
    if (pendingId) return;
    setPendingId(id);
    try {
      const supabase = getSupabaseBrowser();
      const { data: userData } = await supabase.auth.getUser();
      const { error: err } = await supabase
        .from('sync_conflicts')
        .update({ resolved: true, resolved_by: userData?.user?.id ?? null, resolved_at: new Date().toISOString() })
        .eq('id', id);
      if (err) throw err;
      await load();
    } catch (e) {
      setError(e.message || 'Could not resolve.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display font-bold text-lg text-clay-ink">Needs Review</h2>
        <p className="text-sm text-clay-muted">
          Driver commands the server rejected (e.g. an order was cancelled mid-route). These were never applied — re-enter
          them by hand if the delivery really happened, then mark resolved.
        </p>
      </div>

      {error && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>
      )}
      {conflicts === null && !error && <p className="text-center py-8 text-gray-400">Loading…</p>}

      {conflicts !== null && conflicts.length === 0 && !error && (
        <ClayCard className="p-6 text-center text-sm text-clay-muted">Nothing needs review.</ClayCard>
      )}

      {(conflicts ?? []).map((c) => (
        <ClayCard key={c.id} className="p-4 space-y-2">
          <button
            type="button"
            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            className="w-full text-left space-y-1"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 bg-clay-danger-bg text-clay-danger">
                {c.command_type}
              </span>
              <span className="text-xs text-clay-muted">{new Date(c.created_at).toLocaleString()}</span>
            </div>
            <p className="text-sm text-clay-danger">{c.error}</p>
          </button>
          {expanded === c.id && (
            <pre className="clay-inset rounded-2xl p-3 text-xs text-clay-muted overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(c.payload, null, 2)}
            </pre>
          )}
          <ClayButton variant="outline" size="sm" loading={pendingId === c.id} onClick={() => resolve(c.id)}>
            Mark resolved
          </ClayButton>
        </ClayCard>
      ))}
    </section>
  );
}

export default function ReviewPage() {
  return (
    <OpsShell title="Needs Review" subtitle="Route board + rejected driver syncs" allow={['owner', 'admin', 'staff']}>
      <div className="space-y-8">
        <StaffRouteSection />
        <NeedsReviewSection />
      </div>
    </OpsShell>
  );
}
