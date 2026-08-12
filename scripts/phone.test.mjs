import assert from 'node:assert/strict';
import { normalizePhone, phoneMatches, MIN_PHONE_DIGITS } from '../lib/loyalty.js';

// normalizePhone strips every non-digit, so plenty of junk collapses to ''.
assert.equal(normalizePhone('aaaaaaa'), '');
assert.equal(normalizePhone('---'), '');
assert.equal(normalizePhone(null), '');
assert.equal(normalizePhone(undefined), '');
assert.equal(normalizePhone('+63 917 123 4567'), '639171234567');
assert.equal(normalizePhone('0917-123-4567'), '09171234567');

// Real numbers still match through formatting differences.
assert.equal(phoneMatches('0917-123-4567', '09171234567'), true);
assert.equal(phoneMatches('+63 917 123 4567', '639171234567'), true);
assert.equal(phoneMatches('09171234567', '09171234568'), false);

// The bypass this guard exists for: orders.phone is free text (fb-orders.js
// validates only its length), so a row can hold a non-numeric phone. A caller
// supplying equally non-numeric junk normalizes to '' on BOTH sides, and a bare
// `normalizePhone(a) === normalizePhone(b)` would call that a match and let
// anyone cancel that order. Both sides must be real numbers.
assert.equal(normalizePhone('aaaaaaa'), normalizePhone('no phone')); // the hole...
assert.equal(phoneMatches('aaaaaaa', 'no phone'), false);            // ...stays shut
assert.equal(phoneMatches('aaaaaaa', '09171234567'), false);
assert.equal(phoneMatches('09171234567', 'walk-in'), false);
assert.equal(phoneMatches('', ''), false);
assert.equal(phoneMatches(null, null), false);
assert.equal(phoneMatches(undefined, undefined), false);
assert.equal(phoneMatches(0, 0), false);

// Too-short-but-numeric is rejected on either side, at the documented boundary.
const short = '1'.repeat(MIN_PHONE_DIGITS - 1);
const ok = '1'.repeat(MIN_PHONE_DIGITS);
assert.equal(phoneMatches(short, short), false);
assert.equal(phoneMatches(ok, ok), true);
assert.equal(phoneMatches(short, ok), false);

console.log('phone.test.mjs: all assertions passed');
