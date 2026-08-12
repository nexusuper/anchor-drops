import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayButton from '@/components/ui/ClayButton';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import {
  fetchDriverStops,
  formatTime,
  fullRouteUrl,
  groupByBarangay,
  navigateUrl,
  peso,
  phtDateLabel,
} from '@/components/admin/ops/RouteData';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';

// Today's Route — web port of the app's app/(app)/route/index.tsx.
//
// Deliberately NOT offline-first: the app renders from a SQLite cache, the web
// flow is online-only (scope decision), so this reads Supabase directly on every
// visit. Stops are scoped to the signed-in user's own driver_id, same as the
// app; staff/admin/owner see the whole day's board on /admin/ops/review instead.
function RouteBody() {
  const { session } = useOpsSession();
  const driverId = session?.user?.id ?? null;

  const [stops, setStops] = useState(null); // null = loading
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!driverId) return;
    setRefreshing(true);
    try {
      setStops(await fetchDriverStops(getSupabaseBrowser(), driverId));
      setError(null);
    } catch (e) {
      setError(e.message || 'Could not load today’s route.');
    } finally {
      setRefreshing(false);
    }
  }, [driverId]);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  const groups = groupByBarangay(stops ?? []);
  const total = stops?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-clay-muted">{phtDateLabel()}</p>
          <p className="text-sm text-clay-muted">
            {total} stop{total === 1 ? '' : 's'} · {groups.length} barangay{groups.length === 1 ? '' : 's'}
          </p>
        </div>
        <ClayButton variant="outline" size="sm" onClick={load} loading={refreshing}>
          <ClayIcon name="refresh" className="w-4 h-4" />
          Refresh
        </ClayButton>
      </div>

      {error && (
        <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>
      )}

      {stops === null && !error && <p className="text-center py-10 text-gray-400">Loading route…</p>}

      {total > 0 && (
        <ClayButton
          variant="primary"
          className="w-full"
          href={fullRouteUrl(stops)}
          target="_blank"
          rel="noreferrer"
        >
          <ClayIcon name="truck" className="w-5 h-5" />
          Open full route in Google Maps
        </ClayButton>
      )}

      {stops !== null && total === 0 && !error && (
        <ClayCard className="p-6 text-center space-y-1">
          <p className="font-display font-semibold text-clay-ink">No stops assigned to you today</p>
          <p className="text-sm text-clay-muted">
            Orders show here once an admin assigns them to you and they are confirmed or out for delivery.
          </p>
        </ClayCard>
      )}

      {groups.map((group) => (
        <section key={group.barangay} className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display font-bold text-clay-ink">Barangay {group.barangay}</h2>
            <span className="text-xs text-clay-muted">
              {group.stops.length} stop{group.stops.length === 1 ? '' : 's'}
            </span>
          </div>
          {group.stops.map((o, i) => (
            <ClayCard key={o.id} className="p-4">
              <div className="flex items-center gap-3">
                <span className="shrink-0 w-8 h-8 rounded-full bg-clay-sky/25 text-clay-skydeep font-bold text-sm grid place-items-center">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-semibold text-clay-ink truncate">{o.customer_name}</p>
                  <p className="text-xs text-clay-muted truncate">
                    {formatTime(o.delivery_time)} · {o.address}
                  </p>
                </div>
                <span
                  className={
                    'shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 ' +
                    (o.status === 'out_for_delivery'
                      ? 'bg-clay-sky/25 text-clay-skydeep'
                      : 'bg-clay-uv/20 text-clay-ink')
                  }
                >
                  {o.status === 'out_for_delivery' ? 'On the way' : 'Assigned'}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-clay-muted">
                <span>{o.productName ?? o.product_type} · {o.container_size} × {o.quantity}</span>
                <span>·</span>
                <span>{peso(o.total_amount)}</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <ClayButton variant="outline" size="sm" href={`tel:${o.phone}`}>
                  <ClayIcon name="phone" className="w-4 h-4" />
                  Call
                </ClayButton>
                <ClayButton variant="outline" size="sm" href={navigateUrl(o)} target="_blank" rel="noreferrer">
                  Navigate
                </ClayButton>
                <Link
                  href={`/admin/ops/route/${o.id}`}
                  className="inline-flex items-center justify-center gap-2 rounded-full font-display font-semibold clay-pressable px-4 py-2 text-sm clay-btn-primary"
                >
                  Deliver
                </Link>
              </div>
            </ClayCard>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function RoutePage() {
  return (
    <OpsShell title="Today’s Route" subtitle="Your assigned stops" allow={['owner', 'admin', 'staff', 'driver']}>
      <RouteBody />
    </OpsShell>
  );
}
