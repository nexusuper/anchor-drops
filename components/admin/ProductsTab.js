import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export default function ProductsTab({ savedPassword }) {
  const [products, setProducts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);
  const [error, setError] = useState(null);
  const [drafts, setDrafts] = useState({});

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/products', { password: savedPassword });
      const list = data?.products || [];
      setProducts(list);
      setDrafts(Object.fromEntries(list.map((p) => [p.sku, { refill_price: p.refill_price, container_price: p.container_price }])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchProducts()); }, [fetchProducts]);

  async function updateProduct(sku, updates) {
    setError(null);
    setPendingSku(sku);
    try {
      await apiFetch('/api/products', { method: 'PATCH', password: savedPassword, body: { sku, ...updates } });
      await fetchProducts();
    } catch (e) {
      setError(e.message);
    } finally {
      setPendingSku(null);
    }
  }

  function setDraft(sku, field, value) {
    setDrafts((d) => ({ ...d, [sku]: { ...d[sku], [field]: value } }));
  }

  function pricesDirty(p) {
    const d = drafts[p.sku];
    if (!d) return false;
    return Number(d.refill_price) !== Number(p.refill_price) || Number(d.container_price) !== Number(p.container_price);
  }

  return (
    <div className="space-y-4">
      {loading && !products && <p className="text-clay-ink/60 text-sm">Loading products…</p>}
      {error && <p className="text-sm text-clay-danger" role="alert">{error}</p>}
      {products && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => {
            const busy = pendingSku === p.sku;
            const d = drafts[p.sku] || { refill_price: p.refill_price, container_price: p.container_price };
            return (
              <div key={p.sku} className="clay-raised rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-clay-ink">{p.name}</p>
                    <p className={'text-xs font-bold mt-1 ' + (p.is_active ? 'text-emerald-600' : 'text-clay-danger')}>
                      {p.is_active ? 'AVAILABLE' : 'UNAVAILABLE'}
                    </p>
                    {p.is_active && p.sold_out && (
                      <p className="text-xs font-bold mt-0.5 text-amber-600">SOLD OUT RIGHT NOW</p>
                    )}
                  </div>
                  <button
                    onClick={() => updateProduct(p.sku, { is_active: !p.is_active })}
                    disabled={busy}
                    className={(p.is_active ? 'clay-btn-white' : 'clay-btn-primary') + ' text-sm px-3 py-1.5 rounded-full disabled:opacity-50 shrink-0'}
                  >
                    {busy ? '…' : p.is_active ? 'Turn Off' : 'Turn On'}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <label className="text-clay-ink/60 w-28 shrink-0">Refill ₱</label>
                  <input
                    type="number" min="0" step="1"
                    value={d.refill_price}
                    onChange={(e) => setDraft(p.sku, 'refill_price', e.target.value)}
                    className="clay-inset rounded-lg px-2 py-1 w-full"
                  />
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-clay-ink/60 w-28 shrink-0">Container+refill ₱</label>
                  <input
                    type="number" min="0" step="1"
                    value={Number(d.refill_price) + Number(d.container_price)}
                    onChange={(e) => setDraft(p.sku, 'container_price', e.target.value - Number(d.refill_price))}
                    className="clay-inset rounded-lg px-2 py-1 w-full"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    onClick={() => updateProduct(p.sku, { refill_price: Number(d.refill_price), container_price: Number(d.container_price) })}
                    disabled={busy || !pricesDirty(p)}
                    className="clay-btn-primary text-sm px-3 py-1.5 rounded-full disabled:opacity-40"
                  >
                    Save Price
                  </button>
                  <button
                    onClick={() => updateProduct(p.sku, { sold_out: !p.sold_out })}
                    disabled={busy}
                    className={(p.sold_out ? 'clay-btn-primary' : 'clay-btn-white') + ' text-sm px-3 py-1.5 rounded-full disabled:opacity-50'}
                  >
                    {busy ? '…' : p.sold_out ? 'Mark Available Now' : 'Mark Sold Out Now'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
