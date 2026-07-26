import Layout from '@/components/Layout';
import PurifyProcess from '@/components/PurifyProcess';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { PRODUCTS, DELIVERY_RULES } from '@/lib/products';

const payments = [
  { icon: 'cash', name: 'Cash on Delivery', desc: 'Pay when your water arrives.' },
  { icon: 'mobile', name: 'GCash', desc: 'Send via GCash before delivery.' },
  { icon: 'card', name: 'Bank Transfer', desc: 'Send via bank transfer before delivery.' },
];

export default function Products() {
  return (
    <Layout title="Products & Pricing — Anchor Drops">
      <section className="max-w-6xl mx-auto px-4 pt-14 pb-6 reveal">
        <span className="section-pill mb-5 inline-block">Our Products</span>
        <h1 className="font-editorial text-4xl md:text-5xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Transparent pricing.<br /><span style={{ color: '#0ea5e9' }}>No hidden fees.</span>
        </h1>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-14 reveal">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {PRODUCTS.map((p) => (
            <ClayCard key={p.id} className="p-7 flex flex-col">
              <span className="self-center text-xs font-extrabold text-white rounded-full px-4 py-1.5 mb-4 clay-btn-primary">{p.tag}</span>
              <h2 className="text-xl font-editorial font-semibold text-clay-ink text-center mb-1">{p.name}</h2>
              <p className="text-clay-muted text-sm text-center mb-6 font-semibold">{p.description}</p>
              <div className="space-y-3 mb-6">
                <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">Refill only</span>
                  <span className="font-editorial text-clay-skydeep font-bold text-lg">₱{p.refill}</span>
                </div>
                <div className="flex justify-between items-center clay-inset rounded-xl px-4 py-2.5">
                  <span className="text-clay-muted text-sm font-semibold">Container + refill</span>
                  <span className="font-editorial text-clay-skydeep font-bold text-lg">₱{p.container}</span>
                </div>
              </div>
              <ClayButton href={`/order?product=${p.id}`} className="mt-auto w-full">Order Now</ClayButton>
            </ClayCard>
          ))}
        </div>
      </section>

      <PurifyProcess />

      <section className="max-w-2xl mx-auto px-4 py-12">
        <h2 className="font-editorial text-2xl font-bold text-clay-ink text-center mb-6">Delivery Fees</h2>
        <ClayCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="clay-inset">
              <tr>
                <th className="text-left px-5 py-3 text-clay-ink2 font-editorial">Order Size</th>
                <th className="text-right px-5 py-3 text-clay-ink2 font-editorial">Delivery Fee</th>
              </tr>
            </thead>
            <tbody>
              {DELIVERY_RULES.map((r, i) => (
                <tr key={i}>
                  <td className="px-5 py-3 text-clay-ink font-semibold">{r.label}</td>
                  <td className="px-5 py-3 text-right font-editorial font-bold text-clay-skydeep">{r.feeLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ClayCard>
        <p className="text-clay-muted text-xs text-center mt-3">Delivery available Mon–Sat, 7AM–6PM within service area.</p>
      </section>

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
          <ClayButton href="/order" size="lg">Place an Order</ClayButton>
        </div>
      </section>
    </Layout>
  );
}
