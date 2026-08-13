import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import { manilaToday } from '@/lib/scheduling';

// Web port of app/(app)/finance/reconcile.tsx. Daily cash close: expected
// amount is computed from real data (today's COD delivered revenue minus
// today's recorded expenses — src/domain/finance.ts computeExpectedCash),
// never hardcoded. Write is admin/owner only (0002_rls.sql cashrecon_ins);
// this page is additionally role-gated by OpsShell on top of RLS.
const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

export default function ReconcilePage() {
  const { branchId } = useOpsSession();
  const [businessDate] = useState(() => manilaToday());

  const [expected, setExpected] = useState(null);
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    setLoading(true);
    setLoadError(null);
    try {
      const [codRes, expenseRes, reconRes] = await Promise.all([
        supabase
          .from('orders')
          .select('total_amount')
          .eq('payment_method', 'cod')
          .eq('status', 'delivered')
          .eq('delivery_date', businessDate)
          .is('archived_at', null),
        supabase.from('expenses').select('amount').eq('spent_at', businessDate),
        supabase
          .from('cash_reconciliations')
          .select('*')
          .eq('business_date', businessDate),
      ]);
      if (codRes.error) throw codRes.error;
      if (expenseRes.error) throw expenseRes.error;
      if (reconRes.error) throw reconRes.error;
      const cod = (codRes.data || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
      const spent = (expenseRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0);
      setExpected(cod - spent);
      // unique(branch_id, business_date) — pick the row for THIS account's
      // branch, not an arbitrary one (an owner's RLS view spans branches).
      setExisting(branchId ? (reconRes.data || []).find((r) => r.branch_id === branchId) || null : null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [businessDate, branchId]);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  const countedNum = counted ? Number(counted) : null;
  const variance = countedNum !== null && expected !== null ? countedNum - expected : null;

  async function handleSubmit(ev) {
    ev.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError('No branch on this account — cannot reconcile.');
      return;
    }
    if (countedNum === null || Number.isNaN(countedNum)) {
      setFormError('Enter the counted amount.');
      return;
    }
    setSaving(true);
    try {
      // Upsert so re-closing the same business date updates the existing row
      // instead of erroring on the unique constraint.
      const { data, error } = await getSupabaseBrowser()
        .from('cash_reconciliations')
        .upsert(
          {
            branch_id: branchId,
            business_date: businessDate,
            expected_amount: expected ?? 0,
            counted_amount: countedNum,
            notes: notes.trim() || null,
          },
          { onConflict: 'branch_id,business_date' }
        )
        // .select() so an RLS-invisible existing row can't report a successful
        // cash close that never landed.
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('Cash close was not saved (permission denied).');
      setCounted('');
      setNotes('');
      await load();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OpsShell title="Daily Cash Close" subtitle={businessDate} allow={['owner', 'admin']}>
      <div className="space-y-4 max-w-xl">
        <ClayCard className="p-4">
          <p className="text-xs text-clay-ink/60 font-medium">Expected (COD sales − expenses)</p>
          <p className="text-2xl font-bold text-clay-ink mt-1">{loading ? '…' : peso(expected)}</p>
        </ClayCard>

        {loadError && <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">{loadError}</p>}

        {existing && (
          <ClayCard className="p-4 space-y-1">
            <h2 className="font-display font-semibold text-clay-ink">Already closed for today</h2>
            <p className="text-sm text-clay-ink/70">Counted: <span className="font-semibold text-clay-ink">{peso(existing.counted_amount)}</span></p>
            <p className="text-sm text-clay-ink/70">
              Variance:{' '}
              <span className={'font-semibold ' + (Number(existing.variance ?? 0) < 0 ? 'text-rose-600' : 'text-clay-ink')}>
                {existing.variance !== null && existing.variance !== undefined ? peso(existing.variance) : '—'}
              </span>
            </p>
            {existing.notes && <p className="text-sm text-clay-ink/70">Notes: {existing.notes}</p>}
          </ClayCard>
        )}

        <ClayCard as="form" onSubmit={handleSubmit} className="p-5 space-y-3">
          <h2 className="font-display font-semibold text-clay-ink">{existing ? 'Re-close (overwrite)' : 'Close today'}</h2>
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Counted amount (₱)</label>
            <input type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} className="clay-input" placeholder="0.00" />
          </div>
          {variance !== null && !Number.isNaN(variance) && (
            <p className="text-sm text-clay-ink/70">
              Variance:{' '}
              <span className={'font-semibold ' + (variance < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                {variance >= 0 ? '+' : ''}{peso(variance)}
              </span>
            </p>
          )}
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="clay-input" placeholder="Optional" />
          </div>
          {formError && <p className="text-sm text-clay-danger bg-clay-danger-bg rounded-xl p-2">{formError}</p>}
          <ClayButton type="submit" loading={saving} disabled={saving} className="w-full">Save close</ClayButton>
        </ClayCard>
      </div>
    </OpsShell>
  );
}
