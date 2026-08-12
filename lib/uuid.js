// v4 UUID with a fallback.
//
// crypto.randomUUID is missing in the Facebook in-app browser and older Android
// WebViews — a primary ordering channel here — and a bare call there throws.
// On the order form that threw before the submit's try block: the button stuck
// on "loading", no error rendered, and the order was never placed.
//
// The value is posted as client_order_id, which /api/orders validates with
// z.string().uuid(), so the fallback has to be v4-shaped (version nibble 4,
// variant nibble 8/9/a/b) — a bare random hex string would be rejected.
export function uuidv4() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  // ponytail: Math.random is not a CSPRNG, but this id is an idempotency key,
  // not a secret — guessing one only replays the guesser's own order, and the
  // POST now refuses a collision whose phone does not match. Upgrade path is a
  // server-minted key if it ever has to carry authority.
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);

  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
