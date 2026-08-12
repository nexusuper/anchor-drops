import assert from 'node:assert/strict';
import { z } from 'zod';
import { uuidv4 } from '../lib/uuid.js';

// The exact schema /api/orders validates client_order_id with. A fallback that
// is merely "random hex" fails this and the order is rejected outright.
const ClientOrderId = z.string().uuid();

const realCrypto = globalThis.crypto;
// globalThis.crypto is an accessor-only property in modern Node, so swapping it
// out needs defineProperty rather than assignment.
const setCrypto = (v) => Object.defineProperty(globalThis, 'crypto', {
  value: v, configurable: true, writable: true,
});

function sample(n = 500) {
  return Array.from({ length: n }, () => uuidv4());
}

function checkAll(ids, label) {
  for (const id of ids) {
    assert.equal(ClientOrderId.safeParse(id).success, true, `${label}: ${id} must satisfy z.string().uuid()`);
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, `${label}: ${id} must be v4-shaped`);
  }
  assert.equal(new Set(ids).size, ids.length, `${label}: ids must be unique`);
}

// 1. Native path.
assert.equal(typeof globalThis.crypto?.randomUUID, 'function');
checkAll(sample(), 'native');

// 2. The Facebook in-app browser / old Android WebView case: crypto exists but
//    randomUUID does not.
setCrypto({ getRandomValues: (b) => realCrypto.getRandomValues(b) });
checkAll(sample(), 'getRandomValues fallback');

// 3. No crypto at all — Math.random path.
setCrypto(undefined);
checkAll(sample(), 'Math.random fallback');

// Degenerate RNGs must still produce a valid v4: the version and variant
// nibbles are forced, not sampled.
const realRandom = Math.random;
for (const fixed of [0, 0.9999999999]) {
  Math.random = () => fixed;
  const id = uuidv4();
  assert.equal(ClientOrderId.safeParse(id).success, true, `Math.random()=${fixed} -> ${id}`);
}
Math.random = realRandom;

setCrypto(realCrypto);
console.log('uuid.test.mjs: all assertions passed');
