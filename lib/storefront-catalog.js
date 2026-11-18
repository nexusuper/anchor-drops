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

const PRODUCT_IMAGES = {
  round5_pickup: '/products/round-pickup.webp',
  round5: '/products/round-delivery.webp',
  slim5: '/products/slim-jug.webp',
  bottle_500: '/products/bottle-500ml.webp',
  bottle_500_pack: '/products/bottle-500ml-pack.webp',
  bottle_1l: '/products/bottle-1l.webp',
  bottle_1l_pack: '/products/bottle-1l-pack.webp',
  vendo_refill: '/products/vendo.webp',
};

export function productImage(product) {
  if (PRODUCT_IMAGES[product.id]) return PRODUCT_IMAGES[product.id];
  const id = product.id.toLowerCase();
  if (id.includes('vendo')) return '/products/vendo.webp';
  if (id.includes('slim')) return '/products/slim-jug.webp';
  if (product.kind === 'filled_container') return '/products/round-container.webp';
  if (product.kind === 'refill') return product.fulfillment === 'pickup'
    ? '/products/round-pickup.webp'
    : '/products/round-delivery.webp';
  if (product.kind === 'bottle') {
    const liter = id.includes('1l') || product.size?.toLowerCase().includes('1 l');
    const pack = id.endsWith('_pack');
    return `/products/bottle-${liter ? '1l' : '500ml'}${pack ? '-pack' : ''}.webp`;
  }
  return null;
}
