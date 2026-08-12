import Layout from '@/components/Layout';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';
import { trackPurchase } from '@/pages/_app';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL } from '@/lib/products';
import { STORE_HOURS_LABEL } from '@/lib/scheduling';
import { readOrderPhone } from '@/lib/client-storage';

const DELIVERY_SLOT_LABELS = {
  pickup: 'Counter pickup',
  am: 'Morning (8AM–12PM)',
  pm: 'Afternoon (1PM–5PM)',
};

const STATUS_LABELS = {
  pending: { label: 'Pending', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  confirmed: { label: 'Confirmed', color: 'text-blue-600 bg-blue-50 border-blue-200' },
  out_for_delivery: { label: 'Out for Delivery', color: 'text-orange-600 bg-orange-50 border-orange-200' },
  delivered: { label: 'Delivered ✓', color: 'text-green-600 bg-green-50 border-green-200' },
  cancelled: { label: 'Cancelled', color: 'text-red-600 bg-red-50 border-red-200' },
};

export default function Confirmation() {
  const router = useRouter();
  const { id, screenshot } = router.query;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const trackedRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    // The phone comes from sessionStorage, written by the order form, so the API
    // returns the full matched-phone payload (address / phone / payment) instead
    // of the minimal one. It must not be a query param: _app.js sends every URL
    // to the Facebook Pixel, so `?phone=` would leak it to Meta unhashed.
    const phone = readOrderPhone();
    const qs = phone ? `?phone=${encodeURIComponent(phone)}` : '';
    fetch(`/api/orders/${encodeURIComponent(id)}${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setOrder(d);
          // Track purchase event once
          if (!trackedRef.current && d.total_amount) {
            trackPurchase(d.total_amount, 'PHP');
            trackedRef.current = true;
          }
        }
        setLoading(false);
      })
      .catch(() => { setError('Could not load order'); setLoading(false); });
  }, [id]);

  const status = order ? STATUS_LABELS[order.status] : null;

  return (
    <Layout title="Order Confirmed — Anchor Drops">
      <section className="max-w-lg mx-auto px-4 pt-14 pb-4 reveal">
        <div className="mb-5 grid place-items-center w-14 h-14 rounded-[18px] clay-raised-sm" style={{ background: 'linear-gradient(145deg,#e9f6ff,#d3ecfb)' }}>
          <ClayIcon name="check" className="w-7 h-7 text-clay-skydeep" />
        </div>
        <span className="section-pill mb-4 inline-block">Order Confirmed</span>
        <h1 className="font-editorial text-4xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Order Placed!
        </h1>
        <p className="text-clay-muted font-semibold mt-3">We received your order and will process it shortly.</p>
      </section>

      <div className="max-w-lg mx-auto px-4 py-10">
        {loading && (
          <p className="text-center text-clay-muted" aria-busy="true">
            <span className="clay-spinner inline-block align-middle mr-2" aria-hidden="true" />
            Loading order details...
          </p>
        )}
        {error && <p className="text-center text-red-500" role="alert">{error}</p>}

        {order && (
          <div className="space-y-4">
            <ClayCard className="p-6 text-center">
              <p className="text-sm text-clay-muted mb-1">Your Order ID</p>
              <p className="text-4xl font-extrabold text-sky-600 tracking-widest">{order.order_number || order.id}</p>
              <p className="text-base font-bold text-clay-ink2 mt-2">⚠ Please write this down or take a screenshot — you&apos;ll need it to track your order.</p>
            </ClayCard>

            <a href={`tel:${BUSINESS_PHONE_TEL}`} className="flex items-center justify-center gap-2 clay-inset rounded-full px-4 py-3 text-base font-semibold text-clay-skydeep">
              <ClayIcon name="phone" className="w-5 h-5" /> Questions? Call us: {BUSINESS_PHONE_DISPLAY}
            </a>

            <a
              href={`https://m.me/${process.env.NEXT_PUBLIC_FB_PAGE_ID || '1210958972092166'}?ref=${order.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-full px-4 py-3 text-base font-bold text-white"
              style={{ background: 'linear-gradient(145deg,#0084ff,#0068d6)' }}
            >
              <ClayIcon name="chat" className="w-5 h-5" /> Get updates & unlock rewards on Messenger
            </a>
            <p className="text-center text-xs text-clay-muted -mt-2">
              Tap to link Messenger — we&apos;ll send order updates and your free-refill reward codes here.
            </p>

            <ClayCard className="p-6">
              <h2 className="font-editorial font-semibold text-clay-ink2 mb-3">Order Details</h2>
              <div className="space-y-2 text-base">
                <div className="flex justify-between">
                  <span className="text-clay-muted">Status</span>
                  <span className={`font-semibold px-2 py-0.5 rounded-full border text-xs ${status?.color}`}>{status?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Name</span>
                  <span className="font-medium">{order.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Phone</span>
                  <span className="font-medium">{order.phone}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Address</span>
                  <span className="font-medium text-right max-w-[60%]">{order.address}, {order.barangay}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Product</span>
                  <span className="font-medium">{order.product_type} ({order.container_size})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Quantity</span>
                  <span className="font-medium">{order.quantity} refill(s)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-clay-muted">Payment</span>
                  <span className="font-medium capitalize">{order.payment_method === 'cod' ? 'Cash on Delivery' : order.payment_method}</span>
                </div>
                {order.payment_verified != null && order.payment_method !== 'cod' && (
                  <div className="flex justify-between">
                    <span className="text-clay-muted">Payment status</span>
                    <span className={`font-semibold px-2 py-0.5 rounded-full border text-xs ${order.payment_verified ? 'text-green-600 bg-green-50 border-green-200' : 'text-yellow-600 bg-yellow-50 border-yellow-200'}`}>
                      {order.payment_verified ? 'Verified ✓' : 'Awaiting verification'}
                    </span>
                  </div>
                )}
                {order.delivery_slot && (
                  <div className="flex justify-between">
                    <span className="text-clay-muted">Delivery Time</span>
                    <span className="font-medium">{DELIVERY_SLOT_LABELS[order.delivery_slot] || order.delivery_slot}{order.delivery_date ? ` · ${order.delivery_date}` : ''}</span>
                  </div>
                )}
                {order.has_empty_containers ? (
                  <div className="flex justify-between">
                    <span className="text-clay-muted">Pickup</span>
                    <span className="font-medium">{order.pickup_date} {order.pickup_time}</span>
                  </div>
                ) : null}
                {order.delivery_time && (
                  <div className="flex justify-between">
                    <span className="text-clay-muted">Delivery</span>
                    <span className="font-medium">{order.delivery_date} {order.delivery_time}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-sky-50 pt-2">
                  <span className="text-gray-700 font-bold">Total</span>
                  <span className="text-sky-600 font-bold">₱{order.total_amount}</span>
                </div>
              </div>
            </ClayCard>

            {order.voucher_discount > 0 && (
              <ClayCard variant="inset" className="p-4 text-center text-sm font-semibold text-clay-skydeep">
                <ClayIcon name="party" className="w-4 h-4 inline mr-1" />
                You saved ₱{order.voucher_discount} with a free-refill reward!
              </ClayCard>
            )}
            {order.reward_requested > 0 && (
              <ClayCard variant="inset" className="p-4 text-center text-sm font-semibold text-clay-ink2">
                <ClayIcon name="info" className="w-4 h-4 inline mr-1" />
                Free refill requested ×{order.reward_requested} — we&apos;ll apply it when we confirm your delivery.
              </ClayCard>
            )}
            <p className="text-center text-xs text-clay-muted">
              Earning free refills with every order — <Link href="/rewards" className="text-clay-skydeep font-semibold hover:underline">check your rewards</Link>.
            </p>

            {screenshot === '0' && (
              <ClayCard variant="inset" className="p-4 text-center text-sm font-semibold text-clay-danger">
                <ClayIcon name="info" className="w-4 h-4 inline mr-1" />
                We couldn&apos;t save your payment screenshot. Please send it to us on Messenger so we can verify your payment.
              </ClayCard>
            )}

            <ClayCard variant="inset" className="p-5 text-center text-sm text-clay-skydeep">
              {order.phone && (
                <><ClayIcon name="phone" className="w-4 h-4 inline mr-1" /> We will call you at <strong>{order.phone}</strong> before delivery.<br /></>
              )}
              {order.delivery_date ? (
                <>Scheduled delivery: <strong>{order.delivery_date}{order.delivery_time ? ` at ${order.delivery_time}` : ''}</strong>.</>
              ) : (
                <>Store hours: <strong>{STORE_HOURS_LABEL}</strong>.</>
              )}
            </ClayCard>

            <div className="flex flex-col gap-3">
              <ClayButton href={`/track?id=${encodeURIComponent(order.order_number || order.id)}`} className="w-full"><ClayIcon name="search" className="w-4 h-4" /> Track My Order</ClayButton>
              <ClayButton href="/order" variant="outline" className="w-full">Place Another Order</ClayButton>
              <Link href="/" className="block text-center text-clay-muted hover:text-clay-ink2 py-2 transition-colors text-sm">Back to Home</Link>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
