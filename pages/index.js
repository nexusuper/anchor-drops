import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import Image from 'next/image';
import AnimatedHero from '@/components/AnimatedHero';
import PurifyProcess from '@/components/PurifyProcess';
import WaterBackground from '@/components/water/WaterBackground';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { FB_PAGE_ID } from '@/pages/_app';
import { productImage, productUnit, useStorefrontCatalog } from '@/lib/storefront-catalog';
import { readLastOrder } from '@/lib/client-storage';

const features = [
  {
    icon: 'bolt',
    title: 'Order in Under 2 Minutes',
    desc: 'No login, no app to download. Fill a quick form, pick your pickup and delivery window, and we handle the rest.',
  },
  {
    icon: 'lock',
    title: 'Check Your Order Anytime',
    desc: 'Follow your order from received to delivered. Look it up by Order ID or phone number — no account required.',
  },
  {
    icon: 'filter',
    title: 'Free Refill After 10 Orders',
    desc: 'Gallon refill orders earn rewards automatically.',
  },
];

export default function Home() {
  const catalog = useStorefrontCatalog();
  const [canReorder, setCanReorder] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setCanReorder(Boolean(readLastOrder())));
  }, []);

  return (
    <Layout title="Anchor Drops — Scheduled Water Delivery, Tracked & Rewarded" background={<WaterBackground />}>
      <AnimatedHero canReorder={canReorder} />

      {/* Stats highlights */}
      <section className="max-w-6xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <ClayCard className="reveal p-10 text-center clay-raised">
            <div className="font-editorial text-3xl font-bold text-clay-sky mb-2">Same</div>
            <div className="font-editorial text-3xl font-bold text-clay-sky mb-1">Day</div>
            <div className="text-sm font-bold text-clay-muted uppercase tracking-wide">Delivery Available</div>
          </ClayCard>
          <ClayCard className="reveal reveal-d1 p-10 text-center clay-raised">
            <div className="font-editorial text-3xl font-bold text-clay-sky mb-2">Free</div>
            <div className="text-sm font-bold text-clay-muted uppercase tracking-wide">Refill After 10 Orders</div>
          </ClayCard>
          <ClayCard className="reveal reveal-d2 p-10 text-center clay-raised">
            <div className="font-editorial text-3xl font-bold text-clay-sky mb-2">100%</div>
            <div className="text-sm font-bold text-clay-muted uppercase tracking-wide">Purified, Not Mineral Water</div>
          </ClayCard>
        </div>

        {/* Trust badges */}
        <div className="reveal flex flex-wrap justify-center gap-x-6 gap-y-2 mt-8">
          {['DTI Registered', 'Bacteriological / Water Quality Tested', 'Sanitary Permit & Compliance', 'Accepts COD, GCASH, Bank Transfer'].map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-sm font-bold text-clay-ink">
              <ClayIcon name="check" className="w-4 h-4 text-clay-skydeep" /> {t}
            </span>
          ))}
        </div>
      </section>

      {/* Why Anchor Drops — editorial split layout */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-14 items-start">
          {/* Sticky heading column */}
          <div className="reveal lg:sticky lg:top-28">
            <span className="section-pill text-clay-ink! mb-5 inline-block">Why Anchor Drops</span>
            <h2 className="font-editorial text-4xl md:text-5xl font-bold text-clay-ink leading-[1.08] mb-4">
              Convenience,<br />built in.
            </h2>
            <p className="text-clay-ink font-semibold text-base leading-relaxed max-w-[42ch]">
              Pick your own pickup and delivery window, check your order status anytime, and let free refill vouchers stack up on their own.
            </p>
            <ul className="mt-6 space-y-2.5 text-base font-bold text-clay-ink">
              <li>💧 Safe &amp; Purified</li>
              <li>🚚 Fast Delivery</li>
              <li>💙 Friendly Service</li>
              <li>💳 Cash · GCash/Bank Transfer</li>
            </ul>
            <div className="mt-8">
              <ClayButton href="/order">ORDER WATER</ClayButton>
            </div>
          </div>

          {/* Feature rows */}
          <div className="reveal reveal-d1 clay-raised rounded-3xl overflow-hidden">
            {features.map((f, i) => (
              <div
                key={f.title}
                className={'flex items-start gap-5 p-7' + (i < features.length - 1 ? ' border-b border-sky-100' : '')}
              >
                <div className="shrink-0 grid place-items-center w-12 h-12 rounded-[16px] clay-raised-sm clay-tile-sky">
                  <ClayIcon name={f.icon} className="w-6 h-6 text-clay-sky" />
                </div>
                <div>
                  <h3 className="font-editorial font-bold text-clay-ink mb-1">{f.title}</h3>
                  <p className="text-clay-muted text-sm font-semibold leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <PurifyProcess />


      {/* Our Products */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <div className="reveal mb-10">
          <span className="section-pill text-clay-ink! mb-4 inline-block">Our Products</span>
          <h2 className="font-editorial text-4xl md:text-5xl font-bold text-clay-ink leading-[1.08]">
            Affordable, premium water.
          </h2>
        </div>
        {!catalog?.products && <p role="status">{catalog ? 'Current prices are temporarily unavailable.' : 'Loading current prices…'}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl mx-auto gap-6 mb-8">
          {catalog?.products?.map((p, i) => (
            <ClayCard key={p.id} className={`p-7 text-center reveal reveal-d${i}`}>
              {p.tag && <span className="inline-block text-xs font-extrabold text-white rounded-full px-3 py-1 mb-4 clay-btn-primary">
                {p.tag}
              </span>}
              {productImage(p) && <div className="clay-inset rounded-2xl h-36 p-3 mb-4 grid place-items-center overflow-hidden">
                <Image src={productImage(p)} alt="" width={184} height={120} data-product-image={p.id} style={{ width: '100%', height: 120, objectFit: 'contain' }} />
              </div>}
              <h3 className="font-editorial text-lg font-bold text-clay-ink mt-3 mb-1">{p.name}</h3>
              <p className="font-editorial text-3xl font-bold text-clay-skydeep mb-1">₱{p.refill}</p>
              <p className="text-xs font-bold text-clay-muted mb-5">
                {p.kind === 'refill' && p.container > 0
                  ? `refill only · new round container + first fill ₱${Number((p.refill + p.container).toFixed(2))}`
                  : p.kind === 'info' ? p.description : `per ${productUnit(p)}`}
              </p>
              {p.kind !== 'info' && <ClayButton href={`/order?product=${encodeURIComponent(p.id)}`} className="w-full">ORDER WATER</ClayButton>}
            </ClayCard>
          ))}
        </div>
        <div className="reveal text-center">
          <ClayButton href="/products" variant="outline">VIEW PRICES</ClayButton>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-10">
        <div className="reveal max-w-6xl mx-auto rounded-[2rem] px-8 md:px-14 py-16 flex flex-col items-center text-center gap-6 clay-raised">
          <span className="section-pill">Ready to Order?</span>
          <h2 className="font-editorial text-4xl md:text-5xl font-bold text-clay-ink leading-[1.08] max-w-xl">
            Water on your schedule, not the other way around.
          </h2>
          <p className="text-clay-muted font-semibold text-base max-w-md">
            Order without an account and check its status anytime.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <ClayButton href="/order" size="lg">ORDER WATER</ClayButton>
            <ClayButton href="/track" variant="outline" size="lg">TRACK ORDER</ClayButton>
          </div>
          <p className="text-sm font-bold text-clay-skydeep">💧 Free refill after 10 gallon refills.</p>
        </div>
      </section>

      {/* Messenger contact */}
      <section className="px-4 pb-16">
        <ClayCard className="reveal max-w-3xl mx-auto p-8 md:p-10 text-center">
          <div
            className="mx-auto mb-4 grid place-items-center w-14 h-14 rounded-[18px] clay-raised-sm clay-tile-blue"
          >
            <ClayIcon name="chat" className="w-7 h-7 text-white" />
          </div>
          <h2 className="font-editorial text-2xl font-bold text-clay-ink mb-2">Questions or concerns?</h2>
          <p className="text-clay-muted font-semibold mb-6 max-w-md mx-auto">
            Message us on Facebook anytime — tap the{' '}
            <span className="text-clay-ink2 font-bold">chat button</span> in the corner, or reach us directly below.
          </p>
          {FB_PAGE_ID && (
            <a
              href={`https://m.me/${FB_PAGE_ID}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full px-8 py-4 font-editorial font-semibold text-white clay-pressable clay-tile-blue-shadow"
            >
              <ClayIcon name="chat" className="w-5 h-5" /> Chat on Messenger
            </a>
          )}
        </ClayCard>
      </section>
    </Layout>
  );
}
