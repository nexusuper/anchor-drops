import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

const EMPTY_NEW = { name: '', starting_stock: '', threshold: '10' };

export default function InventoryTab({ savedPassword, onLowStockCount }) {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restockQty, setRestockQty] = useState({});
  const [editing, setEditing] = useState(null); // { product_id, name, stock, threshold }
  const [adding, setAdding] = useState(null); // EMPTY_NEW shape while the add form is open
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null); // { key, message }

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/inventory', { password: savedPassword });
      setInventory(data);
      onLowStockCount?.(data?.low_stock_count || 0);
    } catch (e) {
      console.error('Failed to fetch inventory:', e);
    } finally {
      setLoading(false);
    }
  }, [savedPassword, onLowStockCount]);

  useEffect(() => { queueMicrotask(() => fetchInventory()); }, [fetchInventory]);

  async function run(key, fn) {
    setError(null);
    setSaving(key);
    try {
      await fn();
      await fetchInventory();
      return true;
    } catch (e) {
      setError({ key, message: e.message });
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function restockProduct(productId) {
    const qty = parseInt(restockQty[productId], 10);
    if (!qty || qty < 1) { setError({ key: productId + ':restock', message: 'Enter a quantity of at least 1' }); return; }
    const ok = await run(productId + ':restock', () =>
      apiFetch('/api/inventory/restock', { method: 'POST', password: savedPassword, body: { product_id: productId, quantity: qty } }));
    if (ok) setRestockQty((s) => ({ ...s, [productId]: '' }));
  }

  async function saveEdit(it) {
    const stock = parseInt(editing.stock, 10);
    const threshold = parseInt(editing.threshold, 10);
    const name = editing.name.trim();
    if (!name || !(stock >= 0) || !(threshold >= 0)) {
      setError({ key: it.product_id + ':edit', message: 'Name is required; stock and alert level must be 0 or more' });
      return;
    }
    const body = { product_id: it.product_id };
    if (name !== it.name) body.name = name;
    if (stock !== it.current_stock) body.set_stock = stock;
    if (threshold !== it.low_stock_threshold) body.threshold = threshold;
    if (Object.keys(body).length === 1) { setEditing(null); return; }
    const ok = await run(it.product_id + ':edit', () =>
      apiFetch('/api/inventory/adjust', { method: 'POST', password: savedPassword, body }));
    if (ok) setEditing(null);
  }

  async function addItem() {
    const name = adding.name.trim();
    const starting = adding.starting_stock === '' ? 0 : parseInt(adding.starting_stock, 10);
    const threshold = parseInt(adding.threshold, 10);
    if (!name || !(starting >= 0) || !(threshold >= 0)) {
      setError({ key: 'new', message: 'Name is required; stock and alert level must be 0 or more' });
      return;
    }
    const ok = await run('new', () =>
      apiFetch('/api/inventory', { method: 'POST', password: savedPassword, body: { name, starting_stock: starting, threshold } }));
    if (ok) setAdding(null);
  }

  const errorFor = (key) => error?.key === key && (
    <p className="text-xs text-clay-danger mt-1" role="alert">{error.message}</p>
  );

  return (
    <div className="space-y-6">
      {loading && !inventory && (
        <p className="text-clay-ink/60 text-sm">Loading inventory…</p>
      )}
      {inventory && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inventory.items.map((it) => {
              const isEditing = editing?.product_id === it.product_id;
              return (
                <div key={it.product_id} className="clay-raised rounded-2xl p-4">
                  {isEditing ? (
                    <div className="space-y-2">
                      <label className="block text-xs text-clay-ink/60">Name
                        <input value={editing.name} maxLength={60} onChange={(e) => setEditing((s) => ({ ...s, name: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-clay-ink/60">In stock
                          <input type="number" min="0" value={editing.stock} onChange={(e) => setEditing((s) => ({ ...s, stock: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                        </label>
                        <label className="block text-xs text-clay-ink/60">Alert at
                          <input type="number" min="0" value={editing.threshold} onChange={(e) => setEditing((s) => ({ ...s, threshold: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                        </label>
                      </div>
                      {it.shared_with.length > 0 && (
                        <p className="text-[11px] text-clay-ink/50">Renaming also changes this product&apos;s name in the staff app.</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => saveEdit(it)} disabled={saving === it.product_id + ':edit'} className="clay-btn-primary text-sm px-3 py-1 rounded-full disabled:opacity-50">
                          {saving === it.product_id + ':edit' ? '…' : 'Save'}
                        </button>
                        <button onClick={() => { setEditing(null); setError(null); }} className="clay-btn-white text-sm px-3 py-1 rounded-full">Cancel</button>
                      </div>
                      {errorFor(it.product_id + ':edit')}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-clay-ink">{it.name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {it.is_supply && (
                            <span className="text-[10px] font-bold bg-clay-ink/10 text-clay-ink/70 rounded-full px-2 py-0.5">SUPPLY</span>
                          )}
                          {it.low_stock && (
                            <span className="text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full px-2 py-0.5">LOW</span>
                          )}
                        </div>
                      </div>
                      {it.shared_with.length > 0 && (
                        <p className="text-xs text-clay-ink/50">Shared stock with {it.shared_with.join(', ')}</p>
                      )}
                      <p className="text-3xl font-bold text-sky-700 mt-2">{it.current_stock}</p>
                      <p className="text-xs text-clay-ink/50">in stock · alert at {it.low_stock_threshold}</p>

                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="number" min="1" placeholder="Qty"
                          aria-label={`Restock quantity for ${it.name}`}
                          value={restockQty[it.product_id] || ''}
                          onChange={(e) => setRestockQty((s) => ({ ...s, [it.product_id]: e.target.value }))}
                          className="clay-input w-20 text-sm py-1.5 px-2"
                        />
                        <button
                          onClick={() => restockProduct(it.product_id)}
                          disabled={saving === it.product_id + ':restock'}
                          className="clay-btn-primary text-sm px-3 py-1 rounded-full disabled:opacity-50"
                        >
                          {saving === it.product_id + ':restock' ? '…' : 'Restock'}
                        </button>
                        <button
                          onClick={() => { setError(null); setEditing({ product_id: it.product_id, name: it.name, stock: String(it.current_stock), threshold: String(it.low_stock_threshold) }); }}
                          className="clay-btn-white text-sm px-3 py-1 rounded-full ml-auto"
                        >
                          Edit
                        </button>
                      </div>
                      {errorFor(it.product_id + ':restock')}
                    </>
                  )}
                </div>
              );
            })}

            <div className="clay-raised rounded-2xl p-4">
              {adding ? (
                <div className="space-y-2">
                  <p className="font-semibold text-clay-ink">New stock item</p>
                  <label className="block text-xs text-clay-ink/60">Name
                    <input value={adding.name} maxLength={60} placeholder="e.g. Bottle caps" onChange={(e) => setAdding((s) => ({ ...s, name: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-clay-ink/60">Starting stock
                      <input type="number" min="0" placeholder="0" value={adding.starting_stock} onChange={(e) => setAdding((s) => ({ ...s, starting_stock: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                    </label>
                    <label className="block text-xs text-clay-ink/60">Alert at
                      <input type="number" min="0" value={adding.threshold} onChange={(e) => setAdding((s) => ({ ...s, threshold: e.target.value }))} className="clay-input text-sm py-1.5 px-2 mt-0.5" />
                    </label>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={addItem} disabled={saving === 'new'} className="clay-btn-primary text-sm px-3 py-1 rounded-full disabled:opacity-50">
                      {saving === 'new' ? '…' : 'Add'}
                    </button>
                    <button onClick={() => { setAdding(null); setError(null); }} className="clay-btn-white text-sm px-3 py-1 rounded-full">Cancel</button>
                  </div>
                  {errorFor('new')}
                </div>
              ) : (
                <button onClick={() => { setError(null); setAdding(EMPTY_NEW); }} className="w-full h-full min-h-[120px] rounded-xl border-2 border-dashed border-clay-ink/15 text-clay-ink/60 font-semibold text-sm hover:border-sky-400 hover:text-sky-700">
                  + Add stock item
                </button>
              )}
            </div>
          </div>

          <div className="clay-raised rounded-2xl p-4">
            <p className="text-sm font-semibold text-clay-ink mb-3">Recent movements</p>
            {inventory.log.length === 0 ? (
              <p className="text-xs text-clay-ink/50">No movements yet</p>
            ) : (
              <ul className="space-y-1.5">
                {inventory.log.map((l) => (
                  <li key={l.id} className="flex items-center justify-between text-sm border-b border-clay-ink/5 pb-1">
                    <span className="text-clay-ink/70">
                      <span className="capitalize font-medium">{l.type}</span>
                      {' · '}{l.product_name}
                      {l.order_id ? ` · #${l.order_id}` : ''}
                      {l.reason ? ` · ${l.reason}` : ''}
                    </span>
                    <span className={'font-semibold ' + (l.delta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                      {l.delta > 0 ? '+' : ''}{l.delta}
                    </span>
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
