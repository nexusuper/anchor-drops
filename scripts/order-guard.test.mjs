// Plain-node assertions for the ghost/troll order guards. Run: node scripts/order-guard.test.mjs
import assert from 'node:assert/strict';
import {
  isValidPhonePH, isPlausibleName, isPlausibleAddress,
  normalizePhonePH, strikeVerdict,
} from '../lib/order-guard.js';
import { matchBarangay, normalizeBarangay } from '../lib/service-area.js';

// --- phone ---
assert.equal(isValidPhonePH('09171234567'), true);
assert.equal(isValidPhonePH('0917-123-4567'), true);
assert.equal(isValidPhonePH('+639171234567'), true);
assert.equal(isValidPhonePH('639171234567'), true);
assert.equal(isValidPhonePH('9171234567'), true);
assert.equal(isValidPhonePH('1234567'), false, 'short junk must fail');
assert.equal(isValidPhonePH('08171234567'), false, 'PH mobiles start 09');
assert.equal(isValidPhonePH('091712345678'), false, 'too long');
assert.equal(normalizePhonePH('+63 917 123 4567'), '09171234567');

// --- name ---
assert.equal(isPlausibleName('Juan Dela Cruz'), true);
assert.equal(isPlausibleName('Jo'), true);
assert.equal(isPlausibleName('12345'), false);
assert.equal(isPlausibleName('...'), false);
assert.equal(isPlausibleName('a'), false);

// --- address ---
assert.equal(isPlausibleAddress('123 Rizal St., Purok 4'), true);
assert.equal(isPlausibleAddress('x'), false);
assert.equal(isPlausibleAddress('1234567890'), false, 'digits only is not an address');

// --- barangay ---
assert.equal(matchBarangay('Bugo'), 'Bugo');
assert.equal(matchBarangay('brgy. bugo'), 'Bugo');
assert.equal(matchBarangay('BGY CAMAMAN AN'), 'Camaman-an');
assert.equal(matchBarangay('Barangay 15'), 'Barangay 15');
assert.equal(matchBarangay('15'), 'Barangay 15');
assert.equal(matchBarangay('hahaha'), null);
assert.equal(matchBarangay(''), null);
assert.equal(matchBarangay(null), null);
assert.equal(normalizeBarangay('Brgy. San  Simon'), 'san simon');

// --- strikes ---
assert.equal(strikeVerdict(0, 'cod').ok, true);
assert.equal(strikeVerdict(1, 'cod').ok, true, 'one strike is still a warning only');
assert.equal(strikeVerdict(2, 'cod').ok, false, 'two strikes withdraws COD');
assert.equal(strikeVerdict(2, 'gcash').ok, true, 'prepay still allowed at two strikes');
assert.equal(strikeVerdict(3, 'gcash').ok, false, 'three strikes blocks entirely');
assert.equal(strikeVerdict(9, 'cod').ok, false);

console.log('order-guard: all assertions passed');

// --- phone variants ------------------------------------------------------
// orders.phone_normalized is generated from the RAW typed string, so one
// subscriber has several stored keys. Every strike/throttle lookup must cover
// all of them or a blocked number gets back in by retyping with +63.
import { phoneVariants } from '../lib/order-guard.js';

const local = phoneVariants('09171234567');
assert.deepEqual(local, ['09171234567', '639171234567', '9171234567']);
assert.deepEqual(phoneVariants('+63 917 123 4567'), local, 'international form yields the same key set');
assert.deepEqual(phoneVariants('0917-123-4567'), local, 'punctuation yields the same key set');
assert.deepEqual(phoneVariants('639171234567'), local);
assert.ok(local.includes('09171234567') && local.includes('639171234567'),
  'both stored spellings must be matched');
assert.deepEqual(phoneVariants('junk'), [''], 'non-mobile falls back to bare digits');

console.log('order-guard: phone variant assertions passed');
