import { useState, useEffect, useCallback } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { apiFetch } from '@/lib/api-client';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';

function monthBounds(d = new Date()) {
  const today = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export default function ExpensesTab({ savedPassword, onError }) {
  const bounds = monthBounds();
  const [from, setFrom] = useState(bounds.from);
  const [to, setTo] = useState(bounds.to);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(bounds.to);
  const [notes, setNotes] = useState('');
  const [receipt, setReceipt] = useState('');

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch(`/api/expenses?from=${from}&to=${to}`, { password: savedPassword });
      setData(d);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setLoading(false);
    }
  }, [savedPassword, from, to, onError]);

  useEffect(() => { queueMicrotask(() => fetchExpenses()); }, [fetchExpenses]);

  function pickReceipt(file) {
    if (!file) { setReceipt(''); return; }
    const reader = new FileReader();
    reader.onload = () => setReceipt(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function addExpense(e) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) return;
    setSaving(true);
    try {
      await apiFetch('/api/expenses', {
        method: 'POST',
        password: savedPassword,
        body: { category, amount: amt, spent_at: spentAt, notes, receipt },
      });
      setAmount('');
      setNotes('');
      setReceipt('');
      await fetchExpenses();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeExpense(id) {
    setDeleting(id);
    try {
      await apiFetch(`/api/expenses/${id}`, { method: 'DELETE', password: savedPassword });
      await fetchExpenses();
    } catch (err) {
      onError?.(err.message);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={addExpense} className="clay-raised rounded-3xl p-5 space-y-3">
        <h3 className="font-display font-semibold text-clay-ink">Record an expense</h3>
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
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Receipt photo (optional)</label>
            <input type="file" accept="image/*" capture="environment" onChange={(e) => pickReceipt(e.target.files?.[0])} className="clay-input text-sm" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Notes (supplier, what it was for)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="clay-input" placeholder="Optional" />
        </div>
        <button type="submit" disabled={saving} className="w-full clay-btn-primary clay-pressable rounded-full py-3 font-display font-semibold disabled:opacity-60">
          {saving ? 'Saving…' : 'Add Expense'}
        </button>
      </form>

      <div className="flex flex-col sm:flex-row gap-3 items-end">
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-clay-ink2 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="clay-input w-full" />
        </div>
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-clay-ink2 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="clay-input w-full" />
        </div>
      </div>

      {loading && !data && <p className="text-clay-ink/60 text-sm">Loading expenses…</p>}

      {data && (
        <>
          <div className="clay-raised rounded-2xl p-4">
            <p className="text-xs text-clay-ink/60 font-medium">Total for this period</p>
            <p className="text-3xl font-bold text-rose-600 mt-1">₱{data.total.toLocaleString()}</p>
            {data.byCategory.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {data.byCategory.map((c) => (
                  <li key={c.category} className="flex justify-between text-sm">
                    <span className="capitalize text-clay-ink/70">{c.category}</span>
                    <span className="font-semibold text-clay-ink">₱{c.amount.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="clay-raised rounded-2xl p-4">
            <p className="text-sm font-semibold text-clay-ink mb-3">Expenses</p>
            {data.expenses.length === 0 ? (
              <p className="text-xs text-clay-ink/50">Nothing recorded for this period</p>
            ) : (
              <ul className="divide-y divide-clay-ink/5">
                {data.expenses.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-clay-ink capitalize">
                        {e.category}
                        <span className="text-clay-ink/40 font-normal"> · {e.spent_at}</span>
                      </p>
                      {e.notes && <p className="text-xs text-clay-ink/60 truncate">{e.notes}</p>}
                    </div>
                    {e.receipt_path && (
                      <a href={e.receipt_path} target="_blank" rel="noopener noreferrer">
                        <img src={e.receipt_path} alt="Receipt" className="w-9 h-9 object-cover rounded-lg border border-clay-ink/10" />
                      </a>
                    )}
                    <span className="font-bold text-rose-600 whitespace-nowrap">₱{Number(e.amount).toLocaleString()}</span>
                    <button
                      onClick={() => removeExpense(e.id)}
                      disabled={deleting === e.id}
                      title="Delete expense"
                      className="text-xs bg-red-100 hover:bg-red-200 text-red-600 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50"
                    >
                      <ClayIcon name="trash" className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
