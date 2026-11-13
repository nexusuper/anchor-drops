import { useEffect, useRef, useState } from 'react';
import ClayIcon from '../ui/ClayIcon';
import Receipt, { receiptFilename } from './Receipt';
import LocationPicker from '../order/LocationPicker';
import { useStorefrontCatalog } from '@/lib/storefront-catalog';

const PAYMENT_METHODS = [
  { id: 'cod', label: 'Cash' },
  { id: 'gcash', label: 'GCash' },
  { id: 'paymaya', label: 'PayMaya' },
];

const emptyLine = (sku = 'round5_pickup') => ({ product_type: sku, quantity: 1, need_container: false, container_quantity: 0 });

export default function POSPanel({ savedPassword, onSaleComplete }) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [loyalty, setLoyalty] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [fulfillment, setFulfillment] = useState('pickup');
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState(null);
  const [quote, setQuote] = useState(null);
  const [quoteError, setQuoteError] = useState(null);
  const sale = useRef(null);
  const catalog = useStorefrontCatalog();
  const products = (catalog?.products || []).filter((product) =>
    product.kind !== 'info' && (product.kind !== 'refill' || product.fulfillment === fulfillment));
  const productsById = Object.fromEntries(products.map((product) => [product.id, product]));
  const [barangay, setBarangay] = useState('');
  const [deliverySlot, setDeliverySlot] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [lines, setLines] = useState([emptyLine()]);
  const [redeemVouchers, setRedeemVouchers] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cod');
  const [cashTendered, setCashTendered] = useState('');
  const [gcashNumber, setGcashNumber] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [downloading, setDownloading] = useState(false);

  async function lookupLoyalty(rawPhone) {
    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 7) {
      setLoyalty(null);
      return;
    }
    setLoyaltyLoading(true);
    try {
      const res = await fetch(`/api/customers/${digits}`, { headers: { password: savedPassword } });
      if (res.ok) {
        const data = await res.json();
        setLoyalty(data.loyalty);
        if (!customerName && data.customer_name) setCustomerName(data.customer_name);
      } else {
        setLoyalty({ available: 0 });
      }
    } catch {
      setLoyalty({ available: 0 });
    } finally {
      setLoyaltyLoading(false);
    }
  }

  function updateLine(idx, patch) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine(products[0]?.id)]);
  }
  function removeLine(idx) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  const resolvedLines = lines.map((line) => ({
    ...line,
    product_type: ['round5_pickup', 'round5'].includes(line.product_type)
      ? fulfillment === 'pickup' ? 'round5_pickup' : 'round5'
      : line.product_type,
  }));
  const hasBottles = resolvedLines.some((line) => productsById[line.product_type]?.kind === 'bottle');
  const quoteKey = products.length && resolvedLines.every((line) => productsById[line.product_type]) ? JSON.stringify({
    fulfillment,
    lat: fulfillment === 'delivery' ? pin?.lat ?? null : null,
    lng: fulfillment === 'delivery' ? pin?.lng ?? null : null,
    lines: resolvedLines.map((line) => ({
      sku: line.product_type,
      quantity: Number(line.quantity),
      container_quantity: line.need_container ? Number(line.container_quantity) : 0,
    })),
  }) : '';
  useEffect(() => {
    if (!quoteKey) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/order-quote', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: quoteKey, signal: abort.signal,
        });
        const data = await response.json();
        if (response.ok) setQuote({ key: quoteKey, ...data });
        else setQuoteError({ key: quoteKey, message: data.error });
      } catch {
        if (!abort.signal.aborted) setQuoteError({ key: quoteKey, message: 'Could not load current prices.' });
      }
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [quoteKey]);

  const currentQuote = quote?.key === quoteKey ? quote : null;
  const cartSubtotal = currentQuote?.subtotal ?? 0;
  const estDeliveryFee = currentQuote?.delivery_fee ?? 0;
  const availableVouchers = loyalty?.available || 0;
  const voucherValue = Number(currentQuote?.voucher_value ?? 30);
  const totalQuantity = resolvedLines.reduce((sum, line) => sum + (productsById[line.product_type]?.kind === 'refill' ? Number(line.quantity) : 0), 0);
  const clampedRedeem = Math.max(0, Math.min(Math.floor(Number(redeemVouchers)) || 0, availableVouchers, totalQuantity));
  let remainingVouchers = clampedRedeem;
  const estVoucherDiscount = currentQuote?.lines.reduce((sum, product, index) => {
    if (product.kind !== 'refill') return sum;
    const take = Math.min(remainingVouchers, Number(resolvedLines[index].quantity));
    remainingVouchers -= take;
    return sum + Math.min(take * voucherValue, Number(resolvedLines[index].quantity) * Number(product.refill_price));
  }, 0) ?? 0;
  const estTotal = Math.max(0, cartSubtotal + estDeliveryFee - estVoucherDiscount);
  const cashNum = Number(cashTendered) || 0;
  const estChange = paymentMethod === 'cod' && cashTendered !== '' ? Math.max(0, cashNum - estTotal) : null;

  function resetForm() {
    setCustomerName('');
    setPhone('');
    setLoyalty(null);
    setFulfillment('pickup');
    setAddress('');
    setPin(null);
    sale.current = null;
    setBarangay('');
    setDeliverySlot('');
    setDeliveryDate('');
    setLines([emptyLine()]);
    setRedeemVouchers(0);
    setPaymentMethod('cod');
    setCashTendered('');
    setGcashNumber('');
    setReferenceNumber('');
    setNotes('');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!currentQuote || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        customer_name: customerName,
        phone,
        fulfillment_type: fulfillment,
        address,
        barangay,
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
        delivery_slot: deliverySlot || null,
        delivery_date: deliveryDate || null,
        lines: resolvedLines.map((line) => ({
          product_type: line.product_type,
          quantity: Number(line.quantity),
          need_container: !!line.need_container,
          container_quantity: Number(line.container_quantity) || 0,
        })),
        payment_method: paymentMethod,
        cash_tendered: paymentMethod === 'cod' && cashTendered !== '' ? cashNum : null,
        gcash_number: paymentMethod !== 'cod' ? gcashNumber : null,
        reference_number: paymentMethod !== 'cod' ? referenceNumber : null,
        notes,
        redeem_vouchers: clampedRedeem,
        expected_subtotal: cartSubtotal,
        expected_delivery_fee: estDeliveryFee,
        expected_voucher_discount: Number(estVoucherDiscount.toFixed(2)),
        expected_prices: currentQuote.lines.map(({ sku, refill_price, container_price }) => ({ sku, refill_price, container_price })),
      };
      const saleKey = JSON.stringify(payload);
      if (sale.current?.key !== saleKey) {
        sale.current = { key: saleKey, id: crypto.randomUUID(), lineIds: resolvedLines.map(() => crypto.randomUUID()) };
      }
      const res = await fetch('/api/orders/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({
          ...payload, sale_id: sale.current.id,
          lines: payload.lines.map((line, index) => ({ ...line, id: sale.current.lineIds[index] })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          if (data.quote) setQuote({ key: quoteKey, ...data.quote });
          else {
            const refreshed = await fetch('/api/order-quote', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: quoteKey,
            });
            if (refreshed.ok) setQuote({ key: quoteKey, ...await refreshed.json() });
            else setQuote(null);
            await lookupLoyalty(phone);
          }
        }
        setError(data.error || 'Failed to complete sale');
        return;
      }
      setReceipt(data);
      if (onSaleComplete) onSaleComplete();
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  if (receipt) {
    return (
      <div className="max-w-lg mx-auto">
        <Receipt receipt={receipt} />
        <div className="flex gap-3 mt-4 print:hidden">
          <button onClick={() => window.print()} className="flex-1 clay-raised-sm rounded-full py-3 font-display font-semibold text-clay-skydeep">
            <ClayIcon name="download" className="w-4 h-4 inline mr-1" /> Print Receipt
          </button>
          <button onClick={() => downloadReceiptJpeg(receipt)} disabled={downloading} className="flex-1 clay-btn-primary clay-pressable rounded-full py-3 font-display font-semibold disabled:opacity-50">
            <ClayIcon name="download" className="w-4 h-4 inline mr-1" /> {downloading ? 'Saving…' : 'Save as JPEG'}
          </button>
          <button onClick={() => { setReceipt(null); resetForm(); }} className="flex-1 clay-raised-sm rounded-full py-3 font-display font-semibold text-clay-skydeep">
            New Sale
          </button>
        </div>
      </div>
    );
  }

  async function downloadReceiptJpeg(receiptToSave) {
    setDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const el = document.getElementById('pos-receipt');
      const canvas = await html2canvas(el, { backgroundColor: '#ffffff', scale: 2 });
      const url = canvas.toDataURL('image/jpeg', 0.92);
      const a = document.createElement('a');
      a.href = url;
      a.download = receiptFilename(receiptToSave);
      a.click();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl mx-auto space-y-6">
      {error && <div className="clay-inset rounded-2xl p-3 text-sm text-red-600 bg-red-50">{error}</div>}

      <div className="clay-raised rounded-3xl p-5 space-y-4">
        <h3 className="font-display font-semibold text-clay-ink">Customer</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Full Name *</label>
            <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="clay-input" placeholder="Juan Dela Cruz" />
          </div>
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Phone Number *</label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={(e) => lookupLoyalty(e.target.value)}
              className="clay-input"
              placeholder="09XX-XXX-XXXX"
            />
          </div>
        </div>
        {loyaltyLoading && <p className="text-xs text-clay-ink/50" role="status">Checking loyalty status…</p>}
        {loyalty && !loyaltyLoading && (
          <p className="text-xs text-clay-skydeep font-medium" role="status">Available vouchers: {availableVouchers} (up to ₱{voucherValue} off each)</p>
        )}
      </div>

      <div className="clay-raised rounded-3xl p-5 space-y-4">
        <h3 className="font-display font-semibold text-clay-ink">Fulfillment</h3>
        <div className="flex gap-3">
          <button type="button" onClick={() => setFulfillment('pickup')} className={`flex-1 rounded-2xl px-4 py-3 clay-tile ${fulfillment === 'pickup' ? 'clay-tile-selected' : ''}`}>
            <ClayIcon name="jug" className="w-5 h-5 inline mr-1" /> Pickup now
          </button>
          <button type="button" onClick={() => setFulfillment('delivery')} className={`flex-1 rounded-2xl px-4 py-3 clay-tile ${fulfillment === 'delivery' ? 'clay-tile-selected' : ''}`}>
            <ClayIcon name="truck" className="w-5 h-5 inline mr-1" /> Deliver
          </button>
        </div>
        {fulfillment === 'delivery' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Street Address *</label>
              <input required value={address} onChange={(e) => setAddress(e.target.value)} className="clay-input" placeholder="123 Rizal St." />
            </div>
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Barangay *</label>
              <input required value={barangay} onChange={(e) => setBarangay(e.target.value)} className="clay-input" placeholder="Brgy. San Jose" />
            </div>
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery Slot</label>
              <select value={deliverySlot} onChange={(e) => setDeliverySlot(e.target.value)} className="clay-input">
                <option value="">Any</option>
                <option value="am">Morning (8AM–12PM)</option>
                <option value="pm">Afternoon (1PM–5PM)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery Date</label>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="clay-input" />
            </div>
          </div>
        )}
        {fulfillment === 'delivery' && hasBottles && <LocationPicker value={pin} onChange={setPin} />}
      </div>

      <div className="clay-raised rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-clay-ink">Cart</h3>
          <button type="button" onClick={addLine} disabled={!products.length || lines.length >= 20} className="text-sm font-semibold text-clay-skydeep clay-pressable">
            <ClayIcon name="plus" className="w-4 h-4 inline" /> Add product
          </button>
        </div>
        <div className="space-y-3">
          {resolvedLines.map((line, idx) => (
            <div key={idx} className="clay-inset rounded-2xl p-4 space-y-3">
              <div className="flex flex-wrap gap-3 items-start">
                <select value={line.product_type} onChange={(e) => updateLine(idx, { product_type: e.target.value, need_container: false, container_quantity: 0 })} aria-label="Product" className="clay-input flex-1 min-w-[10rem]">
                  {!productsById[line.product_type] && <option value={line.product_type} disabled>Product unavailable</option>}
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} — ₱{p.refill}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  aria-label="Quantity"
                  className="clay-input w-20"
                />
                {lines.length > 1 && (
                  <button type="button" onClick={() => removeLine(idx)} className="w-11 h-11 grid place-items-center rounded-full clay-raised-sm clay-pressable text-red-500" aria-label="Remove product">
                    <ClayIcon name="close" className="w-4 h-4" />
                  </button>
                )}
              </div>
              {productsById[line.product_type]?.kind === 'refill' && <label className="flex items-center gap-2 text-sm text-clay-ink2 cursor-pointer">
                <input type="checkbox" checked={line.need_container} onChange={(e) => updateLine(idx, { need_container: e.target.checked, container_quantity: e.target.checked ? line.container_quantity || 1 : 0 })} />
                Needs container
              </label>}
              {line.need_container && (
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={line.container_quantity}
                  onChange={(e) => updateLine(idx, { container_quantity: e.target.value })}
                  className="clay-input w-24"
                  placeholder="Qty"
                />
              )}

            </div>
          ))}
        </div>
      </div>

      <div className="clay-raised rounded-3xl p-5 space-y-3">
        <h3 className="font-display font-semibold text-clay-ink">Payment</h3>
        <div className="flex gap-3">
          {PAYMENT_METHODS.map((m) => (
            <label key={m.id} className={`flex-1 flex items-center justify-center gap-2 rounded-2xl px-4 py-3 cursor-pointer clay-tile ${paymentMethod === m.id ? 'clay-tile-selected' : ''}`}>
              <input type="radio" name="payment_method" value={m.id} checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} className="accent-clay-sky" />
              <span className="font-semibold text-clay-ink">{m.label}</span>
            </label>
          ))}
        </div>
        {paymentMethod === 'cod' && (
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Cash Tendered</label>
            <input type="number" min="0" value={cashTendered} onChange={(e) => setCashTendered(e.target.value)} className="clay-input" placeholder="0.00" />
            {cashTendered !== '' && (
              <p className={`text-sm mt-1 ${cashNum < estTotal ? 'text-amber-600' : 'text-emerald-600'}`} role="status">
                {cashNum < estTotal ? `Short by ₱${(estTotal - cashNum).toFixed(2)}` : `Change due: ₱${estChange.toFixed(2)}`}
              </p>
            )}
          </div>
        )}
        {paymentMethod !== 'cod' && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">{paymentMethod === 'gcash' ? 'GCash' : 'PayMaya'} Number</label>
              <input value={gcashNumber} onChange={(e) => setGcashNumber(e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
            </div>
            <div>
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Reference Number</label>
              <input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} className="clay-input" placeholder="Optional" />
            </div>
          </div>
        )}
        {availableVouchers > 0 && totalQuantity > 0 && (
          <div>
            <label className="block text-sm font-medium text-clay-ink2 mb-1">Redeem Vouchers (of {availableVouchers} available)</label>
            <input type="number" min="0" max={availableVouchers} value={redeemVouchers} onChange={(e) => setRedeemVouchers(e.target.value)} className="clay-input w-32" />
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-clay-ink2 mb-1">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="clay-input" placeholder="Optional" />
        </div>
      </div>

      <div className="clay-raised rounded-3xl p-5 space-y-1 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>₱{cartSubtotal.toFixed(2)}</span></div>
        {estDeliveryFee > 0 && <div className="flex justify-between"><span>Delivery fee</span><span>₱{estDeliveryFee.toFixed(2)}</span></div>}
        {estVoucherDiscount > 0 && <div className="flex justify-between text-emerald-600"><span>Voucher discount</span><span>-₱{estVoucherDiscount.toFixed(2)}</span></div>}
        <div className="flex justify-between font-bold text-lg pt-2 border-t border-clay-ink/10"><span>Total</span><span>{currentQuote ? `₱${estTotal.toFixed(2)}` : '—'}</span></div>
      </div>

      {!currentQuote && quoteError?.key === quoteKey && <p role="status" className="text-sm text-red-600">{quoteError.message}</p>}
      {catalog && !products.length && <p role="status" className="text-sm">No products available.</p>}
      <button type="submit" disabled={submitting || !currentQuote} className="w-full clay-btn-primary clay-pressable rounded-full py-4 font-display font-semibold text-lg disabled:opacity-60">
        {submitting ? 'Processing…' : 'Complete Sale'}
      </button>
    </form>
  );
}
