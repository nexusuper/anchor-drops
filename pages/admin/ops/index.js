import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';

// Web port of app/(app)/index.tsx — same 4 KPI tiles (src/api/dashboard.ts
// useDashboard) plus the Dashboard+ extras (useDashboardPlus): month
// revenue/orders/customers/AOV, a 30-day revenue bar strip, orders-by-status,
// top barangays, top customers. Plain useState/useEffect, no TanStack —
// this repo's web convention. RLS scopes rows to the caller (owner sees all
// branches); no manual branch_id filter, same as the app.
const ORDER_STATUSES = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
const STATUS_LABELS = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
const STATUS_COLOR = {
  pending: '#d97706',
  confirmed: '#0284c7',
  out_for_delivery: '#7c3aed',
  delivered: '#16a34a',
  cancelled: '#dc2626',
};
const RECENT_WINDOW_DAYS = 90; // ponytail: bounds the status/barangay/customer snapshot query, same window as the app

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;
const shortDate = (isoDate) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function StatTile({ label, value, onClick }) {
  return (
    <ClayCard
      as={onClick ? 'button' : 'div'}
      onClick={onClick}
      className={`p-4 text-left ${onClick ? 'clay-pressable' : ''}`}
    >
      <div className="text-xs font-semibold text-clay-muted">{label}</div>
      <div className="text-2xl font-display font-bold text-clay-ink mt-1">{value}</div>
    </ClayCard>
  );
}

function BarRow({ label, valueLabel, pct, color }) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <div className="basis-[34%] text-sm text-clay-ink truncate">{label}</div>
      <div className="flex-1 h-2.5 rounded-full bg-clay-bg overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, minWidth: 4 }} />
      </div>
      <div className="min-w-16 text-right text-sm font-semibold text-clay-ink">{valueLabel}</div>
    </div>
  );
}

