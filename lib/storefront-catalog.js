import { useEffect, useState } from 'react';

export function useStorefrontCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    function load() {
      fetch('/api/ordering-status', { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error('Catalog unavailable');
          setCatalog(await res.json());
        })
        .catch(() => {
          if (!controller.signal.aborted) setCatalog({ products: null });
        });
    }
    load();
    window.addEventListener('focus', load);
    return () => {
      controller.abort();
      window.removeEventListener('focus', load);
    };
  }, []);
  return catalog;
}

export function productUnit(product) {
  if (product.kind === 'bottle') return product.id.endsWith('_pack') ? 'pack' : 'bottle';
  return product.kind === 'filled_container' ? 'jug' : 'refill';
}
