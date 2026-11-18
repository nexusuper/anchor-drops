import Layout from '@/components/Layout';
import PurifyProcess from '@/components/PurifyProcess';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import Image from 'next/image';
import { productImage, productUnit, useStorefrontCatalog } from '@/lib/storefront-catalog';

const payments = [
  { icon: 'cash', name: 'Cash on Delivery', desc: 'Pay when your water arrives.' },
  { icon: 'mobile', name: 'GCash', desc: 'Send via GCash before delivery.' },
  { icon: 'card', name: 'Bank Transfer', desc: 'Send via bank transfer before delivery.' },
];

export default function Products() {
  const catalog = useStorefrontCatalog();

  return (
    <Layout title="Products & Pricing — Anchor Drops">
      <section className="max-w-6xl mx-auto px-4 pt-14 pb-6 reveal">
        <span className="section-pill mb-5 inline-block">Our Products</span>
        <h1 className="font-editorial text-4xl md:text-5xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Transparent pricing.<br /><span style={{ color: '#0ea5e9' }}>No hidden fees.</span>
        </h1>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-14 reveal">
        {!catalog?.products && <p role="status">{catalog ? 'Current prices are temporarily unavailable.' : 'Loading current prices…'}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {catalog?.products?.map((p) => (
            <ClayCard key={p.id} className="p-7 flex flex-col">
              {p.tag && <span className="self-center text-xs font-extrabold text-white rounded-full px-4 py-1.5 mb-4 clay-btn-primary">{p.tag}</span>}
              {productImage(p) && <div className="clay-inset rounded-2xl h-44 p-3 mb-5 grid place-items-center overflow-hidden">
                <Image src={productImage(p)} alt="" width={220} height={152} data-product-image={p.id} style={{ width: '100%', height: 152, objectFit: 'contain' }} />
              </div>}
              <h2 className="text-xl font-editorial font-semibold text-clay-ink text-center mb-1">{p.name}</h2>
              <p className="text-clay-muted text-sm text-center mb-6 font-semibold">{p.description}</p>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">{p.kind === 'refill' ? 'Refill only' : `Per ${productUnit(p)}`}</span>
                  <span className="font-editorial text-clay-skydeep font-bold text-lg">₱{p.refill}</span>
                </div>
                {p.kind === 'refill' && p.container > 0 && <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">New round container + first fill</span>
                  <span className="font-editorial text-clay-skydeep font-bold text-lg">₱{Number((p.refill + p.container).toFixed(2))}</span>
                </div>}
                {p.kind === 'bottle' && <p className="text-clay-muted text-sm text-center">Store pickup or delivery</p>}
              </div>
              {p.kind !== 'info' && <ClayButton href={`/order?product=${encodeURIComponent(p.id)}`} className="mt-auto w-full">ORDER WATER</ClayButton>}
            </ClayCard>
          ))}
        </div>
      </section>

      <PurifyProcess />

      <section className="max-w-4xl mx-auto px-4 py-12">
        <h2 className="font-editorial text-2xl font-bold text-clay-ink text-center mb-6">Accepted Payments</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {payments.map((m) => (
            <ClayCard key={m.name} className="p-5 text-center">
              <div className="mx-auto mb-3 grid place-items-center w-14 h-14 rounded-2xl clay-raised-sm" style={{ background: 'linear-gradient(145deg,#e9f6ff,#d3ecfb)' }}>
                <ClayIcon name={m.icon} className="w-7 h-7 text-clay-sky" />
              </div>
              <h3 className="font-editorial font-semibold text-clay-ink2 mb-1">{m.name}</h3>
              <p className="text-clay-muted text-sm">{m.desc}</p>
            </ClayCard>
          ))}
        </div>
      </section>

      <section className="px-4 pb-16">
        <div className="reveal max-w-3xl mx-auto rounded-[2rem] px-8 md:px-14 py-14 flex flex-col items-center text-center gap-5 clay-raised">
          <span className="section-pill">Ready to Order?</span>
          <h2 className="font-editorial text-3xl md:text-4xl font-bold text-clay-ink leading-[1.08]">Like what you see?</h2>
          <ClayButton href="/order" size="lg">ORDER WATER</ClayButton>
        </div>
      </section>
    </Layout>
  );
}
