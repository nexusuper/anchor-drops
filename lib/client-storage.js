// Browser-only storage helpers for the small amount of customer state we keep on
// the device. Never import from an API route — there is no window there.
//
// This is also where the customer's phone number lives between the order form,
// the confirmation page and the tracker. It deliberately does NOT travel in the
// URL: _app.js fires a Facebook Pixel PageView on mount and on every route
// change, and the Pixel payload includes the full page URL, so a `?phone=` would
// hand Meta an unhashed phone number (next to the order id) on every view.

const IDENTITY_KEY = 'anchor-drops:identity';
const ORDER_PHONE_KEY = 'anchor-drops:order-phone';
export const DRAFT_KEY = 'anchor-drops:order-draft';

// The identity blob is name + phone + street address + map pin. Shared family
// phones and internet-cafe machines are the norm here, so it is not allowed to
// sit around forever waiting to pre-fill itself for the next person.
const IDENTITY_TTL_MS = 30 * 86_400_000; // 30 days

// ponytail: storage access is best-effort throughout — private mode and
// disabled storage throw on read AND on write, and every caller is fine with
// "no saved value" as the answer.
// ponytail: explicit SSR guard rather than leaning on the try/catch to swallow
// a bare `window` ReferenceError — same outcome, but it stops being an accident.
const noWindow = () => typeof window === 'undefined';

export function readStored(storage, key) {
  if (noWindow()) return null;
  try {
    const raw = window[storage].getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(storage, key, value) {
  if (noWindow()) return;
  try {
    window[storage].setItem(key, JSON.stringify(value));
  } catch { /* quota or unavailable — persistence is a nicety */ }
}

function removeStored(storage, key) {
  if (noWindow()) return;
  try {
    window[storage].removeItem(key);
  } catch { /* ignore */ }
}

export function readIdentity() {
  const blob = readStored('localStorage', IDENTITY_KEY);
  if (!blob || typeof blob !== 'object') return null;
  // Blobs written before the stamp existed have saved_at === undefined, and
  // `undefined > n` is false — they read as expired, which is the safe answer.
  if (!(blob.saved_at > Date.now() - IDENTITY_TTL_MS)) {
    clearIdentity();
    return null;
  }
  const { saved_at, ...fields } = blob;
  return fields;
}

export function writeIdentity(fields) {
  writeStored('localStorage', IDENTITY_KEY, { ...fields, saved_at: Date.now() });
}

export function clearIdentity() {
  removeStored('localStorage', IDENTITY_KEY);
  removeStored('sessionStorage', DRAFT_KEY);
  // The order phone too: "Not you? Clear" on a shared device that left this
  // behind handed the next person the previous customer's number, which
  // /track then used as the cancel phone.
  removeStored('sessionStorage', ORDER_PHONE_KEY);
}

// sessionStorage, not localStorage: this only has to survive the hop from the
// order form to the confirmation page and the tracker, and it dies with the tab.
export const readOrderPhone = () => readStored('sessionStorage', ORDER_PHONE_KEY) || '';
export const writeOrderPhone = (phone) => writeStored('sessionStorage', ORDER_PHONE_KEY, phone);
