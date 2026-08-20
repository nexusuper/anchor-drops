import Layout from '@/components/Layout';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import LocationPicker from '@/components/order/LocationPicker';
import { maxRedeemable, VOUCHER_VALUE, normalizePhone } from '@/lib/loyalty';
import { PRODUCTS, deliveryFee, BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL } from '@/lib/products';
import {
  classifyPickupTime, computeAllowedDeliveryWindow, validateSchedule, manilaToday,
  PICKUP_MORNING_START, PICKUP_MORNING_END, PICKUP_AFTERNOON_START, PICKUP_AFTERNOON_END,
  DELIVERY_ONLY_START, DELIVERY_ONLY_END, STORE_HOURS_LABEL,
} from '@/lib/scheduling';
import {
  DRAFT_KEY, readStored, readIdentity, writeIdentity, clearIdentity, writeOrderPhone,
} from '@/lib/client-storage';
import { uuidv4 } from '@/lib/uuid';

// Downscales/compresses a photo before storing it as a data URL, so payment
// screenshots (often multi-MB phone photos) stay small enough for a text column.
function fileToCompressedDataUrl(file, maxDim = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const IDENTITY_FIELDS = ['customer_name', 'phone', 'address', 'barangay', 'lat', 'lng'];

const EMPTY_FORM = {
  customer_name: '',
  phone: '',
  address: '',
  barangay: '',
  lat: null,
  lng: null,
  product_type: 'slim5',
  quantity: 1,
  need_container: false,
  container_quantity: 1,
  payment_method: 'cod',
  gcash_number: '',
  reference_number: '',
  payment_screenshot: '',
  notes: '',
  has_empty_containers: true,
  pickup_date: '',
  pickup_time: '',
  delivery_date: '',
  delivery_time: '',
};

export default function Order() {
  const router = useRouter();
  const { product: queryProduct } = router.query;

  const [form, setForm] = useState(EMPTY_FORM);
  const [restoredIdentity, setRestoredIdentity] = useState(false);
  const hydratedRef = useRef(false);
  // One idempotency key per form session, minted on the first submit and reused
  // by every retry. create_order dedupes on p_client_order_id, so a retry after
  // a network timeout returns the same order instead of creating a second one.
  const clientOrderIdRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rewards, setRewards] = useState(null);
  const [rewardCount, setRewardCount] = useState(0);
  const [codePhase, setCodePhase] = useState('idle'); // idle|sending|entry|verifying|verified|fallback
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeReason, setCodeReason] = useState('');
  const [screenshotError, setScreenshotError] = useState('');

  function resetReward() {
    setRewardCount(0);
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  useEffect(() => {
    if (queryProduct) queueMicrotask(() => setForm((f) => ({ ...f, product_type: queryProduct })));
  }, [queryProduct]);

  // Restore on mount (not in a useState initialiser — the page is server-rendered
  // and reading storage during render would break hydration).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = readStored('sessionStorage', DRAFT_KEY);
    // This IS the reorder path now — "order the same again" just means landing on
    // a form already filled from the identity this device saved last time.
    const identity = readIdentity();
    if (!draft && !identity) return;
    queueMicrotask(() => {
      setForm((f) => ({ ...f, ...(identity || {}), ...(draft || {}), payment_screenshot: '' }));
      if (identity?.customer_name) setRestoredIdentity(true);
    });
  }, []);

  // Persist the in-progress draft. payment_screenshot is a multi-hundred-KB data
  // URL and would blow the sessionStorage quota, so it is deliberately excluded.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      const { payment_screenshot, ...rest } = form;
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
    } catch { /* storage full or unavailable — the draft is a nicety */ }
  }, [form]);

  function forgetIdentity() {
    clearIdentity();
    setRestoredIdentity(false);
    setForm(EMPTY_FORM);
  }

  // ponytail: reorder seeds from this device's own saved identity (above), not
  // from a server lookup. It used to be /order?reorder=<phone> hitting
  // /api/orders/by-phone?reorder=1, which returned full name + street address +
  // the exact delivery hour to anyone who typed a phone number — a home address
  // and a when-are-you-home window for a guessable key. Local seeding costs only
  // CROSS-device reorder. To restore that, verify ownership first with the OTP
  // flow that already exists: lib/reward-codes.js, pages/api/rewards/send-code.js
  // and pages/api/rewards/verify-code.js.

  // Look up loyalty rewards when the phone number looks complete.
  useEffect(() => {
    const digits = normalizePhone(form.phone);
    if (digits.length < 7) {
      queueMicrotask(() => {
        setRewards(null);
        resetReward();
      });
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rewards?phone=${encodeURIComponent(digits)}`);
        if (res.ok) setRewards(await res.json());
        else setRewards(null);
      } catch {
        setRewards(null);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form.phone]);

  const selectedProduct = PRODUCTS.find((p) => p.id === form.product_type) || PRODUCTS[0];
  const refillTotal = selectedProduct.refill * form.quantity;
  const containerTotal = form.need_container ? selectedProduct.container * form.container_quantity : 0;
  const delivery = deliveryFee(form.quantity);
  const baseTotal = refillTotal + containerTotal + delivery;
  const maxVouchers = maxRedeemable({
    available: rewards ? rewards.available : 0,
    quantity: form.quantity,
    refillSubtotal: refillTotal,
  });
  const codeApplied = codePhase === 'verified';
  const voucherDiscount = codeApplied ? rewardCount * VOUCHER_VALUE : 0;
  const grandTotal = Math.max(0, baseTotal - voucherDiscount);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  // PH mobile: 11 digits starting 09 (or 12 starting 639 from +63 format)
  const isPhMobile = (raw) => {
    const d = normalizePhone(raw);
    return /^09\d{9}$/.test(d) || /^639\d{9}$/.test(d);
  };
  const phoneInvalid = form.phone.trim().length > 0 && !isPhMobile(form.phone);
  const gcashInvalid = form.payment_method === 'gcash' && form.gcash_number.trim().length > 0 && !isPhMobile(form.gcash_number);

  const today = manilaToday();
  const pickupSlot = classifyPickupTime(form.pickup_time);
  const showAfternoonNotice = form.has_empty_containers && pickupSlot === 'afternoon';
  const allowedDelivery = form.has_empty_containers
    ? computeAllowedDeliveryWindow({ pickupDate: form.pickup_date, pickupTime: form.pickup_time })
    : null;
  const scheduleCheck = validateSchedule({
    hasEmptyContainers: form.has_empty_containers,
    pickupDate: form.pickup_date || null,
    pickupTime: form.pickup_time || null,
    deliveryDate: form.delivery_date,
    deliveryTime: form.delivery_time,
    today,
  });

  // Auto-fill the locked delivery date whenever pickup changes to a valid slot.
  useEffect(() => {
    if (form.has_empty_containers && allowedDelivery && form.delivery_date !== allowedDelivery.date) {
      queueMicrotask(() => setForm((f) => ({ ...f, delivery_date: allowedDelivery.date })));
    }
  }, [form.has_empty_containers, allowedDelivery?.date]);

  // Keep the chosen count within bounds; any bound change cancels a prior verification.
  useEffect(() => {
    queueMicrotask(() => setRewardCount((n) => Math.min(n, maxVouchers)));
  }, [maxVouchers]);

  function changeCount(next) {
    setRewardCount(Math.max(0, Math.min(maxVouchers, next)));
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  async function sendCode() {
    setCodePhase('sending');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      });
      const data = await res.json();
      setCodeReason(data.reason || '');
      setCodePhase(res.ok && data.sent ? 'entry' : 'fallback');
    } catch {
      setCodeReason('');
      setCodePhase('fallback');
    }
  }

  async function verifyCode() {
    setCodePhase('verifying');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code: codeInput }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setCodePhase('verified');
      } else {
        setCodePhase('entry');
        setCodeError('That code is invalid or expired.');
      }
    } catch {
      setCodePhase('entry');
      setCodeError('Could not verify. Please try again.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!isPhMobile(form.phone)) {
      setError('Please enter a valid PH mobile number (09XX-XXX-XXXX).');
      return;
    }
    if (form.payment_method === 'gcash' && form.gcash_number.trim() && !isPhMobile(form.gcash_number)) {
      setError('Please enter a valid GCash mobile number (09XX-XXX-XXXX).');
      return;
    }
    if (!scheduleCheck.ok) {
      setError(scheduleCheck.error);
      return;
    }
    setLoading(true);
    try {
      // Inside the try on purpose: this used to sit above it, and on a browser
      // without crypto.randomUUID it threw uncaught — button stuck loading, no
      // error, order lost. uuidv4() falls back, and the catch is the backstop.
      if (!clientOrderIdRef.current) clientOrderIdRef.current = uuidv4();
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          client_order_id: clientOrderIdRef.current,
          container_size: selectedProduct.size,
          total_amount: baseTotal,
          reward_requested: rewardCount,
          reward_code: codeApplied ? codeInput : null,
          has_empty_containers: form.has_empty_containers,
          pickupDate: form.has_empty_containers ? form.pickup_date : null,
          pickupTime: form.has_empty_containers ? form.pickup_time : null,
          deliveryDate: form.delivery_date,
          deliveryTime: form.delivery_time,
          lat: form.lat,
          lng: form.lng,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place order');
      writeIdentity(Object.fromEntries(IDENTITY_FIELDS.map((k) => [k, form[k]])));
      try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* nicety */ }
      // The phone rides in sessionStorage, never the query string — see the note
      // in lib/client-storage.js. The order id stays in the URL so the
      // confirmation page remains shareable and bookmarkable.
      writeOrderPhone(form.phone);
      const screenshotFlag = form.payment_screenshot && data.screenshot_saved === false ? '&screenshot=0' : '';
      router.push(`/order/confirmation?id=${encodeURIComponent(data.id)}${screenshotFlag}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Layout title="Place an Order — Anchor Drops">
      <section className="max-w-2xl mx-auto px-4 pt-14 pb-4 reveal">
        <span className="section-pill mb-5 inline-block">Place an Order</span>
        <h1 className="font-editorial text-4xl font-bold leading-[1.08] tracking-tight text-clay-ink">
          Place Your <span style={{ color: '#0ea5e9' }}>Order.</span>
        </h1>
        <p className="text-clay-muted font-semibold mt-3 text-base">No account needed — just fill the form below.</p>
        <a href={`tel:${BUSINESS_PHONE_TEL}`} className="mt-4 inline-flex items-center gap-2 clay-raised-sm rounded-full px-4 py-2.5 text-base font-semibold text-clay-skydeep clay-pressable">
          <ClayIcon name="phone" className="w-5 h-5" /> Need help? Call us: {BUSINESS_PHONE_DISPLAY}
        </a>
      </section>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Customer Info */}
          <ClayCard className="p-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-lg font-editorial font-semibold text-clay-ink2">Your Information</h2>
              {restoredIdentity && (
                <button type="button" onClick={forgetIdentity} className="text-xs font-semibold text-clay-skydeep hover:underline">
                  Not you? Clear
                </button>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="customer_name" className="block text-sm font-medium text-clay-ink2 mb-1">Full Name *</label>
                <input id="customer_name" required value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} className="clay-input" placeholder="Juan Dela Cruz" autoComplete="name" />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-clay-ink2 mb-1">Phone Number *</label>
                <input id="phone" required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
                {phoneInvalid && <p className="text-clay-danger text-xs mt-1" role="alert">Please enter a valid PH mobile number (09XX-XXX-XXXX).</p>}
              </div>
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-clay-ink2 mb-1">Street Address *</label>
                <input id="address" required value={form.address} onChange={(e) => set('address', e.target.value)} className="clay-input" placeholder="123 Rizal St." autoComplete="street-address" />
              </div>
              <div>
                <label htmlFor="barangay" className="block text-sm font-medium text-clay-ink2 mb-1">Barangay *</label>
                <input id="barangay" required value={form.barangay} onChange={(e) => set('barangay', e.target.value)} className="clay-input" placeholder="Brgy. San Jose" autoComplete="address-level3" />
              </div>
              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-1">Pin your location on the map (optional)</label>
                <p className="text-xs text-clay-muted mb-2">Helps our driver find you — doesn&apos;t replace the address above.</p>
                <LocationPicker
                  value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                  onChange={(pt) => setForm((f) => ({ ...f, lat: pt?.lat ?? null, lng: pt?.lng ?? null }))}
                />
              </div>
            </div>
          </ClayCard>

          {/* Loyalty reward */}
          {rewards && rewards.available > 0 && (
            <ClayCard variant="inset" className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="grid place-items-center w-11 h-11 rounded-2xl text-white clay-raised-sm" style={{ background: 'linear-gradient(145deg,#38bdf8,#0284c7)' }}>
                  <ClayIcon name="party" className="w-6 h-6" />
                </span>
                <div>
                  <p className="font-editorial font-bold text-clay-ink">You have {rewards.available} free refill{rewards.available > 1 ? 's' : ''}!</p>
                  <p className="text-xs text-clay-muted font-semibold">Each free 5-gallon refill saves you ₱{VOUCHER_VALUE}.</p>
                </div>
              </div>

              {maxVouchers > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-clay-ink2">Free refills to use</span>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => changeCount(rewardCount - 1)} className="w-11 h-11 grid place-items-center rounded-full clay-raised-sm text-xl font-bold text-clay-skydeep clay-pressable" aria-label="Use fewer">−</button>
                      <span className="font-editorial font-bold text-clay-ink w-6 text-center">{rewardCount}</span>
                      <button type="button" onClick={() => changeCount(rewardCount + 1)} className="w-11 h-11 grid place-items-center rounded-full clay-raised-sm text-xl font-bold text-clay-skydeep clay-pressable" aria-label="Use more">+</button>
                    </div>
                  </div>

                  {rewardCount > 0 && (
                    <>
                      {codePhase === 'idle' && (
                        <button type="button" onClick={sendCode} className="w-full clay-btn-primary clay-pressable rounded-full py-2.5 font-editorial font-semibold text-sm">
                          Verify with a Messenger code
                        </button>
                      )}
                      {codePhase === 'sending' && (
                        <p className="text-xs text-clay-muted font-semibold text-center">Sending your code…</p>
                      )}
                      {(codePhase === 'entry' || codePhase === 'verifying') && (
                        <div className="space-y-2">
                          <p className="text-xs text-clay-muted font-semibold">Enter the 6-digit code we sent to your Messenger:</p>
                          <div className="flex gap-2">
                            <input
                              value={codeInput}
                              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              inputMode="numeric"
                              placeholder="123456"
                              className="clay-input flex-1 font-mono tracking-widest"
                            />
                            <button type="button" onClick={verifyCode} disabled={codePhase === 'verifying' || codeInput.length < 6} className="clay-btn-primary clay-pressable rounded-full px-5 font-editorial font-semibold text-sm disabled:opacity-60">
                              {codePhase === 'verifying' ? '…' : 'Apply'}
                            </button>
                          </div>
                          {codeError && <p className="text-clay-danger text-xs" role="alert">{codeError}</p>}
                          <button type="button" onClick={() => setCodePhase('fallback')} className="text-xs text-clay-skydeep font-semibold hover:underline">
                            Didn&apos;t get it? Apply on delivery instead
                          </button>
                        </div>
                      )}
                      {codePhase === 'verified' && (
                        <p className="text-sm font-semibold text-clay-skydeep flex items-center gap-1">
                          <ClayIcon name="check" className="w-4 h-4" /> Code verified — ₱{rewardCount * VOUCHER_VALUE} off applied.
                        </p>
                      )}
                      {codePhase === 'fallback' && (
                        <div className="space-y-1">
                          <p className="text-xs text-clay-muted font-semibold">
                            No problem — we&apos;ll apply your {rewardCount} free refill{rewardCount > 1 ? 's' : ''} when we confirm your delivery.
                          </p>
                          {codeReason === 'not_linked' && (
                            <p className="text-xs text-clay-muted">
                              Tip: link Messenger from your confirmation page after ordering to get reward codes instantly next time.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-clay-muted font-semibold">Add at least ₱{VOUCHER_VALUE} of refills to use a free refill on this order.</p>
              )}
            </ClayCard>
          )}

          {/* Product Selection */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Water Selection</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Product *</label>
                <div className="grid grid-cols-1 gap-2">
                  {PRODUCTS.map((p) => (
                    <label key={p.id} className={`flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.product_type === p.id ? 'clay-tile-selected' : ''}`}>
                      <div className="flex items-center gap-3">
                        <input type="radio" name="product_type" value={p.id} checked={form.product_type === p.id} onChange={() => set('product_type', p.id)} className="accent-clay-sky" />
                        <span className="font-semibold text-clay-ink">{p.name}</span>
                      </div>
                      <span className="font-editorial text-clay-skydeep font-bold">₱{p.refill}/refill</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="quantity" className="block text-sm font-medium text-clay-ink2 mb-1">Quantity (refills) *</label>
                <input id="quantity" type="number" min="1" max="50" required value={form.quantity} onChange={(e) => set('quantity', parseInt(e.target.value) || 1)} className="clay-input" />
              </div>

              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Need a new gallon?</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: false, label: 'No' },
                    { id: true, label: `Yes (+₱${selectedProduct.container} each)` },
                  ].map((opt) => (
                    <label key={String(opt.id)} className={`flex items-center justify-center rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.need_container === opt.id ? 'clay-tile-selected' : ''}`}>
                      <input
                        type="radio"
                        name="need_container"
                        checked={form.need_container === opt.id}
                        onChange={() => setForm((f) => ({ ...f, need_container: opt.id, has_empty_containers: !opt.id, pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '' }))}
                        className="accent-clay-sky mr-2"
                      />
                      <span className="font-semibold text-clay-ink">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.need_container && (
                <div>
                  <label htmlFor="container_quantity" className="block text-sm font-medium text-clay-ink2 mb-1">Number of containers *</label>
                  <input id="container_quantity" type="number" min="1" max="10" value={form.container_quantity} onChange={(e) => set('container_quantity', parseInt(e.target.value) || 1)} className="clay-input" />
                </div>
              )}
            </div>
          </ClayCard>

          {/* Payment */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Payment Method</h2>
            <div className="space-y-2">
              {[
                { id: 'cod', label: 'Cash on Delivery' },
                { id: 'gcash', label: 'GCash / Bank Transfer' },
              ].map((m) => (
                <label key={m.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.payment_method === m.id ? 'clay-tile-selected' : ''}`}>
                  <input type="radio" name="payment_method" value={m.id} checked={form.payment_method === m.id} onChange={() => set('payment_method', m.id)} className="accent-clay-sky" />
                  <span className="font-semibold text-clay-ink">{m.label}</span>
                </label>
              ))}
            </div>

            {(form.payment_method === 'gcash' || form.payment_method === 'bank_transfer') && (
              <div className="mt-4 space-y-3 p-4 clay-inset rounded-xl">
                <p className="text-sm text-clay-ink2">GCash: <strong>{BUSINESS_PHONE_DISPLAY}</strong> (Anchor Drops)</p>
                <p className="text-sm text-clay-ink2">Bank transfer: <strong>BDO 0012-3456-7890</strong> (Anchor Drops Water Refill)</p>
                <div className="flex flex-col items-center gap-2 py-2">
                  <img src="/payment/gcash-qr.jpeg" alt="Anchor Drops GCash / InstaPay QR code" className="w-48 h-auto rounded-2xl clay-raised-sm" />
                  <p className="text-xs text-clay-muted font-semibold">Scan with GCash, or your bank app via InstaPay/QR Ph</p>
                </div>
                <div>
                  <label htmlFor="gcash_number" className="block text-sm font-medium text-clay-ink2 mb-1">Your GCash Number (if paying via GCash)</label>
                  <input id="gcash_number" type="tel" inputMode="tel" autoComplete="tel" value={form.gcash_number} onChange={(e) => set('gcash_number', e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
                  {gcashInvalid && <p className="text-clay-danger text-xs mt-1" role="alert">Please enter a valid PH mobile number (09XX-XXX-XXXX).</p>}
                </div>
                <div>
                  <label htmlFor="reference_number" className="block text-sm font-medium text-clay-ink2 mb-1">Reference Number (after payment)</label>
                  <input id="reference_number" value={form.reference_number} onChange={(e) => set('reference_number', e.target.value)} className="clay-input" placeholder="Optional, fill after sending" />
                </div>
                <div>
                  <label htmlFor="payment_screenshot" className="block text-sm font-medium text-clay-ink2 mb-1">Attach Screenshot of Payment (optional)</label>
                  {!form.payment_screenshot ? (
                    <input
                      id="payment_screenshot"
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setScreenshotError('');
                        if (file.size > 5 * 1024 * 1024) {
                          setScreenshotError('Image is too large. Please choose a photo under 5MB.');
                          e.target.value = '';
                          return;
                        }
                        try {
                          const dataUrl = await fileToCompressedDataUrl(file);
                          set('payment_screenshot', dataUrl);
                        } catch {
                          setScreenshotError('Could not read that image. Please try another.');
                        }
                        e.target.value = '';
                      }}
                      className="clay-input"
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <img src={form.payment_screenshot} alt="Payment screenshot" className="w-16 h-16 object-cover rounded-xl clay-raised-sm" />
                      <button type="button" onClick={() => set('payment_screenshot', '')} className="text-xs font-semibold text-clay-danger hover:underline">
                        Remove
                      </button>
                    </div>
                  )}
                  {screenshotError && <p className="text-clay-danger text-xs mt-1" role="alert">{screenshotError}</p>}
                </div>
              </div>
            )}
          </ClayCard>

          {/* Pickup & Delivery Scheduling */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Pickup &amp; Delivery</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Do you have empty containers at home for us to pick up? *</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: true, label: 'Yes, pick them up' },
                    { id: false, label: 'No, deliver only' },
                  ].filter((opt) => opt.id === !form.need_container).map((opt) => (
                    <label key={String(opt.id)} className={`flex items-center justify-center rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.has_empty_containers === opt.id ? 'clay-tile-selected' : ''}`}>
                      <input
                        type="radio"
                        name="has_empty_containers"
                        checked={form.has_empty_containers === opt.id}
                        onChange={() => setForm((f) => ({ ...f, has_empty_containers: opt.id, pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '' }))}
                        className="accent-clay-sky mr-2"
                      />
                      <span className="font-semibold text-clay-ink">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.has_empty_containers ? (
                <>
                  <div>
                    <label htmlFor="pickup_date" className="block text-sm font-medium text-clay-ink2 mb-1">Pickup date *</label>
                    <input id="pickup_date" required type="date" min={today} value={form.pickup_date} onChange={(e) => set('pickup_date', e.target.value)} className="clay-input" />
                    <p className="text-xs text-clay-muted mt-1">Closed Sundays.</p>
                  </div>
                  <div>
                    <label htmlFor="pickup_time" className="block text-sm font-medium text-clay-ink2 mb-1">Pickup time *</label>
                    <input
                      id="pickup_time"
                      required
                      type="time"
                      min={PICKUP_MORNING_START}
                      max={PICKUP_AFTERNOON_END}
                      value={form.pickup_time}
                      onChange={(e) => set('pickup_time', e.target.value)}
                      className="clay-input"
                    />
                    <p className="text-xs text-clay-muted mt-1">Store hours: {STORE_HOURS_LABEL}.</p>
                    {form.pickup_time && !pickupSlot && (
                      <p className="text-clay-danger text-xs mt-1" role="alert">Please choose a time in the morning or afternoon window above.</p>
                    )}
                  </div>

                  {showAfternoonNotice && (
                    <div className="clay-inset rounded-xl p-3 text-sm text-clay-ink2" role="status">
                      We will try to pick up in the afternoon but delivery will be tomorrow.
                    </div>
                  )}

                  {allowedDelivery && (
                    <>
                      <div>
                        <label htmlFor="delivery_date_locked" className="block text-sm font-medium text-clay-ink2 mb-1">Delivery date</label>
                        <input id="delivery_date_locked" type="date" value={allowedDelivery.date} readOnly disabled className="clay-input opacity-70" />
                      </div>
                      <div>
                        <label htmlFor="delivery_time" className="block text-sm font-medium text-clay-ink2 mb-1">Delivery time *</label>
                        <input
                          id="delivery_time"
                          required
                          type="time"
                          min={allowedDelivery.minTime}
                          max={allowedDelivery.maxTime}
                          value={form.delivery_time}
                          onChange={(e) => set('delivery_time', e.target.value)}
                          className="clay-input"
                        />
                        <p className="text-xs text-clay-muted mt-1">
                          {pickupSlot === 'morning' ? `Allowed: ${allowedDelivery.minTime}–${allowedDelivery.maxTime}.` : `Store hours: ${STORE_HOURS_LABEL}.`}
                        </p>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="delivery_date" className="block text-sm font-medium text-clay-ink2 mb-1">Delivery date *</label>
                    <input id="delivery_date" required type="date" min={today} value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} className="clay-input" />
                    <p className="text-xs text-clay-muted mt-1">Closed Sundays.</p>
                  </div>
                  <div>
                    <label htmlFor="delivery_time_only" className="block text-sm font-medium text-clay-ink2 mb-1">Delivery time *</label>
                    <input id="delivery_time_only" required type="time" min={DELIVERY_ONLY_START} max={DELIVERY_ONLY_END} value={form.delivery_time} onChange={(e) => set('delivery_time', e.target.value)} className="clay-input" />
                    <p className="text-xs text-clay-muted mt-1">Store hours: {STORE_HOURS_LABEL}.</p>
                  </div>
                </>
              )}

              {!scheduleCheck.ok && (form.delivery_time || form.pickup_time) && (
                <p className="text-clay-danger text-xs" role="alert">{scheduleCheck.error}</p>
              )}
            </div>
          </ClayCard>

          {/* Notes */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Additional Notes</h2>
            <label htmlFor="order_notes" className="sr-only">Additional notes</label>
            <textarea id="order_notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="clay-input" placeholder="Delivery instructions, landmarks, etc." />
          </ClayCard>

          {/* Order Summary */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-clay-muted">{selectedProduct.name} x{form.quantity}</span>
                <span className="font-medium">₱{refillTotal}</span>
              </div>
              {form.need_container && form.container_quantity > 0 && (
                <div className="flex justify-between">
                  <span className="text-clay-muted">Container x{form.container_quantity}</span>
                  <span className="font-medium">₱{containerTotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-clay-muted">🚚 Delivery Fee <span className="text-xs">(within service area)</span></span>
                <span className="font-medium">{delivery === 0 ? 'FREE' : `₱${delivery}`}</span>
              </div>
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-clay-skydeep font-semibold">
                  <span>Free refill reward ×{rewardCount}</span>
                  <span>−₱{voucherDiscount}</span>
                </div>
              )}
              {!codeApplied && codePhase === 'fallback' && rewardCount > 0 && (
                <div className="flex justify-between text-clay-muted">
                  <span>Free refill requested ×{rewardCount}</span>
                  <span>on delivery</span>
                </div>
              )}
              <div className="border-t border-sky-200 pt-2 mt-2 flex justify-between font-bold text-base">
                <span className="text-clay-ink">Total</span>
                <span className="text-clay-skydeep">₱{grandTotal}</span>
              </div>
            </div>
          </ClayCard>

          {error && (
            <div className="bg-clay-danger-bg border border-red-200 text-clay-danger rounded-xl px-4 py-3 text-sm" role="alert">{error}</div>
          )}

          <p className="text-center text-sm font-semibold text-clay-skydeep">💧 Free refill after 10 gallons — earned automatically on every order.</p>

          <button type="submit" disabled={loading} aria-busy={loading || undefined} className="w-full inline-flex items-center justify-center gap-2 clay-btn-primary clay-pressable rounded-full py-4 text-lg font-editorial font-semibold disabled:opacity-60">
            {loading ? (
              <>
                <span className="clay-spinner" aria-hidden="true" />
                Placing Order…
              </>
            ) : (
              'Place Order →'
            )}
          </button>
        </form>
      </div>
    </Layout>
  );
}
