// Anti-abuse rules for the public order form. Isomorphic and pure — the API is
// the enforcement point, the order page imports the same helpers so a customer
// sees the problem before submitting instead of a flat "Invalid order data".
//
// Two independent layers:
//   1. Shape checks (below) reject junk input — a name of digits, a one-letter
//      address, a phone that is not a PH mobile.
//   2. Strike policy (bottom) degrades a phone's options after a rider is sent
//      to a no-show, so a troll can waste one trip and not ten.

// Zod already caps length; these are the "is this plausibly real" floors.
const MIN_ADDRESS_LENGTH = 10;

// PH mobile numbers are 11 digits starting 09, written locally as 09XXXXXXXXX
// and internationally as +639XXXXXXXXX / 639XXXXXXXXX. Both forms fold to the
// local one here so the checks below see a single canonical number.
export function normalizePhonePH(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
}

export function isValidPhonePH(value) {
  return /^09\d{9}$/.test(normalizePhonePH(value));
}

// Every spelling of one PH mobile, as it can appear in orders.phone_normalized.
//
// phone_normalized is a GENERATED column — regexp_replace(phone, '\D', '', 'g')
// over the RAW string the customer typed (see 0001_schema.sql in the schema
// repo). It strips punctuation but does NOT fold the country code, so the same
// subscriber is stored as 09171234567 when they type the local form and as
// 639171234567 when they type +63. Any control keyed on the phone has to match
// ALL of those keys or it is trivially defeated by retyping the number in the
// other format — which would otherwise walk a blocked number straight past the
// strike gate below.
export function phoneVariants(value) {
  const local = normalizePhonePH(value);
  if (!/^09\d{9}$/.test(local)) {
    return [String(value ?? '').replace(/\D/g, '')];
  }
  const bare = local.slice(1); // 9XXXXXXXXX
  return [local, `63${bare}`, bare];
}

// A name has to contain at least two letters somewhere. "12345" and "..." do
// not; "Jo" and "J. Cruz" do.
export function isPlausibleName(value) {
  const letters = String(value ?? '').replace(/[^\p{L}]/gu, '');
  return letters.length >= 2;
}

// Nobody can drive to a one-character address. Requires real length and at
// least one letter, so "1234567890" alone does not pass.
export function isPlausibleAddress(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length >= MIN_ADDRESS_LENGTH && /\p{L}/u.test(trimmed);
}

// --- Strike policy -------------------------------------------------------
// A strike is one order the rider marked as a no-show (orders.no_show). Counted
// per phone across all their orders, so it survives account-less guest ordering.

export const STRIKES_PREPAY_ONLY = 2; // cash on delivery withdrawn
export const STRIKES_BLOCKED = 3;     // cannot order online at all

// New phones are throttled harder than the shared IP limiter can manage: the
// in-memory limiter is per-instance and per-IP, this is per-phone and DB-backed.
export const NEW_PHONE_MAX_ORDERS = 3;
export const NEW_PHONE_WINDOW_MS = 60 * 60 * 1000;

// One message for every rejection state. The verdict is keyed on a phone number
// alone, and a phone number is not proof of identity here — anyone can POST a
// well-formed order with someone else's number. Distinct messages per state
// would turn the public endpoint into an oracle: "is this number blocked",
// "does it have open orders". Same text, same status, for all of them.
export const ORDER_REFUSED_MESSAGE =
  'We are unable to accept this order online. Please message us on Facebook so we can help.';

// --- First-order prepay -------------------------------------------------
// Fake bulk orders ("7 gallons to this address") are the expensive scam: a rider
// burns a trip for nothing. A phone with no delivered order is untrusted, and an
// untrusted phone ordering FIRST_ORDER_PREPAY_MIN_QTY+ containers has to prepay
// and attach proof before anyone is dispatched. Trusted = at least one delivered
// order, the same test as the new-phone throttle above.
//
// The rejection reuses ORDER_REFUSED_MESSAGE, not a "prepay required" text: a
// distinct message would tell anyone probing an arbitrary phone number whether
// it has a delivered order. The order page states the rule up front instead.
export const FIRST_ORDER_PREPAY_MIN_QTY = 3;

export function isBulkFirstOrder(trusted, quantity) {
  return !trusted && quantity >= FIRST_ORDER_PREPAY_MIN_QTY;
}

export function firstOrderVerdict({ trusted, quantity, paymentMethod, hasScreenshot }) {
  if (!isBulkFirstOrder(trusted, quantity)) return { ok: true };
  if (paymentMethod === 'cod' || !hasScreenshot) return { ok: false, error: ORDER_REFUSED_MESSAGE };
  return { ok: true };
}

// --- Delivery minimum -----------------------------------------------------
// A rider trip for a single refill costs more than it earns, so a delivery
// needs at least MIN_DELIVERY_QTY refills in total (cart-wide for POS). Store
// pickup and walk-in sales are exempt. Same rule in the staff app
// (src/domain/pricing.ts) and, for online orders, in the create_order RPC
// (anchor-drops-system migration 0048) — change all three together.
export const MIN_DELIVERY_QTY = 2;
export const DELIVERY_MIN_MESSAGE = `Delivery minimum is ${MIN_DELIVERY_QTY} gallon refills.`;

export function meetsDeliveryMinimum(isPickup, quantity) {
  return isPickup || quantity >= MIN_DELIVERY_QTY;
}

// --- Blocklist ------------------------------------------------------------
// Phones the owner has blocked by hand (app_settings.blocked_phones, entries
// stored as normalizePhonePH). Compared in that folded form, so "+63917…" and
// "0917…" hit the same entry.
export function isPhoneBlocked(phone, blockedPhones) {
  const key = normalizePhonePH(phone);
  return !!key && blockedPhones.some((b) => b.phone === key);
}

export function strikeVerdict(strikes, paymentMethod) {
  if (strikes >= STRIKES_BLOCKED) return { ok: false, error: ORDER_REFUSED_MESSAGE };
  if (strikes >= STRIKES_PREPAY_ONLY && paymentMethod === 'cod') {
    return { ok: false, error: ORDER_REFUSED_MESSAGE };
  }
  return { ok: true };
}
