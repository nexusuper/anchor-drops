import { useCallback, useEffect, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import { manilaToday } from '@/lib/scheduling';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';
import { uuidv4 } from '@/lib/uuid';

// Web port of the Expo app/(app)/finance/index.tsx. Same numbers, same range
// presets, same RLS-only data access (anon key + user session) — no API route,
// no service_role. Sales/expense sums are two reduces (src/domain/finance.ts
// computeProfitSnapshot); no lib/finance.js here — lib/scheduling.js already
// owns the Manila "today" helper the app's phtDateString provides.
const RANGE_PRESETS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: '7 days', days: 6 },
  { key: '30d', label: '30 days', days: 29 },
];

function rangeFor(key) {
  const to = manilaToday();
  const days = RANGE_PRESETS.find((p) => p.key === key)?.days ?? 6;
  const from = days === 0 ? to : manilaToday(new Date(Date.now() - days * 86400000));
  return { from, to };
}

const peso = (n) => `₱${Number(n || 0).toFixed(2)}`;

export default function FinancePage() {
  const { role, branchId } = useOpsSession();
  const canWrite = role === 'owner' || role === 'admin';

  const [preset, setPreset] = useState('7d');
  const [snapshot, setSnapshot] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    const { from, to } = rangeFor(preset);
    const supabase = getSupabaseBrowser();
    setLoading(true);
    setError(null);
    try {
      // Sales = delivered orders in range; orders are soft-deleted so the
      // archived rows must never count toward revenue.
      const [ordersRes, expensesRes] = await Promise.all([
        supabase
          .from('orders')
          .select('total_amount')
          .eq('status', 'delivered')
          .is('archived_at', null)
          .gte('delivery_date', from)
          .lte('delivery_date', to),
        supabase
          .from('expenses')
          .select('*')
          .gte('spent_at', from)
          .lte('spent_at', to)
          .order('spent_at', { ascending: false }),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      if (expensesRes.error) throw expensesRes.error;
      const sales = (ordersRes.data || []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
      const spent = (expensesRes.data || []).reduce((s, e) => s + Number(e.amount || 0), 0);
      setSnapshot({ sales, expenses: spent, profit: sales - spent });
      setExpenses(expensesRes.data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [preset]);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  return (
    <OpsShell
      title="Finance"
      allow={['owner', 'admin']}
      actions={
        <ClayButton href="/admin/ops/finance/reconcile" variant="white" size="sm">
          <ClayIcon name="cash" className="w-4 h-4" /> Cash Recon
        </ClayButton>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-2">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              className={
                'rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' +
                (preset === p.key ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <ClayCard className="p-4">
            <p className="text-xs text-clay-ink/60 font-medium">Sales</p>
            <p className="text-2xl font-bold text-clay-ink mt-1">{peso(snapshot?.sales)}</p>
            <p className="text-xs text-clay-ink/50 mt-1">delivered orders</p>
          </ClayCard>
          <ClayCard className="p-4">
            <p className="text-xs text-clay-ink/60 font-medium">Expenses</p>
            <p className="text-2xl font-bold text-rose-600 mt-1">{peso(snapshot?.expenses)}</p>
            <p className="text-xs text-clay-ink/50 mt-1">this range</p>
          </ClayCard>
          <ClayCard className="p-4">
            <p className="text-xs text-clay-ink/60 font-medium">Profit</p>
            <p className={'text-2xl font-bold mt-1 ' + ((snapshot?.profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600')}>
              {peso(snapshot?.profit)}
            </p>
            <p className="text-xs text-clay-ink/50 mt-1">net</p>
          </ClayCard>
        </div>

        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-semibold text-clay-ink">Recent Expenses</h2>
          {canWrite && (
            <ClayButton size="sm" variant={showAdd ? 'outline' : 'primary'} onClick={() => setShowAdd((v) => !v)}>
              {showAdd ? 'Cancel' : <><ClayIcon name="plus" className="w-4 h-4" /> Add Expense</>}
            </ClayButton>
          )}
        </div>

        {canWrite && showAdd && (
          <FinanceAddExpenseForm
            branchId={branchId}
            onDone={() => { setShowAdd(false); load(); }}
          />
        )}

        {error && <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>}

        {loading && <p className="text-sm text-clay-ink/50">Loading…</p>}
        {!loading && expenses.length === 0 && <p className="text-sm text-clay-ink/50">No expenses in this range</p>}

        <ul className="space-y-2">
          {expenses.map((e) => <FinanceExpenseRow key={e.id} expense={e} />)}
        </ul>
      </div>
    </OpsShell>
  );
}

// Admin/owner only — the page hides this behind `canWrite` so staff never see
// the form, on top of RLS blocking the insert server-side (0002_rls.sql
// expenses_ins: owner or admin-in-branch only).
function FinanceAddExpenseForm({ branchId, onDone }) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(manilaToday());
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  async function handleSubmit(ev) {
    ev.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError('No branch on this account — cannot record an expense.');
      return;
    }
    const amountNum = Number(amount);
    if (!category.trim() || !amountNum || amountNum <= 0) {
      setFormError('Category and a positive amount are required.');
      return;
    }
    setSaving(true);
    const supabase = getSupabaseBrowser();
    try {
      let receiptPath = null;
      if (receipt) {
        // Private bucket, keyed by a fresh UUID — store the bare path, never a
        // public URL (mirrors src/api/finance.ts uploadExpenseReceipt).
        receiptPath = `${uuidv4()}/receipt.jpg`;
        const { error } = await supabase.storage
          .from('expense-receipts')
          .upload(receiptPath, receipt, { contentType: receipt.type || 'image/jpeg' });
        if (error) throw error;
      }
      const { error: insErr } = await supabase.from('expenses').insert({
        branch_id: branchId,
        category: category.trim(),
        amount: amountNum,
        spent_at: spentAt,
        notes: notes.trim() || null,
        receipt_path: receiptPath,
      });
      if (insErr) throw insErr;
      onDone();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ClayCard as="form" onSubmit={handleSubmit} className="p-5 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="clay-input capitalize">
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Amount (₱)</label>
          <input type="number" min="0" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className="clay-input" placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Date</label>
          <input type="date" required value={spentAt} onChange={(e) => setSpentAt(e.target.value)} className="clay-input" />
        </div>
        <div>
          {/* Web equivalent of the app's camera/library picker: `capture` lets a
              phone open the camera directly, desktop falls back to a file pick. */}
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Receipt photo (optional)</label>
          <input type="file" accept="image/*" capture="environment" onChange={(e) => setReceipt(e.target.files?.[0] || null)} className="clay-input text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-clay-ink2 mb-1">Notes (optional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} className="clay-input" placeholder="Supplier, what it was for" />
      </div>
      {formError && <p className="text-sm text-clay-danger bg-clay-danger-bg rounded-xl p-2">{formError}</p>}
      <ClayButton type="submit" loading={saving} disabled={saving} className="w-full">Save expense</ClayButton>
    </ClayCard>
  );
}

// Receipt photo lives in Storage, not the row — fetch a signed URL lazily per
// row. Fail quietly (object may have been deleted out-of-band).
function FinanceExpenseRow({ expense }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setUrl(null);
      setFailed(false);
      if (!expense.receipt_path) return;
      getSupabaseBrowser().storage
        .from('expense-receipts')
        .createSignedUrl(expense.receipt_path, 300)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error || !data?.signedUrl) setFailed(true);
          else setUrl(data.signedUrl);
        })
        .catch(() => { if (!cancelled) setFailed(true); });
    });
    return () => { cancelled = true; };
  }, [expense.receipt_path]);

  return (
    <ClayCard as="li" variant="raisedSm" className="p-3 flex items-center gap-3">
      {expense.receipt_path && (
        url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt="Receipt" className="w-10 h-10 rounded-xl object-cover border border-clay-ink/10" />
          </a>
        ) : (
          <span className="w-10 h-10 rounded-xl bg-clay-bg grid place-items-center text-[9px] text-clay-ink/40">
            {failed ? 'N/A' : '…'}
          </span>
        )
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-clay-ink capitalize">{expense.category}</p>
        <p className="text-xs text-clay-ink/60 truncate">
          {expense.spent_at}{expense.notes ? ` · ${expense.notes}` : ''}
        </p>
      </div>
      <span className="font-bold text-clay-ink whitespace-nowrap">{peso(expense.amount)}</span>
    </ClayCard>
  );
}
