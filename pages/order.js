import Layout from '@/components/Layout';
import { MIN_DELIVERY_QTY, DELIVERY_MIN_MESSAGE, normalizePhonePH } from '@/lib/order-guard';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import LocationPicker from '@/components/order/LocationPicker';
import { maxRedeemable, VOUCHER_VALUE, normalizePhone } from '@/lib/loyalty';
import { BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_TEL, GCASH_NUMBER_DISPLAY, STORE_ADDRESS_DISPLAY } from '@/lib/products';
import { productUnit, useStorefrontCatalog } from '@/lib/storefront-catalog';
import {
  computeAutomaticDelivery, validateSchedule, manilaToday, manilaNowTime,
  timeSlots, STORE_HOURS_LABEL, addDays,
} from '@/lib/scheduling';

// '13:30' -> '1:30 PM'
function formatSlot(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// Dropdown of bookable slots only — native time pickers on mobile ignore min/max,
// which let customers pick lunch-break or after-hours times.
function TimeSelect({ id, value, onChange, date, today, nowTime, minTime, maxTime }) {
  const slots = timeSlots({ minTime, maxTime, date, today, nowTime });
  return (
    <>
      <select id={id} required value={value} onChange={(e) => onChange(e.target.value)} className="clay-input">
        <option value="" disabled>Select a time</option>
        {slots.map((t) => <option key={t} value={t}>{formatSlot(t)}</option>)}
      </select>
      {date && slots.length === 0 && (
        <p className="text-clay-danger text-xs mt-1" role="alert">No times left on this date — please choose another day.</p>
      )}
    </>
  );
}
function DateChoice({ id, value, onChange, today, label }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-clay-ink2 mb-2">{label} *</label>
      <div className="flex gap-2 mb-2">
        {[['Today', today], ['Tomorrow', addDays(today, 1)]].map(([text, date]) => (
          <button key={date} type="button" onClick={() => onChange(date)} aria-pressed={value === date} className={`rounded-full px-4 py-2 text-sm font-semibold clay-tile ${value === date ? 'clay-tile-selected' : ''}`}>{text}</button>
        ))}
      </div>
      <input id={id} required type="date" min={today} value={value} onChange={(e) => onChange(e.target.value)} className="clay-input" />
    </div>
  );
}
import {
  DRAFT_KEY, readStored, readIdentity, readLastOrder, writeIdentity, clearIdentity, writeOrderPhone,
} from '@/lib/client-storage';
import { uuidv4 } from '@/lib/uuid';
import { CDO_BARANGAYS, matchBarangay } from '@/lib/service-area';

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
  product_type: 'round5_pickup',
  fulfillment: 'pickup',
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
  const siteStatus = useStorefrontCatalog();

  // Hooks below must run every render, so the opening-soon gate lives in a
  // separate component rather than an early return in this one.
  if (siteStatus && siteStatus.enabled === false) {
    return (
      <Layout title="Opening Soon — Anchor Drops">
        <section className="max-w-2xl mx-auto px-4 py-24 text-center reveal">
          <span className="section-pill mb-5 inline-block">Opening Soon</span>
          <h1 className="font-editorial text-4xl font-bold leading-[1.08] tracking-tight text-clay-ink">
            Online Ordering <span style={{ color: '#0ea5e9' }}>Opening Soon.</span>
          </h1>
          <p className="text-clay-muted font-semibold mt-3 text-base">
            We&apos;re not open for orders yet — check back soon.
          </p>
          <a href={`tel:${BUSINESS_PHONE_TEL}`} className="mt-6 inline-flex items-center gap-2 clay-raised-sm rounded-full px-4 py-2.5 text-base font-semibold text-clay-skydeep clay-pressable">
            <ClayIcon name="phone" className="w-5 h-5" /> Call us: {BUSINESS_PHONE_DISPLAY}
          </a>
        </section>
      </Layout>
    );
  }

  const availableProducts = siteStatus?.products?.filter((p) => p.kind !== 'info');
  if (!router.isReady || !availableProducts?.length) {
    return (
      <Layout title="Place an Order — Anchor Drops">
        <section className="max-w-2xl mx-auto px-4 py-16" role="status">
          {!siteStatus ? 'Loading current prices…' : 'Online ordering is temporarily unavailable.'}
        </section>
      </Layout>
    );
  }
  const queryProduct = availableProducts.find((p) => p.id === router.query.product)?.id;
  return <OrderForm key={queryProduct} queryProduct={queryProduct} availableProducts={availableProducts} />;
}