function RevenueBarStrip({ data }) {
  const max = Math.max(1, ...data.map((r) => r.total));
  return (
    <div>
      <div className="flex items-end gap-0.5 h-24 mt-2">
        {data.map((r) => (
          <div key={r.date} className="flex-1 h-full flex items-end">
            <div
              className="w-full bg-sky-500 rounded-sm"
              style={{ height: `${Math.max(2, (r.total / max) * 100)}%`, minHeight: 2 }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-clay-muted">
        <span>{shortDate(data[0].date)}</span>
        <span>{shortDate(data[data.length - 1].date)}</span>
      </div>
    </div>
  );
}

async function loadDashboard() {
  const supabase = getSupabaseBrowser();
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phtNow = new Date(Date.now() + PHT_OFFSET_MS);
  const startOfDay = new Date(Date.UTC(phtNow.getUTCFullYear(), phtNow.getUTCMonth(), phtNow.getUTCDate()) - PHT_OFFSET_MS);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const [pending, active, todayOrders, inventory] = await Promise.all([
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pending').is('archived_at', null),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'out_for_delivery').is('archived_at', null),
    supabase
      .from('orders')
      .select('total_amount')
      .gte('created_at', startOfDay.toISOString())
      .lt('created_at', endOfDay.toISOString())
      .neq('status', 'cancelled')
      .is('archived_at', null),
    supabase.from('inventory').select('current_stock, low_stock_threshold'),
  ]);
  if (pending.error) throw pending.error;
  if (active.error) throw active.error;
  if (todayOrders.error) throw todayOrders.error;
  if (inventory.error) throw inventory.error;

  const todaySalesTotal = (todayOrders.data ?? []).reduce((s, o) => s + (o.total_amount ?? 0), 0);
  const lowStockCount = (inventory.data ?? []).filter((i) => i.current_stock <= i.low_stock_threshold).length;

  return {
    pendingOrders: pending.count ?? 0,
    activeDeliveries: active.count ?? 0,
    lowStockCount,
    todaySalesTotal,
  };
}

async function loadDashboardPlus() {
  const supabase = getSupabaseBrowser();
  const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const phtNow = new Date(Date.now() + PHT_OFFSET_MS);
  const y = phtNow.getUTCFullYear();
  const m = phtNow.getUTCMonth();
  const d = phtNow.getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');

  const monthStartStr = `${y}-${pad(m + 1)}-01`;
  const nextMonth = new Date(Date.UTC(y, m + 1, 1));
  const nextMonthStartStr = `${nextMonth.getUTCFullYear()}-${pad(nextMonth.getUTCMonth() + 1)}-${pad(nextMonth.getUTCDate())}`;
  const monthStartUtc = new Date(Date.UTC(y, m, 1) - PHT_OFFSET_MS);
  const nextMonthStartUtc = new Date(Date.UTC(y, m + 1, 1) - PHT_OFFSET_MS);

  const days = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.UTC(y, m, d - i));
    days.push(`${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`);
  }
  const day30AgoStr = days[0];
  const todayStr = days[days.length - 1];
  const deliveredQueryStartStr = monthStartStr < day30AgoStr ? monthStartStr : day30AgoStr;

  const recentSinceIso = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const active30dSinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [ordersThisMonthRes, deliveredRes, active30dRes, recentRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .gte('created_at', monthStartUtc.toISOString())
      .lt('created_at', nextMonthStartUtc.toISOString()),
    supabase
      .from('orders')
      .select('delivery_date, total_amount')
      .is('archived_at', null)
      .eq('status', 'delivered')
      .gte('delivery_date', deliveredQueryStartStr)
      .lte('delivery_date', todayStr),
    supabase
      .from('orders')
      .select('customer_id')
      .is('archived_at', null)
      .not('customer_id', 'is', null)
      .gte('created_at', active30dSinceIso),
    supabase
      .from('orders')
      .select('status, barangay, customer_name, total_amount')
      .is('archived_at', null)
      .gte('created_at', recentSinceIso),
  ]);
  if (ordersThisMonthRes.error) throw ordersThisMonthRes.error;
  if (deliveredRes.error) throw deliveredRes.error;
  if (active30dRes.error) throw active30dRes.error;
  if (recentRes.error) throw recentRes.error;

  let revenueThisMonth = 0;
  let deliveredThisMonthCount = 0;
  const revenueByDayMap = new Map(days.map((day) => [day, 0]));
  for (const row of deliveredRes.data ?? []) {
    const total = row.total_amount ?? 0;
    if (row.delivery_date && row.delivery_date >= monthStartStr && row.delivery_date < nextMonthStartStr) {
      revenueThisMonth += total;
      deliveredThisMonthCount += 1;
    }
    if (row.delivery_date && revenueByDayMap.has(row.delivery_date)) {
      revenueByDayMap.set(row.delivery_date, (revenueByDayMap.get(row.delivery_date) ?? 0) + total);
    }
  }

  const activeCustomers30d = new Set((active30dRes.data ?? []).map((r) => r.customer_id)).size;

  const ordersByStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  const barangayCounts = new Map();
  const customerTotals = new Map();
  for (const row of recentRes.data ?? []) {
    if (row.status in ordersByStatus) ordersByStatus[row.status] += 1;
    const barangay = row.barangay?.trim();
    if (barangay) barangayCounts.set(barangay, (barangayCounts.get(barangay) ?? 0) + 1);
    if (row.status === 'delivered') {
      customerTotals.set(row.customer_name, (customerTotals.get(row.customer_name) ?? 0) + (row.total_amount ?? 0));
    }
  }

  const topBarangays = [...barangayCounts.entries()]
    .map(([barangay, count]) => ({ barangay, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topCustomers = [...customerTotals.entries()]
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return {
    revenueThisMonth,
    ordersThisMonth: ordersThisMonthRes.count ?? 0,
    activeCustomers30d,
    avgOrderValue: deliveredThisMonthCount > 0 ? revenueThisMonth / deliveredThisMonthCount : 0,
    revenueByDay: days.map((date) => ({ date, total: revenueByDayMap.get(date) ?? 0 })),
    ordersByStatus,
    topBarangays,
    topCustomers,
  };
}

export default function OpsDashboardPage() {
  const router = useRouter();
  const { profile, branchId } = useOpsSession();
  const [data, setData] = useState(null);
  const [plus, setPlus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      Promise.all([loadDashboard(), loadDashboardPlus()])
        .then(([d, p]) => {
          if (cancelled) return;
          setData(d);
          setPlus(p);
        })
        .catch((e) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false));
    });
    return () => {
      cancelled = true;
    };
  }, [branchId]);

  const ordersByStatusMax = useMemo(
    () => (plus ? Math.max(1, ...Object.values(plus.ordersByStatus)) : 1),
    [plus]
  );

  return (
    <OpsShell title="Overview" allow={['owner', 'admin', 'staff', 'driver']}>
      <div className="space-y-5">
        <h1 className="text-xl font-display font-bold text-clay-ink">
          {profile?.full_name ? `Hi, ${profile.full_name}` : 'Dashboard'}
        </h1>

        {loading && <p className="text-center py-16 text-gray-400">Loading…</p>}
        {error && <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>}

        {!loading && data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Pending Orders" value={data.pendingOrders} onClick={() => router.push('/admin/ops/orders')} />
              <StatTile label="Active Deliveries" value={data.activeDeliveries} onClick={() => router.push('/admin/ops/route')} />
              <StatTile label="Low-Stock Items" value={data.lowStockCount} onClick={() => router.push('/admin/ops/containers')} />
              <StatTile label="Today's Sales" value={peso(data.todaySalesTotal)} onClick={() => router.push('/admin/ops/finance')} />
            </div>

            {plus && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="Revenue (This Month)" value={peso(plus.revenueThisMonth)} />
                  <StatTile label="Orders (This Month)" value={plus.ordersThisMonth} />
                  <StatTile label="Active Customers (30d)" value={plus.activeCustomers30d} />
                  <StatTile label="Avg Order Value" value={peso(plus.avgOrderValue)} />
                </div>

                <ClayCard className="p-4">
                  <h2 className="font-display font-bold text-clay-ink">Revenue — Last 30 Days</h2>
                  <RevenueBarStrip data={plus.revenueByDay} />
                </ClayCard>

                <ClayCard className="p-4">
                  <h2 className="font-display font-bold text-clay-ink">Orders by Status</h2>
                  {Object.entries(plus.ordersByStatus).map(([status, count]) => (
                    <BarRow
                      key={status}
                      label={STATUS_LABELS[status] ?? status}
                      valueLabel={String(count)}
                      pct={(count / ordersByStatusMax) * 100}
                      color={STATUS_COLOR[status] ?? '#0284c7'}
                    />
                  ))}
                </ClayCard>

                <ClayCard className="p-4">
                  <h2 className="font-display font-bold text-clay-ink">Top Barangays</h2>
                  {plus.topBarangays.length === 0 ? (
                    <p className="text-sm text-clay-muted mt-2">No recent orders yet.</p>
                  ) : (
                    (() => {
                      const max = Math.max(1, ...plus.topBarangays.map((b) => b.count));
                      return plus.topBarangays.map((b) => (
                        <BarRow key={b.barangay} label={b.barangay} valueLabel={String(b.count)} pct={(b.count / max) * 100} color="#0284c7" />
                      ));
                    })()
                  )}
                </ClayCard>

                <ClayCard className="p-4">
                  <h2 className="font-display font-bold text-clay-ink">Top Customers</h2>
                  {plus.topCustomers.length === 0 ? (
                    <p className="text-sm text-clay-muted mt-2">No delivered orders yet.</p>
                  ) : (
                    (() => {
                      const max = Math.max(1, ...plus.topCustomers.map((c) => c.total));
                      return plus.topCustomers.map((c) => (
                        <BarRow key={c.name} label={c.name} valueLabel={peso(c.total)} pct={(c.total / max) * 100} color="#0284c7" />
                      ));
                    })()
                  )}
                </ClayCard>
              </>
            )}
          </>
        )}
      </div>
    </OpsShell>
  );
}
