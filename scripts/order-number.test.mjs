import assert from 'node:assert/strict';
import { ORDER_NUMBER_RE, ORDER_NUMBER_SEARCH_RE } from '../lib/order-number.js';

// The generator's alphabet is 32 characters. Counting it here rather than
// trusting the migration comment, because the whole bug was an off-by-one
// against this length.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
assert.equal(ALPHABET.length, 32);
assert.equal(new Set(ALPHABET).size, 32, 'no duplicate characters');
assert.equal(/[IO01]/.test(ALPHABET), false, 'I/O/0/1 are excluded to stay unambiguous');

// ceil(random() * 33) yields 1..33; substr(alphabet, 33, 1) is past the end and
// returns ''. That is the production bug: each of the 4 characters is dropped
// independently with probability 1/33.
const pDrop = 1 / 33;
const pShort = 1 - (1 - pDrop) ** 4;
assert.ok(pShort > 0.11 && pShort < 0.12, `~11.7% of orders come out short, got ${pShort}`);
// And ~0.5% land at two characters, which is why the pattern is not {3,4}.
const pTwo = 6 * pDrop ** 2 * (1 - pDrop) ** 2;
assert.ok(pTwo > 0.004, `two-character segments are not rare enough to ignore: ${pTwo}`);

// Well-formed current and legacy numbers resolve.
assert.ok(ORDER_NUMBER_RE.test('ADW-CDO-260812-A1B2-0001'));
assert.ok(ORDER_NUMBER_RE.test('CFW-CDO-251101-XYZW-0042'));
assert.ok(ORDER_NUMBER_RE.test('adw-cdo-260812-a1b2-0001'), 'lookup is case-insensitive');

// The remediation: already-issued short numbers must still resolve, or those
// customers can neither track nor cancel an order they hold the number for.
assert.ok(ORDER_NUMBER_RE.test('ADW-CDO-260812-A1B-0001'), '3-char segment');
assert.ok(ORDER_NUMBER_RE.test('ADW-CDO-260812-A1-0001'), '2-char segment');
assert.ok(ORDER_NUMBER_RE.test('ADW-CDO-260812-A-0001'), '1-char segment');

// A UUID must NOT match, or every id lookup would query the wrong column.
assert.equal(ORDER_NUMBER_RE.test('8f4b0c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b'), false);

// Still a shape, not a wildcard.
for (const bad of [
  'ADW-CDO-260812--0001',        // all four characters dropped
  'ADW-CDO-260812-A1B2C-0001',   // too long
  'XXX-CDO-260812-A1B2-0001',    // unknown prefix
  'ADW-CDO-26081-A1B2-0001',     // short date
  'ADW-CDO-260812-A1B2-',        // no sequence
  'ADW-CDO-260812-A1B2-0001 or 1=1',
  '',
]) {
  assert.equal(ORDER_NUMBER_RE.test(bad), false, `must reject ${JSON.stringify(bad)}`);
}

// The Messenger webhook pulls an order handle out of free text (a typed
// message, an m.me ?ref= payload). It only recognised uuids for a while, so no
// inbound event ever bound a PSID and every loyalty reward code was
// undeliverable — the confirmation page ships the ORDER NUMBER in that link.
for (const text of [
  'ADW-CDO-260905-QJN9-0001',
  'hi my order is ADW-CDO-260905-QJN9-0001 thanks',
  'CFW-CDO-251201-AB-12',
]) {
  const m = text.match(ORDER_NUMBER_SEARCH_RE);
  assert.ok(m, `must find an order number in ${JSON.stringify(text)}`);
  assert.ok(ORDER_NUMBER_RE.test(m[0]), `extracted ${m[0]} must be a valid order number`);
}
assert.equal(ORDER_NUMBER_SEARCH_RE.test('just a normal hello'), false);

console.log('order-number.test.mjs: all assertions passed');
