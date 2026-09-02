import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export default function InventoryTab({ savedPassword, onLowStockCount }) {
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(false);
  const [restockQty, setRestockQty] = useState({});
  const [adjustDelta, setAdjustDelta] = useState({});
  const [saving, setSaving] = useState(null);
  const [fieldError, setFieldError] = useState(null);

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

  async function restockProduct(productId) {
    const qty = parseInt(restockQty[productId], 10);
    if (!qty || qty < 1) { setFieldError(productId + ':restock'); return; }
    setFieldError(null);
    setSaving(productId + ':restock');
    try {
      await apiFetch('/api/inventory/restock', { method: 'POST', password: savedPassword, body: { product_id: productId, quantity: qty } });
      setRestockQty((s) => ({ ...s, [productId]: '' }));
      await fetchInventory();
    } catch (e) {
      console.error('Restock failed:', e);
    } finally {
      setSaving(null);
    }
  }

  async function adjustProduct(productId) {
    const delta = parseInt(adjustDelta[productId], 10);
    if (!delta || delta === 0) { setFieldError(productId + ':adjust'); return; }
    setFieldError(null);
    setSaving(productId + ':adjust');
    try {
      await apiFetch('/api/inventory/adjust', { method: 'POST', password: savedPassword, body: { product_id: productId, delta } });
      setAdjustDelta((s) => ({ ...s, [productId]: '' }));
      await fetchInventory();
    } catch (e) {
      console.error('Adjust failed:', e);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      {loading && !inventory && (
        <p className="text-clay-ink/60 text-sm">Loading inventory…</p>
      )}
      {inventory && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {inventory.items.map((it) => (
              <div key={it.product_id} className="clay-raised rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-clay-ink">{it.name}</p>
                  {it.low_stock && (
                    <span className="text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full px-2 py-0.5">LOW</span>
                  )}
                </div>
                <p className="text-3xl font-bold text-sky-700 mt-2">{it.current_stock}</p>
                <p className="text-xs text-clay-ink/50">in stock · alert at {it.low_stock_threshold}</p>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="number" min="1" placeholder="Qty"
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
                </div>
                {fieldError === it.product_id + ':restock' && (
                  <p className="text-xs text-clay-danger mt-1" role="alert">Enter a quantity of at least 1</p>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number" placeholder="+/−"
                    value={adjustDelta[it.product_id] || ''}
                    onChange={(e) => setAdjustDelta((s) => ({ ...s, [it.product_id]: e.target.value }))}
                    className="clay-input w-20 text-sm py-1.5 px-2"
                  />
                  <button
                    onClick={() => adjustProduct(it.product_id)}
                    disabled={saving === it.product_id + ':adjust'}
                    className="clay-btn-white text-sm px-3 py-1 rounded-full disabled:opacity-50"
                  >
                    {saving === it.product_id + ':adjust' ? '…' : 'Adjust'}
                  </button>
                </div>
                {fieldError === it.product_id + ':adjust' && (
                  <p className="text-xs text-clay-danger mt-1" role="alert">Enter a non-zero adjustment</p>
                )}
              </div>
            ))}
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
                      {' · '}{l.product_id}
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
