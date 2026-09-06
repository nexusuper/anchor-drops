import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export default function ProductsTab({ savedPassword }) {
  const [products, setProducts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingSku, setPendingSku] = useState(null);
  const [error, setError] = useState(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/products', { password: savedPassword });
      setProducts(data?.products || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchProducts()); }, [fetchProducts]);

  async function toggleProduct(sku, nextActive) {
    setError(null);
    setPendingSku(sku);
    try {
      await apiFetch('/api/products', { method: 'PATCH', password: savedPassword, body: { sku, is_active: nextActive } });
      await fetchProducts();
    } catch (e) {
      setError(e.message);
    } finally {
      setPendingSku(null);
    }
  }

  return (
    <div className="space-y-4">
      {loading && !products && <p className="text-clay-ink/60 text-sm">Loading products…</p>}
      {error && <p className="text-sm text-clay-danger" role="alert">{error}</p>}
      {products && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((p) => (
            <div key={p.sku} className="clay-raised rounded-2xl p-4 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-clay-ink">{p.name}</p>
                <p className="text-xs text-clay-ink/50">₱{p.refill_price} refill · ₱{Number(p.refill_price) + Number(p.container_price)} container+refill</p>
                <p className={'text-xs font-bold mt-1 ' + (p.is_active ? 'text-emerald-600' : 'text-clay-danger')}>
                  {p.is_active ? 'AVAILABLE' : 'UNAVAILABLE'}
                </p>
              </div>
              <button
                onClick={() => toggleProduct(p.sku, !p.is_active)}
                disabled={pendingSku === p.sku}
                className={(p.is_active ? 'clay-btn-white' : 'clay-btn-primary') + ' text-sm px-3 py-1.5 rounded-full disabled:opacity-50 shrink-0'}
              >
                {pendingSku === p.sku ? '…' : p.is_active ? 'Turn Off' : 'Turn On'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
