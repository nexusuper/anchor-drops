import assert from 'node:assert/strict';

// Minimal Storage stand-in — the module only ever uses get/set/removeItem.
const makeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
};

const local = makeStorage();
const session = makeStorage();
globalThis.window = { localStorage: local, sessionStorage: session };

const {
  readIdentity, writeIdentity, clearIdentity,
  readOrderPhone, writeOrderPhone, DRAFT_KEY,
} = await import('../lib/client-storage.js');

const IDENTITY_KEY = 'anchor-drops:identity';
const DAY = 86_400_000;
const IDENTITY = { customer_name: 'Juan Dela Cruz', phone: '09171234567', address: '123 Rizal St.' };

// Round-trips, and the timestamp is an implementation detail the caller never sees.
writeIdentity(IDENTITY);
assert.deepEqual(readIdentity(), IDENTITY);
assert.ok(JSON.parse(local.getItem(IDENTITY_KEY)).saved_at > 0);

// Fresh-enough blobs survive.
local.setItem(IDENTITY_KEY, JSON.stringify({ ...IDENTITY, saved_at: Date.now() - 29 * DAY }));
assert.deepEqual(readIdentity(), IDENTITY);

// Past the 30-day TTL it is gone, and the read also evicts it — a shared family
// phone or a cafe machine must not pre-fill a stranger's name and home address.
local.setItem(IDENTITY_KEY, JSON.stringify({ ...IDENTITY, saved_at: Date.now() - 31 * DAY }));
assert.equal(readIdentity(), null);
assert.equal(local.getItem(IDENTITY_KEY), null);

// Blobs written before the stamp existed have no saved_at and must read as expired,
// not as "valid forever".
local.setItem(IDENTITY_KEY, JSON.stringify(IDENTITY));
assert.equal(readIdentity(), null);

// Junk is survivable.
local.setItem(IDENTITY_KEY, 'not json');
assert.equal(readIdentity(), null);
local.setItem(IDENTITY_KEY, JSON.stringify('a string'));
assert.equal(readIdentity(), null);
assert.equal(readIdentity(), null); // nothing stored at all

// clearIdentity drops the draft too.
writeIdentity(IDENTITY);
session.setItem(DRAFT_KEY, JSON.stringify({ quantity: 3 }));
clearIdentity();
assert.equal(readIdentity(), null);
assert.equal(session.getItem(DRAFT_KEY), null);

// ...and the order phone. "Not you? Clear" on a shared device that left it
// behind handed the next person the previous customer's number, which /track
// then used as the cancel phone.
writeIdentity(IDENTITY);
writeOrderPhone('09171234567');
clearIdentity();
assert.equal(readOrderPhone(), '');

// The phone lives in sessionStorage and never in localStorage — it must not
// outlive the tab, and it must never end up in a URL the FB Pixel reports.
assert.equal(readOrderPhone(), '');
writeOrderPhone('09171234567');
assert.equal(readOrderPhone(), '09171234567');
assert.equal([...local._map.keys()].some((k) => k.includes('phone')), false);

// Storage that throws (private mode) degrades to "no saved value", never a crash.
const throwing = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};
globalThis.window = { localStorage: throwing, sessionStorage: throwing };
assert.equal(readIdentity(), null);
assert.equal(readOrderPhone(), '');
writeIdentity(IDENTITY);
writeOrderPhone('09171234567');
clearIdentity();

// No window at all (server render / an accidental import from an API route):
// explicit guard, not a caught ReferenceError.
delete globalThis.window;
assert.equal(readIdentity(), null);
assert.equal(readOrderPhone(), '');
writeIdentity(IDENTITY);
writeOrderPhone('09171234567');
clearIdentity();

console.log('client-storage.test.mjs: all assertions passed');
