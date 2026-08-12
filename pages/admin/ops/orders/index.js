import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';

// Web port of app/(app)/orders/index.tsx — same filters (status/sort/barangay/
// date/search), same live-order highlight via one postgres_changes channel on
// public.orders (src/api/ordersRealtime.ts, migration 0017), same soft-delete
// (archived_at) for bulk delete. Plain useState/useEffect + a manual refetch()
// in place of TanStack; RLS scopes rows to the caller, no manual branch_id
// filter (owner sees every branch).
const ORDER_STATUSES = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
const STATUS_FILTERS = ['all', ...ORDER_STATUSES];
const STATUS_LABELS = {
  all: 'All',
  pending: 'Pending',
  confirmed: 'Confirmed',
  out_for_delivery: 'On the Way',
  delivered: 'Done',
  cancelled: 'Cancelled',
};
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'amount_high', label: 'Highest ₱' },
  { value: 'amount_low', label: 'Lowest ₱' },
];
const ORDER_SORTS = {
  newest: { column: 'created_at', ascending: false },
  oldest: { column: 'created_at', ascending: true },
  amount_high: { column: 'total_amount', ascending: false },
  amount_low: { column: 'total_amount', ascending: true },
};
const STATUS_BADGE = {
  pending: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-sky-100 text-sky-700',
  out_for_delivery: 'bg-violet-100 text-violet-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

function formatTime(time) {
  if (!time) return null;
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  if (Number.isNaN(h)) return null;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr ?? '00'} ${period}`;
}

export default function OpsOrdersPage() {
  const router = useRouter();
  const { role, branchId } = useOpsSession();
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('newest');
  const [barangay, setBarangay] = useState('');
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [highlighted, setHighlighted] = useState(new Set());
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const filters = useMemo(
    () => ({ status, sort, barangay: barangay || undefined, date: date || undefined, search: search || undefined }),
    [status, sort, barangay, date, search]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const s = ORDER_SORTS[filters.sort];
      let query = supabase.from('orders').select('*').is('archived_at', null).order(s.column, { ascending: s.ascending });
      if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
      if (filters.date) query = query.eq('delivery_date', filters.date);
      if (filters.barangay) query = query.ilike('barangay', `%${filters.barangay}%`);
      if (filters.search) {
        const q = filters.search.trim().replace(/[%_,]/g, '');
        if (q) query = query.or(`customer_name.ilike.%${q}%,phone.ilike.%${q}%,order_number.ilike.%${q}%`);
      }
      const { data, error: err } = await query;
      if (err) throw err;
      setOrders(data ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    queueMicrotask(() => load());
  }, [load]);

  // Realtime: one channel, highlight newly-inserted orders, refetch on any
  // change. `owner` sees every branch per RLS so it subscribes unfiltered;
  // admin/staff stay branch-filtered. Cleaned up on unmount.
  const timeoutsRef = useRef([]);
  useEffect(() => {
    const isOwner = role === 'owner';
    if (!isOwner && !branchId) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(isOwner ? 'orders-all' : `orders-branch-${branchId}`)
      .on(
        'postgres_changes',
        isOwner
          ? { event: '*', schema: 'public', table: 'orders' }
          : { event: '*', schema: 'public', table: 'orders', filter: `branch_id=eq.${branchId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const id = payload.new.id;
            setHighlighted((prev) => new Set(prev).add(id));
            const t = setTimeout(() => {
              setHighlighted((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
            }, 10_000);
            timeoutsRef.current.push(t);
          }
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [branchId, role, load]);

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = (orders?.length ?? 0) > 0 && orders.every((o) => selected.has(o.id));
  const toggleSelectAll = () => setSelected(allVisibleSelected ? new Set() : new Set((orders ?? []).map((o) => o.id)));

  async function confirmDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} order(s)? They will be hidden from lists.`)) return;
    setDeleting(true);
    try {
      const supabase = getSupabaseBrowser();
      // An RLS-blocked UPDATE matches zero rows without erroring, so select the
      // ids back: a short result means some orders were not archived and the
      // user must not be told the delete succeeded.
      const { data, error: err } = await supabase
        .from('orders')
        .update({ archived_at: new Date().toISOString() })
        .in('id', ids)
        .select('id');
      if (err) throw err;
      if (!data || data.length < ids.length) {
        throw new Error(
          `Only ${data?.length ?? 0} of ${ids.length} order(s) were deleted — your role may not be allowed to delete the rest.`
        );
      }
      setSelected(new Set());
      await load();
    } catch (e) {
      alert(e.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <OpsShell title="Orders" allow={['owner', 'admin', 'staff']}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-clay-surface border border-clay-border rounded-2xl px-3 h-11">
            <ClayIcon name="search" className="w-4 h-4 text-clay-muted shrink-0" />
            <input
              className="flex-1 bg-transparent outline-none text-sm"
              placeholder="Search by name, phone, or order number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search orders"
            />
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' +
                (status === s ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')
              }
            >
              {STATUS_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {SORT_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => setSort(o.value)}
              className={
                'shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' +
                (sort === o.value ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')
              }
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            className="flex-1 border border-clay-border rounded-xl bg-clay-surface px-3 py-2 text-sm"
            placeholder="Barangay"
            value={barangay}
            onChange={(e) => setBarangay(e.target.value)}
          />
          <input
            className="flex-1 border border-clay-border rounded-xl bg-clay-surface px-3 py-2 text-sm"
            placeholder="Delivery date (YYYY-MM-DD)"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {error && <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>}

        {(orders?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="w-4 h-4" />
            <span className="text-clay-muted">Select all</span>
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex items-center justify-between bg-clay-surface border border-clay-border rounded-2xl p-3">
            <span className="font-semibold text-clay-ink">{selected.size} selected</span>
            <ClayButton variant="outline" size="sm" onClick={confirmDelete} disabled={deleting}>
              <ClayIcon name="trash" className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete selected'}
            </ClayButton>
          </div>
        )}

        {loading && <p className="text-center py-16 text-gray-400">Loading…</p>}

        {!loading && (orders?.length ?? 0) === 0 && (
          <p className="text-center py-16 text-clay-muted">No orders found. Try adjusting your filters or search.</p>
        )}

        <div className="space-y-2">
          {(orders ?? []).map((o) => {
            const isNew = highlighted.has(o.id);
            const time = formatTime(o.delivery_time);
            const subtitle = [o.barangay, time, `₱${Number(o.total_amount ?? 0).toFixed(2)}`].filter(Boolean).join(' · ');
            return (
              <ClayCard
                key={o.id}
                className={`p-3 ${isNew ? 'ring-2 ring-green-400 bg-green-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleSelected(o.id)}
                    className="w-4 h-4 mt-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button className="flex-1 text-left min-w-0" onClick={() => router.push(`/admin/ops/orders/${o.id}`)}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-clay-ink truncate">
                        #{o.order_number} · {o.customer_name}
                      </span>
                      {isNew && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500 text-white">NEW</span>}
                    </div>
                    <div className="text-sm text-clay-muted truncate">{subtitle}</div>
                  </button>
                  <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-700'}`}>
                    {STATUS_LABELS[o.status] ?? o.status}
                  </span>
                </div>
              </ClayCard>
            );
          })}
        </div>
      </div>
    </OpsShell>
  );
}
