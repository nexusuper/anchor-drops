import { useCallback, useEffect, useMemo, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Web port of anchor-drops-system/app/(app)/containers.tsx — the returnable
// container ledger (container_ledger). Chip -> kind mirrors the app's naming
// (labels read from the CUSTOMER's side; "Pickups" = delivery_out, container
// went OUT to the customer; "Returns" = pickup_return, empties came back).
const FILTERS = [
  { label: 'All', kind: undefined },
  { label: 'Pickups', kind: 'delivery_out' },
  { label: 'Returns', kind: 'pickup_return' },
];

const KIND_PILL = {
  delivery_out: { label: 'Picked Up', className: 'bg-sky-100 text-sky-700' },
  pickup_return: { label: 'Dropped Off', className: 'bg-emerald-100 text-emerald-700' },
  adjustment: { label: 'Adjustment', className: 'bg-amber-100 text-amber-700' },
};

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// Legacy rows carry no customer_id (only phone_normalized), and RLS can hide
// the embedded customer even when the ledger row itself is visible. Never
// render "null".
function customerLabel(row) {
  return row.customers?.name ?? row.phone_normalized ?? 'Unknown customer';
}

// ponytail: flat cap, no pagination — matches src/api/containers.ts useContainerLedger.
const LIMIT = 200;

export default function ContainersPage() {
  const [active, setActive] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (kind, isRefresh) => {
    const supabase = getSupabaseBrowser();
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('container_ledger')
        .select('id, customer_id, phone_normalized, order_id, delta, kind, note, created_at, customers(name)')
        .order('created_at', { ascending: false })
        .limit(LIMIT);
      if (kind) query = query.eq('kind', kind);
      const { data, error } = await query;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { queueMicrotask(() => load(FILTERS[active].kind, false)); }, [active, load]);

  // Rows arrive already sorted created_at desc, so a single pass groups them
  // into date sections that stay in that order.
  const sections = useMemo(() => {
    const out = [];
    for (const row of rows) {
      const title = dateFmt.format(new Date(row.created_at));
      const last = out[out.length - 1];
      if (last?.title === title) last.rows.push(row);
      else out.push({ title, rows: [row] });
    }
    return out;
  }, [rows]);

  return (
    <OpsShell
      title="Containers"
      allow={['owner', 'admin', 'staff']}
      actions={
        <ClayButton variant="white" size="sm" onClick={() => load(FILTERS[active].kind, true)} disabled={refreshing}>
          <ClayIcon name="refresh" className="w-4 h-4" /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </ClayButton>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {FILTERS.map((f, i) => (
            <button
              key={f.label}
              onClick={() => setActive(i)}
              className={
                'rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' +
                (active === i ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-sm text-clay-ink/50">Loading…</p>}
        {error && (
          <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">
            Couldn&apos;t load the ledger — {error}
          </p>
        )}
        {!loading && !error && sections.length === 0 && (
          <p className="text-sm text-clay-ink/50">
            {FILTERS[active].kind ? 'Nothing recorded under this filter yet.' : 'Containers appear here as orders go out and empties come back.'}
          </p>
        )}

        {sections.map((section) => (
          <div key={section.title}>
            <p className="text-xs text-clay-ink/50 mb-2 mt-4">{section.title}</p>
            <div className="space-y-2">
              {section.rows.map((row) => {
                const pill = KIND_PILL[row.kind] ?? KIND_PILL.adjustment;
                return (
                  <ClayCard key={row.id} className="p-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      {/* The mockup shows a product/size here, but container_ledger
                          has no product_id — only a signed delta. Qty is abs(delta). */}
                      <p className="font-semibold text-clay-ink">Container ×{Math.abs(row.delta)}</p>
                      <p className="text-sm text-clay-ink/70 truncate">{customerLabel(row)}</p>
                      {row.note && <p className="text-xs text-clay-ink/50 truncate">{row.note}</p>}
                    </div>
                    <span className={'text-xs font-semibold rounded-full px-3 py-1 whitespace-nowrap ' + pill.className}>
                      {pill.label}
                    </span>
                  </ClayCard>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </OpsShell>
  );
}