function OrderForm({ queryProduct, availableProducts }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...EMPTY_FORM, product_type: queryProduct || EMPTY_FORM.product_type });
  const [restoredIdentity, setRestoredIdentity] = useState(false);
  const [showIdentity, setShowIdentity] = useState(true);
  const [showOptionalMap, setShowOptionalMap] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [fieldTouched, setFieldTouched] = useState({});
  const [submitted, setSubmitted] = useState(false);
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
  const [quoteResult, setQuoteResult] = useState(null);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const rewardRequestVersion = useRef(0);

  function resetReward() {
    setRewardCount(0);
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  // Restore on mount (not in a useState initialiser — the page is server-rendered
  // and reading storage during render would break hydration).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const draft = readStored('sessionStorage', DRAFT_KEY);
    // This IS the reorder path now — "order the same again" just means landing on
    // a form already filled from the identity this device saved last time.
    const identity = readIdentity();
    const reorder = router.query.reorder === '1' ? readLastOrder() : null;
    if (!draft && !identity && !reorder) return;
    queueMicrotask(() => {
      setForm((f) => ({
        ...f,
        ...identity,
        ...(reorder || draft),
        ...(reorder && { pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '', payment_method: 'cod' }),
        ...(queryProduct && draft?.product_type !== queryProduct && {
          product_type: queryProduct,
          fulfillment: 'pickup',
          pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '',
        }),
        payment_screenshot: '',
      }));
      if (identity?.customer_name) {
        setRestoredIdentity(true);
        setShowIdentity(false);
      }
    });
  }, [queryProduct, router.query.reorder]);

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
    rewardRequestVersion.current += 1;
    setRestoredIdentity(false);
    setShowIdentity(true);
    setRewards(null);
    resetReward();
    setForm((f) => ({ ...EMPTY_FORM, product_type: f.product_type, fulfillment: f.fulfillment, quantity: f.quantity }));
  }

  // ponytail: reorder seeds from this device's own saved identity (above), not
  // from a server lookup. It used to be /order?reorder=<phone> hitting
  // /api/orders/by-phone?reorder=1, which returned full name + street address +
  // the exact delivery hour to anyone who typed a phone number — a home address
  // and a when-are-you-home window for a guessable key. Local seeding costs only
  // CROSS-device reorder. To restore that, verify ownership first with the OTP
  // flow that already exists: lib/reward-codes.js, pages/api/rewards/send-code.js
  // and pages/api/rewards/verify-code.js.

  const selectedProduct = availableProducts.find((p) => p.id === form.product_type) || availableProducts[0];
  const isRefill = selectedProduct.kind === 'refill';
  const isBottle = selectedProduct.kind === 'bottle';
  const unit = productUnit(selectedProduct);
  const fulfillment = isBottle ? form.fulfillment : selectedProduct.fulfillment;
  const storePickup = fulfillment === 'pickup';
  const savedIdentityReady = restoredIdentity && (storePickup || (form.address && form.barangay && (!isBottle || (form.lat != null && form.lng != null))));
  const minQty = storePickup || !isRefill ? 1 : MIN_DELIVERY_QTY;
  const needContainer = isRefill && form.need_container;
  const hasEmptyContainers = isRefill && !storePickup && !needContainer && form.has_empty_containers;
  const quoteKey = JSON.stringify({
    lines: [{
      sku: selectedProduct.id,
      quantity: form.quantity,
      container_quantity: needContainer ? form.container_quantity : 0,
    }],
    fulfillment,
    lat: storePickup ? null : form.lat,
    lng: storePickup ? null : form.lng,
  });
  const canQuote = form.quantity >= minQty && (!isBottle || storePickup || (form.lat != null && form.lng != null));
  const currentQuote = quoteResult?.key === quoteKey ? quoteResult : null;
  const quote = currentQuote?.quote;
  const deliveryFeePending = quote?.delivery_fee_pending === true;
  const paymentMethod = deliveryFeePending ? 'cod' : form.payment_method;
  const voucherValue = Number(quote?.voucher_value ?? VOUCHER_VALUE);

  useEffect(() => {
    if (!canQuote) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/order-quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: quoteKey,
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(data.error || 'Could not get a price.');
        setQuoteResult({ key: quoteKey, quote: data });
      } catch (err) {
        if (!controller.signal.aborted) setQuoteResult({ key: quoteKey, error: err.message });
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [canQuote, quoteKey, quoteAttempt]);

  // Look up loyalty rewards when the phone number looks complete.
  useEffect(() => {
    const digits = normalizePhone(form.phone);
    if (!isRefill || digits.length < 7) {
      queueMicrotask(() => {
        setRewards(null);
        resetReward();
      });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setRewards(null);
        resetReward();
      }
    });
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rewards?phone=${encodeURIComponent(digits)}`, { signal: controller.signal });
        const data = await res.json();
        if (!controller.signal.aborted) setRewards(res.ok ? data : null);
      } catch {
        if (!controller.signal.aborted) setRewards(null);
      }
    }, 500);
    return () => { clearTimeout(t); controller.abort(); };
  }, [form.phone, isRefill]);

  const quotedProduct = quote?.lines[0];
  const refillTotal = Number(((quotedProduct?.refill_price ?? selectedProduct.refill) * form.quantity).toFixed(2));
  const containerTotal = needContainer
    ? Number(((quotedProduct?.container_price ?? selectedProduct.container) * form.container_quantity).toFixed(2))
    : 0;
  const baseTotal = quote ? Number((Number(quote.subtotal) + Number(quote.delivery_fee)).toFixed(2)) : null;
  const maxVouchers = maxRedeemable({
    available: isRefill && rewards ? rewards.available : 0,
    quantity: form.quantity,
    refillSubtotal: refillTotal,
  });
  const loyaltyProgress = (Number(rewards?.deliveredGallons) || 0) % 10;
  const codeApplied = isRefill && codePhase === 'verified';
  const rewardSelection = JSON.stringify([form.phone, rewardCount, codeApplied ? codeInput : null]);
  const revisedReward = currentQuote?.rewardSelection === rewardSelection ? currentQuote.revisedReward : null;
  // A voucher buys a refill, it never pays out the difference: on a ₱25 pickup
  // refill the discount is ₱25, not the ₱30 face value.
  const appliedRewards = revisedReward?.voucher_count ?? (codeApplied ? rewardCount : 0);
  const voucherDiscount = revisedReward?.voucher_discount ?? Math.min(appliedRewards * voucherValue, refillTotal);
  const grandTotal = baseTotal == null ? null : Number(Math.max(0, baseTotal - voucherDiscount).toFixed(2));

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  // PH mobile: 11 digits starting 09 (or 12 starting 639 from +63 format)
  const isPhMobile = (raw) => {
    const d = normalizePhone(raw);
    return /^09\d{9}$/.test(d) || /^639\d{9}$/.test(d);
  };
  const phoneInvalid = (fieldTouched.phone || submitted) && form.phone.trim().length > 0 && !isPhMobile(form.phone);
  const barangayInvalid = (fieldTouched.barangay || submitted) && form.barangay.trim().length > 0 && !matchBarangay(form.barangay);
  const gcashInvalid = form.payment_method === 'gcash' && (fieldTouched.gcash_number || submitted) && form.gcash_number.trim().length > 0 && !isPhMobile(form.gcash_number);

  const today = manilaToday();
  const nowTime = manilaNowTime();
  const automaticDelivery = hasEmptyContainers
    ? computeAutomaticDelivery({ pickupDate: form.pickup_date, pickupTime: form.pickup_time })
    : null;
  const deliveryDate = automaticDelivery?.deliveryDate || form.delivery_date;
  const deliveryTime = automaticDelivery?.deliveryTime || form.delivery_time;
  const scheduleCheck = validateSchedule({
    hasEmptyContainers,
    pickupDate: form.pickup_date || null,
    pickupTime: form.pickup_time || null,
    deliveryDate,
    deliveryTime,
    today,
    nowTime,
  });

  function selectFulfillment(product, mode) {
    rewardRequestVersion.current += 1;
    resetReward();
    setError('');
    setForm((f) => ({
      ...f,
      product_type: product.id,
      fulfillment: mode,
      need_container: false,
      has_empty_containers: product.kind === 'refill' && mode === 'delivery',
      pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '',
    }));
  }

  // Delivery has a minimum refill count (lib/order-guard.js); lift the count to
  // it on load and when switching from a store-pickup product.
  useEffect(() => {
    if (form.quantity < minQty) queueMicrotask(() => setForm((f) => ({ ...f, quantity: Math.max(f.quantity, minQty) })));
  }, [form.quantity, minQty]);

  // Keep the chosen count within bounds; any bound change cancels a prior verification.
  useEffect(() => {
    queueMicrotask(() => setRewardCount((n) => Math.min(n, maxVouchers)));
  }, [maxVouchers]);

  function changeCount(next) {
    rewardRequestVersion.current += 1;
    setRewardCount(Math.max(0, Math.min(maxVouchers, next)));
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  async function sendCode() {
    const requestVersion = rewardRequestVersion.current;
    setCodePhase('sending');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      });
      const data = await res.json();
      if (requestVersion !== rewardRequestVersion.current) return;
      setCodeReason(data.reason || '');
      setCodePhase(res.ok && data.sent ? 'entry' : 'fallback');
    } catch {
      if (requestVersion !== rewardRequestVersion.current) return;
      setCodeReason('');
      setCodePhase('fallback');
    }
  }

  async function verifyCode() {
    const requestVersion = rewardRequestVersion.current;
    setCodePhase('verifying');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code: codeInput }),
      });
      const data = await res.json();
      if (requestVersion !== rewardRequestVersion.current) return;
      if (res.ok && data.valid) {
        setCodePhase('verified');
      } else {
        setCodePhase('entry');
        setCodeError('That code is invalid or expired.');
      }
    } catch {
      if (requestVersion !== rewardRequestVersion.current) return;
      setCodePhase('entry');
      setCodeError('Could not verify. Please try again.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitted(true);
    setError('');
    const focus = (id) => setTimeout(() => document.getElementById(id)?.focus(), 0);
    if (!isPhMobile(form.phone)) {
      setShowIdentity(true);
      setError('Please enter a valid PH mobile number (09XX-XXX-XXXX).');
      focus('phone');
      return;
    }
    if (form.quantity < minQty) {
      setError(DELIVERY_MIN_MESSAGE);
      return;
    }
    if (!storePickup && !matchBarangay(form.barangay)) {
      setShowIdentity(true);
      setError('We deliver within Cagayan de Oro only. Please pick your barangay from the list.');
      focus('barangay');
      return;
    }
    if (paymentMethod === 'gcash' && form.gcash_number.trim() && !isPhMobile(form.gcash_number)) {
      setError('Please enter a valid GCash mobile number (09XX-XXX-XXXX).');
      focus('gcash_number');
      return;
    }
    if (!scheduleCheck.ok) {
      setError(scheduleCheck.error);
      focus(hasEmptyContainers ? 'pickup_date' : 'delivery_date');
      return;
    }
    if (!quote) {
      setError(currentQuote?.error || 'Get a current price before placing your order.');
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
          payment_method: paymentMethod,
          ...(deliveryFeePending && { gcash_number: '', reference_number: '', payment_screenshot: '' }),
          product_type: selectedProduct.id,
          fulfillment,
          // The server stamps the store's address for a pickup; sending a
          // half-filled one would only be stored and never used.
          address: storePickup ? null : form.address,
          barangay: storePickup ? null : form.barangay,
          lat: storePickup ? null : form.lat,
          lng: storePickup ? null : form.lng,
          client_order_id: clientOrderIdRef.current,
          container_size: selectedProduct.size,
          total_amount: baseTotal,
          expected_final_total: grandTotal,
          expected_delivery_fee_pending: deliveryFeePending,
          delivery_fee: Number(quote.delivery_fee),
          need_container: needContainer,
          container_quantity: needContainer ? form.container_quantity : 0,
          reward_requested: isRefill ? rewardCount : 0,
          reward_code: codeApplied && !revisedReward?.requires_manual_approval ? codeInput : null,
          has_empty_containers: hasEmptyContainers,
          pickupDate: hasEmptyContainers ? form.pickup_date : null,
          pickupTime: hasEmptyContainers ? form.pickup_time : null,
          deliveryDate,
          deliveryTime,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.quote) setQuoteResult({
        key: quoteKey,
        quote: data.quote,
        changed: true,
        rewardSelection,
        revisedReward: data.revised_reward,
      });
      if (res.status === 400 && data.quoteUnavailable) setQuoteResult({ key: quoteKey, error: data.error });
      if (!res.ok) throw new Error(data.error || 'Failed to place order');
      writeIdentity(Object.fromEntries(IDENTITY_FIELDS.map((k) => [k, form[k]])), {
        product_type: selectedProduct.id, quantity: form.quantity, fulfillment,
      });
      try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* nicety */ }
      // The phone rides in sessionStorage, never the query string — see the note
      // in lib/client-storage.js. The order id stays in the URL so the
      // confirmation page remains shareable and bookmarkable.
      writeOrderPhone(form.phone);
      const screenshotFlag = !deliveryFeePending && form.payment_screenshot && data.screenshot_saved === false ? '&screenshot=0' : '';
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

      <div className="max-w-2xl mx-auto px-4 pt-8 pb-28 md:py-10">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Product Selection */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Water Selection</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Product *</label>
                <div className="grid grid-cols-1 gap-2">
                  {availableProducts.map((p) => (
                    <label key={p.id} className={`flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer clay-tile ${selectedProduct.id === p.id ? 'clay-tile-selected' : ''}`}>
                      <div className="flex items-center gap-3">
                        <input type="radio" name="product_type" value={p.id} checked={selectedProduct.id === p.id} onChange={() => selectFulfillment(p, p.kind === 'bottle' ? 'pickup' : p.fulfillment)} className="accent-clay-sky" />
                        <span className="font-semibold text-clay-ink">{p.name}</span>
                      </div>
                      <span className="font-editorial text-clay-skydeep font-bold">₱{selectedProduct.id === p.id ? quotedProduct?.refill_price ?? p.refill : p.refill}/{productUnit(p)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {isBottle && (
                <fieldset>
                  <legend className="block text-sm font-medium text-clay-ink2 mb-2">How would you like to get your water?</legend>
                  <div className="grid grid-cols-2 gap-3">
                    {[['pickup', 'Store pickup'], ['delivery', 'Delivery']].map(([mode, label]) => (
                      <label key={mode} className="flex items-center gap-2 rounded-2xl px-4 py-3 cursor-pointer clay-tile">
                        <input type="radio" name="fulfillment" value={mode} checked={fulfillment === mode} onChange={() => selectFulfillment(selectedProduct, mode)} className="accent-clay-sky" />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}

              <div>
                <label htmlFor="quantity" className="block text-sm font-medium text-clay-ink2 mb-1">Quantity ({unit}s) *</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => set('quantity', Math.max(minQty, form.quantity - 1))} disabled={form.quantity <= minQty} className="w-11 h-11 shrink-0 grid place-items-center rounded-full clay-raised-sm text-xl font-bold text-clay-skydeep clay-pressable disabled:opacity-40" aria-label={`Fewer ${unit}s`}>−</button>
                  <input id="quantity" type="number" min={minQty} max="50" required value={form.quantity} onChange={(e) => set('quantity', Math.min(50, Math.max(minQty, parseInt(e.target.value) || minQty)))} className="clay-input text-center" />
                  <button type="button" onClick={() => set('quantity', Math.min(50, form.quantity + 1))} disabled={form.quantity >= 50} className="w-11 h-11 shrink-0 grid place-items-center rounded-full clay-raised-sm text-xl font-bold text-clay-skydeep clay-pressable disabled:opacity-40" aria-label={`More ${unit}s`}>+</button>
                </div>
                {isRefill && !storePickup && <p className="text-xs text-clay-muted font-semibold mt-1">{DELIVERY_MIN_MESSAGE}</p>}
              </div>

              {isRefill && <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Need a new round container?</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: false, label: 'No' },
                    { id: true, label: `Yes (+₱${quotedProduct?.container_price ?? selectedProduct.container} each)` },
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
              </div>}

              {needContainer && (
                <div>
                  <label htmlFor="container_quantity" className="block text-sm font-medium text-clay-ink2 mb-1">Number of containers *</label>
                  <input id="container_quantity" type="number" min="1" max="10" value={form.container_quantity} onChange={(e) => set('container_quantity', parseInt(e.target.value) || 1)} className="clay-input" />
                </div>
              )}
            </div>
          </ClayCard>

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
            {savedIdentityReady && !showIdentity && <div className="clay-inset rounded-xl p-4 text-sm flex items-center justify-between gap-3">
              <div><p className="font-semibold">{form.customer_name} · {form.phone}</p><p className="text-clay-muted">{storePickup ? 'Store pickup' : `${form.address}, ${form.barangay}`}</p></div>
              <button type="button" onClick={() => setShowIdentity(true)} className="text-clay-skydeep font-semibold shrink-0">Edit</button>
            </div>}
            {(!savedIdentityReady || showIdentity) && <div className="space-y-4">
              <div>
                <label htmlFor="customer_name" className="block text-sm font-medium text-clay-ink2 mb-1">Full Name *</label>
                <input id="customer_name" required value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} className="clay-input" placeholder="Juan Dela Cruz" autoComplete="name" />
              </div>
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-clay-ink2 mb-1">Phone Number *</label>
                <input id="phone" required type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onBlur={() => setFieldTouched((f) => ({ ...f, phone: true }))} onChange={(e) => {
                  const phone = e.target.value;
                  if (restoredIdentity && normalizePhonePH(phone) !== normalizePhonePH(form.phone)) {
                    clearIdentity();
                    setForm((f) => ({ ...f, phone, customer_name: '', address: '', barangay: '', lat: null, lng: null }));
                    setRestoredIdentity(false);
                  } else set('phone', phone);
                  rewardRequestVersion.current += 1;
                  setRewards(null);
                  resetReward();
                }} className="clay-input" placeholder="09XX-XXX-XXXX" />
                {phoneInvalid && <p className="text-clay-danger text-xs mt-1" role="alert">Please enter a valid PH mobile number (09XX-XXX-XXXX).</p>}
              </div>
              {storePickup ? (
                <div className="clay-inset rounded-xl p-4 text-sm text-clay-ink2" role="status">
                  <p className="font-semibold mb-1">You&apos;re picking this up at the store.</p>
                  <p className="text-clay-muted font-semibold">{STORE_ADDRESS_DISPLAY}</p>
                  <p className="text-clay-muted mt-1">No delivery address needed.</p>
                </div>
              ) : (
              <>
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-clay-ink2 mb-1">Street Address *</label>
                <input id="address" required value={form.address} onChange={(e) => set('address', e.target.value)} className="clay-input" placeholder="123 Rizal St." autoComplete="street-address" />
              </div>
              <div>
                <label htmlFor="barangay" className="block text-sm font-medium text-clay-ink2 mb-1">Barangay *</label>
                {/* ponytail: native datalist, not a combobox component — it
                    autocompletes the real barangay names so most customers never
                    hit the server-side rejection below. */}
                <input id="barangay" required list="cdo-barangays" value={form.barangay} onBlur={() => setFieldTouched((f) => ({ ...f, barangay: true }))} onChange={(e) => set('barangay', e.target.value)} className="clay-input" placeholder="Brgy. San Jose" autoComplete="address-level3" />
                <datalist id="cdo-barangays">
                  {CDO_BARANGAYS.map((b) => <option key={b} value={b} />)}
                </datalist>
                {barangayInvalid && <p className="text-clay-danger text-xs mt-1" role="alert">We deliver within Cagayan de Oro only. Pick your barangay from the list.</p>}
              </div>
              {(isBottle || showOptionalMap) && <div>
                <p className="block text-sm font-medium text-clay-ink2 mb-1">
                  {isBottle ? 'Pin your delivery location (required)' : 'Pin your location on the map (optional)'}
                </p>
                <p className="text-xs text-clay-muted mb-2">
                  {isBottle ? 'Pin an address in Cagayan de Oro to check delivery.' : 'Helps our driver find your delivery address.'}
                </p>
                <LocationPicker
                  value={form.lat != null && form.lng != null ? { lat: form.lat, lng: form.lng } : null}
                  onChange={(pt) => setForm((f) => ({ ...f, lat: pt?.lat ?? null, lng: pt?.lng ?? null }))}
                />
              </div>}
              {!isBottle && <button type="button" onClick={() => setShowOptionalMap((shown) => !shown)} className="text-sm text-clay-skydeep font-semibold">{showOptionalMap ? 'Hide map' : 'Add delivery pin (optional)'}</button>}
              </>
              )}
            </div>}
          </ClayCard>

          {/* Scheduling */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">
              {storePickup ? 'When are you coming to the store?' : isRefill ? 'Container Pickup & Delivery' : 'Delivery Schedule'}
            </h2>
            <div className="space-y-4">
              {isRefill && !storePickup && <p className="text-sm text-clay-muted">{form.need_container ? 'New containers will be delivered.' : 'We will collect your empty gallons, refill them, and deliver them back.'}</p>}
              {hasEmptyContainers ? (
                <>
                  <DateChoice id="pickup_date" label="Empty-gallon pickup date" value={form.pickup_date} onChange={(date) => setForm((f) => ({ ...f, pickup_date: date, pickup_time: '' }))} today={today} />
                  <div>
                    <label htmlFor="pickup_time" className="block text-sm font-medium text-clay-ink2 mb-1">Empty-gallon pickup time *</label>
                    <TimeSelect id="pickup_time" value={form.pickup_time} onChange={(time) => set('pickup_time', time)} date={form.pickup_date} today={today} nowTime={nowTime} />
                  </div>
                  {automaticDelivery && <div className="clay-inset rounded-xl p-4 text-sm" role="status">
                    <p className="font-semibold">Delivery: {automaticDelivery.isNextDay ? 'next day' : 'same day'} at {formatSlot(automaticDelivery.deliveryTime)}</p>
                    <p className="text-clay-muted mt-1">{automaticDelivery.isNextDay ? 'Late pickup: no 1–2 hour slot fits before 5 PM. Your refill will arrive next day from 8 AM.' : 'Scheduled 1–2 hours after your empty gallons are picked up.'}</p>
                  </div>}
                </>
              ) : (
                <>
                  <DateChoice id="delivery_date" label={storePickup ? 'Store pickup date' : 'Delivery date'} value={form.delivery_date} onChange={(date) => setForm((f) => ({ ...f, delivery_date: date, delivery_time: '' }))} today={today} />
                  <div>
                    <label htmlFor="delivery_time" className="block text-sm font-medium text-clay-ink2 mb-1">{storePickup ? 'Store pickup' : 'Delivery'} time *</label>
                    <TimeSelect id="delivery_time" value={form.delivery_time} onChange={(time) => set('delivery_time', time)} date={form.delivery_date} today={today} nowTime={nowTime} />
                    <p className="text-xs text-clay-muted mt-1">Hours: {STORE_HOURS_LABEL}. Lunch break: 12–1 PM.</p>
                  </div>
                </>
              )}
              {!scheduleCheck.ok && (deliveryTime || form.pickup_time) && (
                <p className="text-clay-danger text-xs" role="alert">{scheduleCheck.error}</p>
              )}
            </div>
          </ClayCard>

          {/* Loyalty reward */}
          {isRefill && (
            <ClayCard variant="inset" className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="grid place-items-center w-11 h-11 rounded-2xl text-white clay-raised-sm" style={{ background: 'linear-gradient(145deg,#38bdf8,#0284c7)' }}>
                  <ClayIcon name="party" className="w-6 h-6" />
                </span>
                <div>
                  <p className="font-editorial font-bold text-clay-ink">Free refill after 10 delivered refills</p>
                  <p className="text-xs text-clay-muted font-semibold">{rewards ? `${loyaltyProgress} of 10 toward your next reward · ${rewards.available} available` : 'Enter your phone number to see progress.'}</p>
                </div>
              </div>
              {rewards && <progress className="w-full mb-3 accent-sky-500" value={loyaltyProgress} max="10" aria-label="Free refill progress" />}

              {rewards?.available > 0 && maxVouchers > 0 ? (
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
                          <button type="button" onClick={() => { rewardRequestVersion.current += 1; setCodePhase('fallback'); }} className="text-xs text-clay-skydeep font-semibold hover:underline">
                            Didn&apos;t get it? Request staff approval instead
                          </button>
                        </div>
                      )}
                      {codePhase === 'verified' && (
                        <p className="text-sm font-semibold text-clay-skydeep flex items-center gap-1">
                          <ClayIcon name="check" className="w-4 h-4" />
                          {appliedRewards > 0
                            ? `Code verified. ₱${voucherDiscount} off applied.`
                            : 'No instant discount is available. We’ll review your refill request when we confirm the order.'}
                        </p>
                      )}
                      {codePhase === 'fallback' && (
                        <div className="space-y-1">
                          <p className="text-xs text-clay-muted font-semibold">
                            No problem — we&apos;ll review your {rewardCount} free refill{rewardCount > 1 ? 's' : ''} when we confirm your order.
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
                <p className="text-xs text-clay-muted font-semibold">{rewards?.available ? 'Add a refill to use your reward.' : 'Every delivered refill counts toward your next free refill.'}</p>
              )}
            </ClayCard>
          )}

          {/* Payment */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Payment Method</h2>
            <div className="space-y-2">
              {[
                { id: 'cod', label: storePickup ? 'Cash at the store' : 'Cash on Delivery' },
                { id: 'gcash', label: 'GCash / Bank Transfer' },
              ].map((m) => (
                <label key={m.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer clay-tile ${paymentMethod === m.id ? 'clay-tile-selected' : ''}`}>
                  <input type="radio" name="payment_method" value={m.id} checked={paymentMethod === m.id} disabled={deliveryFeePending && m.id === 'gcash'} onChange={() => set('payment_method', m.id)} className="accent-clay-sky" />
                  <span className="font-semibold text-clay-ink">{m.label}</span>
                </label>
              ))}
            </div>

            {deliveryFeePending && <p className="mt-3 text-sm text-clay-muted">Cash on delivery for this order. We’ll confirm the delivery fee before delivery.</p>}
            {paymentMethod === 'gcash' && quote && (
              <div className="mt-4 space-y-3 p-4 clay-inset rounded-xl">
                <p className="text-sm text-clay-ink2">GCash: <strong>{GCASH_NUMBER_DISPLAY}</strong> (Anchor Drops)</p>
                <p className="text-sm text-clay-ink2">Amount to send <strong>₱{grandTotal}</strong></p>
                <div className="flex flex-col items-center gap-2 py-2">
                  <img src="/payment/gcash-qr.jpeg" alt="Anchor Drops GCash / InstaPay QR code" className="w-48 h-auto rounded-2xl clay-raised-sm" />
                  <p className="text-xs text-clay-muted font-semibold">Scan with GCash, or your bank app via InstaPay/QR Ph</p>
                </div>
                <div>
                  <label htmlFor="gcash_number" className="block text-sm font-medium text-clay-ink2 mb-1">Your GCash Number (if paying via GCash)</label>
                  <input id="gcash_number" type="tel" inputMode="tel" autoComplete="tel" value={form.gcash_number} onBlur={() => setFieldTouched((f) => ({ ...f, gcash_number: true }))} onChange={(e) => set('gcash_number', e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
                  {gcashInvalid && <p className="text-clay-danger text-xs mt-1" role="alert">Please enter a valid PH mobile number (09XX-XXX-XXXX).</p>}
                </div>
                <div>
                  <label htmlFor="reference_number" className="block text-sm font-medium text-clay-ink2 mb-1">Reference Number (after payment)</label>
                  <input id="reference_number" value={form.reference_number} onChange={(e) => set('reference_number', e.target.value)} className="clay-input" placeholder="Optional, fill after sending" />
                </div>
                <details>
                  <summary className="text-sm font-semibold text-clay-skydeep cursor-pointer">Attach payment proof (optional)</summary>
                  <div className="mt-2">
                  <label htmlFor="payment_screenshot" className="block text-sm font-medium text-clay-ink2 mb-1">Payment screenshot</label>
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
                </details>
              </div>
            )}
          </ClayCard>

          {/* Notes */}
          <ClayCard className="p-6">
            <button type="button" onClick={() => setShowNotes((shown) => !shown)} aria-expanded={showNotes} className="text-sm font-semibold text-clay-skydeep">{showNotes ? 'Hide delivery notes' : 'Add delivery notes (optional)'}</button>
            {showNotes && <div className="mt-4">
            <label htmlFor="order_notes" className="sr-only">Additional notes</label>
            <textarea id="order_notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="clay-input" placeholder="Delivery instructions, landmarks, etc." />
            </div>}
          </ClayCard>

          {/* Order Summary */}
          <ClayCard id="order-summary" className="p-6 scroll-mt-24">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-clay-muted">Getting it by</span>
                <span className="font-medium">{storePickup ? 'Store pickup' : 'Delivery'}</span>
              </div>
              {deliveryDate && deliveryTime && <div className="flex justify-between gap-3"><span className="text-clay-muted">{storePickup ? 'Collect' : 'Deliver'}</span><span className="font-medium text-right">{deliveryDate} · {formatSlot(deliveryTime)}</span></div>}
              {hasEmptyContainers && form.pickup_date && form.pickup_time && <div className="flex justify-between gap-3"><span className="text-clay-muted">Collect empties</span><span className="font-medium text-right">{form.pickup_date} · {formatSlot(form.pickup_time)}</span></div>}
              {!storePickup && form.address && <div className="flex justify-between gap-3"><span className="text-clay-muted">To</span><span className="font-medium text-right">{form.address}, {form.barangay}</span></div>}
              <div className="flex justify-between">
                <span className="text-clay-muted">{selectedProduct.name} x{form.quantity}</span>
                <span className="font-medium">₱{refillTotal}</span>
              </div>
              {needContainer && form.container_quantity > 0 && (
                <div className="flex justify-between">
                  <span className="text-clay-muted">Container x{form.container_quantity}</span>
                  <span className="font-medium">₱{containerTotal}</span>
                </div>
              )}
              {!storePickup && quote && (
                <div className="flex justify-between">
                  <span className="text-clay-muted">Delivery fee</span>
                  <span className="font-medium">{deliveryFeePending ? 'To be confirmed' : Number(quote.delivery_fee) ? `₱${quote.delivery_fee}` : 'Free'}</span>
                </div>
              )}
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-clay-skydeep font-semibold">
                  <span>Free refill reward ×{appliedRewards}</span>
                  <span>−₱{voucherDiscount}</span>
                </div>
              )}
              {isRefill && (codePhase === 'fallback' || revisedReward?.requires_manual_approval) && rewardCount > 0 && (
                <div className="flex justify-between text-clay-muted">
                  <span>Free refill requested ×{rewardCount}</span>
                  <span>pending review</span>
                </div>
              )}
              <div className="border-t border-sky-200 pt-2 mt-2 flex justify-between font-bold text-base">
                <span className="text-clay-ink">{deliveryFeePending ? 'Subtotal before delivery' : 'Total'}</span>
                <span className="text-clay-skydeep">{grandTotal == null ? '—' : `₱${grandTotal}`}</span>
              </div>
              {!canQuote && isBottle && !storePickup && <p role="status">Add a delivery pin to see the total.</p>}
              {canQuote && !currentQuote && <p role="status">Checking current prices…</p>}
              {currentQuote?.error && (
                <>
                  <p role="alert" className="text-clay-danger">{currentQuote.error}</p>
                  <button type="button" className="text-clay-skydeep underline" onClick={() => {
                    setQuoteResult(null);
                    setQuoteAttempt((attempt) => attempt + 1);
                  }}>Check price again</button>
                </>
              )}
              {currentQuote?.error && isBottle && !storePickup && (
                <button type="button" className="text-clay-skydeep underline" onClick={() => selectFulfillment(selectedProduct, 'pickup')}>Switch to store pickup</button>
              )}
            </div>
          </ClayCard>

          {error && (
            <div className="bg-clay-danger-bg border border-red-200 text-clay-danger rounded-xl px-4 py-3 text-sm" role="alert">{error}</div>
          )}

          {isRefill && <p className="text-center text-sm font-semibold text-clay-skydeep">💧 Free refill after 10 refills.</p>}

          <button type="submit" disabled={loading || !quote} aria-busy={loading || undefined} className="w-full inline-flex items-center justify-center gap-2 clay-btn-primary clay-pressable rounded-full py-4 text-lg font-editorial font-semibold disabled:opacity-60">
            {loading ? (
              <>
                <span className="clay-spinner" aria-hidden="true" />
                Placing Order…
              </>
            ) : (
              currentQuote?.changed ? (deliveryFeePending ? 'Confirm Updated Quote →' : 'Confirm New Total →') : 'Place Order →'
            )}
          </button>
        </form>
      </div>
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 border-t border-sky-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden shadow-lg">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <div className="text-sm"><span className="block text-clay-muted">{deliveryFeePending ? 'Subtotal before delivery' : 'Current total'}</span><strong className="text-clay-skydeep">{grandTotal == null ? 'Checking…' : `₱${grandTotal}`}</strong></div>
          <a href="#order-summary" className="clay-btn-primary rounded-full px-5 py-3 font-semibold text-sm">Review order</a>
        </div>
      </div>
    </Layout>
  );
}
