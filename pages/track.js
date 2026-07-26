import Layout from '@/components/Layout';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL } from '@/lib/products';

const STEPS = [
  { key: 'pending', label: 'Order Received', icon: 'clipboard', desc: 'Your order is in our queue.' },
  { key: 'confirmed', label: 'Confirmed', icon: 'check', desc: 'We\'ve confirmed your order and are preparing your water.' },
  { key: 'out_for_delivery', label: 'Out for Delivery', icon: 'truck', desc: 'Your water is on its way!' },
  { key: 'delivered', label: 'Delivered', icon: 'party', desc: 'Your order has been delivered. Enjoy!' },
];

const STATUS_ORDER = ['pending', 'confirmed', 'out_for_delivery', 'delivered'];

function StatusStepper({ status }) {
  const currentIndex = STATUS_ORDER.indexOf(status);
  const isCancelled = status === 'cancelled';

  if (isCancelled) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
        <ClayIcon name="cancel" className="w-10 h-10 mx-auto text-red-500" />
        <p className="text-red-700 font-semibold">This order has been cancelled.</p>
        <p className="text-red-400 text-sm mt-1">Please contact us if you have questions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {STEPS.map((step, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        const upcoming = i > currentIndex;
        return (
          <div key={step.key} className="flex gap-4">
            {/* Line + circle */}
            <div className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${done || active ? 'clay-btn-primary text-white' : 'clay-inset text-clay-muted'} ${active ? 'ring-4 ring-sky-100' : ''}`}>
                <ClayIcon name={done ? 'check' : step.icon} className="w-5 h-5" />
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-0.5 flex-1 my-1 ${done ? 'bg-sky-400' : 'bg-gray-200'}`} style={{ minHeight: '2rem' }} />
              )}
            </div>
            {/* Content */}
            <div className={`pb-6 ${i === STEPS.length - 1 ? 'pb-0' : ''}`}>
              <p className={`font-bold ${active ? 'text-clay-skydeep' : done ? 'text-clay-ink2' : 'text-clay-muted'}`}>
                {step.label}
                {active && <span className="ml-2 text-xs bg-sky-100 text-sky-600 px-2 py-0.5 rounded-full">Current</span>}
              </p>
              {!upcoming && (
                <p className={`text-sm mt-0.5 ${active ? 'text-clay-ink2' : 'text-clay-muted'}`}>{step.desc}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Track() {
  const router = useRouter();
  const { id: queryId } = router.query;

  const [inputId, setInputId] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchOrder = useCallback(async (id) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/orders/${id.trim().toUpperCase()}`);
      const data = await res.json();
      if (!res.ok) throw new Error('Order not found. Please check your Order ID.');
      setOrder(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setOrder(null);
    }
    setLoading(false);
  }, []);

  const fetchByPhone = useCallback(async (raw) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/orders/by-phone?phone=${encodeURIComponent(raw.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No recent order found.');
      setOrder(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setOrder(null);
    }
    setLoading(false);
  }, []);

  function handlePhoneSubmit(e) {
    e.preventDefault();
    if (!phoneInput.trim()) return;
    fetchByPhone(phoneInput);
  }

  // Auto-load from URL query
  useEffect(() => {
    if (queryId) {
      queueMicrotask(() => {
        setInputId(queryId);
        fetchOrder(queryId);
      });
    }
  }, [queryId, fetchOrder]);

  // Auto-refresh every 30s when tracking active order
  useEffect(() => {
    if (!order || order.status === 'delivered' || order.status === 'cancelled') return;
    const interval = setInterval(() => fetchOrder(order.id), 30000);
    return () => clearInterval(interval);
  }, [order, fetchOrder]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!inputId.trim()) return;
    router.push(`/track?id=${inputId.trim().toUpperCase()}`, undefined, { shallow: true });
    fetchOrder(inputId.trim());
  }

  return (
    <Layout title="Track Your Order — Anchor Drops">
      <section className="max-w-lg mx-auto px-4 pt-14 pb-4 reveal">
        <span className="section-pill mb-5 inline-block">Order Tracking</span>
        <h1 className="font-editorial text-4xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Track your <span style={{ color: '#0ea5e9' }}>delivery.</span>
        </h1>
        <p className="text-clay-muted font-semibold mt-3 text-base">Enter your Order ID to see your delivery status.</p>
      </section>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">
        {/* Search form */}
        <form onSubmit={handleSubmit} className="clay-raised rounded-3xl p-6">
          <label htmlFor="order_id" className="block text-base font-semibold text-clay-ink2 mb-2">Order ID</label>
          <p className="text-sm text-clay-muted mb-2">This is the code shown when you placed your order and in your Messenger confirmation.</p>
          <div className="flex gap-2">
            <input
              id="order_id"
              value={inputId}
              onChange={(e) => setInputId(e.target.value.toUpperCase())}
              placeholder="e.g. A1B2C3D4"
              className="clay-input flex-1 font-mono uppercase text-lg"
              maxLength={8}
            />
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading || undefined}
              className="clay-btn-primary clay-pressable rounded-full px-5 py-2.5 font-editorial font-semibold disabled:opacity-60"
            >
              {loading ? <span className="clay-spinner" aria-hidden="true" /> : 'Track'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2" role="alert">{error}</p>}
          <a href={`tel:${BUSINESS_PHONE_TEL}`} className="mt-4 flex items-center justify-center gap-2 clay-inset rounded-full px-4 py-2.5 text-sm font-semibold text-clay-skydeep">
            <ClayIcon name="phone" className="w-4 h-4" /> Can&apos;t find your Order ID? Call us: {BUSINESS_PHONE_DISPLAY}
          </a>
        </form>

        {/* Track by phone — for customers who lost their Order ID */}
        <form onSubmit={handlePhoneSubmit} className="clay-inset rounded-3xl p-6">
          <label htmlFor="track_phone" className="block text-base font-semibold text-clay-ink2 mb-2">Lost your Order ID? Track by phone</label>
          <p className="text-sm text-clay-muted mb-2">Enter the phone number you ordered with to see your latest order.</p>
          <div className="flex gap-2">
            <input
              id="track_phone"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="09XX-XXX-XXXX"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              className="clay-input flex-1 text-lg"
            />
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading || undefined}
              className="clay-btn-primary clay-pressable rounded-full px-5 py-2.5 font-editorial font-semibold disabled:opacity-60"
            >
              {loading ? <span className="clay-spinner" aria-hidden="true" /> : 'Track'}
            </button>
          </div>
        </form>

        {/* Order status */}
        {order && (
          <>
            <div className="clay-raised rounded-3xl p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-clay-muted mb-0.5">Order ID</p>
                  <p className="font-mono font-extrabold text-sky-600 text-xl tracking-widest">{order.order_number || order.id}</p>
                </div>
                <button
                  onClick={() => fetchOrder(order.id)}
                  className="text-sky-500 hover:text-sky-700 text-sm font-medium clay-raised-sm rounded-full px-3 py-2"
                >
                  <ClayIcon name="refresh" className="w-4 h-4 inline" /> Refresh
                </button>
              </div>

              <div className="text-sm text-clay-muted mb-5 space-y-1">
                <div><span className="font-medium text-clay-ink2">Name:</span> {order.customer_name}</div>
                {(order.address || order.barangay) && (
                  <div><span className="font-medium text-clay-ink2">{order.address ? 'Address:' : 'Area:'}</span> {[order.address, order.barangay].filter(Boolean).join(', ')}</div>
                )}
                <div><span className="font-medium text-clay-ink2">Total:</span> <span className="text-sky-600 font-bold">₱{order.total_amount}</span></div>
              </div>

              <StatusStepper status={order.status} />

              {lastUpdated && (
                <p className="text-xs text-clay-muted text-right mt-4">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                  {order.status !== 'delivered' && order.status !== 'cancelled' && ' · Auto-refreshes every 30s'}
                </p>
              )}
            </div>

            {(order.status !== 'delivered' && order.status !== 'cancelled') && (
              <div className="clay-inset rounded-3xl p-4 text-clay-skydeep text-sm text-center">
                <ClayIcon name="phone" className="w-4 h-4 inline mr-1" /> Questions about your order? Call us at <strong>{BUSINESS_PHONE_DISPLAY}</strong>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <ClayButton href="/order" className="w-full">Place Another Order</ClayButton>
              <ClayButton href="/" variant="outline" className="w-full">Back to Home</ClayButton>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
