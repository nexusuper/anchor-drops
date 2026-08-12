// Pure loyalty math — no DB or React imports, safe in both server and client bundles.
export const GALLONS_BY_SIZE = { '5-Gal': 5, '3-Gal': 3 };
export const VOUCHER_VALUE = 30;       // ₱ value of one free 5-gallon refill
export const GALLONS_PER_VOUCHER = 10; // gallons needed to earn one voucher

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// Shortest phone we will ever treat as a real, comparable number. Anything
// shorter is almost certainly junk that normalized down to nothing.
export const MIN_PHONE_DIGITS = 7;

// Ownership check for the phone-gated customer routes. Never use a bare
// `normalizePhone(a) === normalizePhone(b)`: normalizePhone strips non-digits, so
// a caller-supplied 'aaaaaaa' normalizes to '' and would match any order row
// whose stored phone is also non-numeric (orders.phone is free text, and the
// ManyChat intake validates only its length). Both sides must be real numbers.
export function phoneMatches(a, b) {
  const left = normalizePhone(a);
  const right = normalizePhone(b);
  if (left.length < MIN_PHONE_DIGITS || right.length < MIN_PHONE_DIGITS) return false;
  return left === right;
}

export function gallonsForOrder(order) {
  const per = GALLONS_BY_SIZE[order.container_size] || 0;
  const qty = Number(order.quantity) || 0;
  return per * qty;
}

// `orders` = all order rows for ONE customer (already filtered by phone).
export function computeRewards(orders) {
  let deliveredGallons = 0;
  let redeemed = 0;
  for (const o of orders) {
    if (o.status === 'delivered') deliveredGallons += gallonsForOrder(o);
    if (o.status !== 'cancelled') redeemed += Number(o.voucher_count) || 0;
  }
  const earned = Math.floor(deliveredGallons / GALLONS_PER_VOUCHER);
  const available = Math.max(0, earned - redeemed);
  const remainder = deliveredGallons % GALLONS_PER_VOUCHER;
  const gallonsToNext = remainder === 0 ? GALLONS_PER_VOUCHER : GALLONS_PER_VOUCHER - remainder;
  const progressPct = remainder / GALLONS_PER_VOUCHER;
  return { deliveredGallons, earned, redeemed, available, gallonsToNext, progressPct };
}

// How many vouchers may be applied to one order: capped by what's available,
// the number of refills in the cart, and whole-voucher value vs the refill subtotal.
export function maxRedeemable({ available, quantity, refillSubtotal }) {
  const byValue = Math.floor((Number(refillSubtotal) || 0) / VOUCHER_VALUE);
  return Math.max(0, Math.min(Number(available) || 0, Number(quantity) || 0, byValue));
}
