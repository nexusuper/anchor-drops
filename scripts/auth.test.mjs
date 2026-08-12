import assert from 'node:assert/strict';
import { verifyAdmin, timingSafeEqual } from '../lib/auth.js';

const req = (password) => ({ headers: password === undefined ? {} : { password } });

function withEnv(env, fn) {
  const prev = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, ADMIN_USERS: process.env.ADMIN_USERS };
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USERS;
  Object.assign(process.env, env);
  try { fn(); } finally {
    delete process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_USERS;
    for (const [k, v] of Object.entries(prev)) if (v !== undefined) process.env[k] = v;
  }
}

// fallback: ADMIN_USERS unset → single unnamed "admin" from ADMIN_PASSWORD
withEnv({ ADMIN_PASSWORD: 'hunter2' }, () => {
  assert.equal(verifyAdmin(req('hunter2')), 'admin');
  assert.equal(verifyAdmin(req('nope')), false);
  assert.equal(verifyAdmin(req('')), false);
  assert.equal(verifyAdmin(req()), false);
  assert.equal(verifyAdmin(req('hunter2-but-much-much-longer')), false); // unequal length, no throw
  assert.equal(verifyAdmin(req('hunt')), false);
});

// multi-user: each name comes back, ADMIN_PASSWORD is ignored once ADMIN_USERS is set
withEnv({ ADMIN_USERS: 'owner:pass1,rider1:pass2', ADMIN_PASSWORD: 'hunter2' }, () => {
  assert.equal(verifyAdmin(req('pass1')), 'owner');
  assert.equal(verifyAdmin(req('pass2')), 'rider1');
  assert.equal(verifyAdmin(req('hunter2')), false);
  assert.equal(verifyAdmin(req('pass3')), false);
  assert.equal(verifyAdmin(req('')), false);
  assert.equal(verifyAdmin(req()), false);
  assert.equal(verifyAdmin(req('p'.repeat(500))), false); // unequal length, no throw
});

// no credentials configured at all → always false
withEnv({}, () => {
  assert.equal(verifyAdmin(req('anything')), false);
});

// malformed entries are dropped, not crashed on; reserved names rejected
withEnv({ ADMIN_USERS: 'nocolon,:leadingcolon,locked:x,ok:good' }, () => {
  assert.equal(verifyAdmin(req('good')), 'ok');
  assert.equal(verifyAdmin(req('x')), false);
  assert.equal(verifyAdmin(req('leadingcolon')), false);
});

// timingSafeEqual helper still behaves (used by pages/api/orders.js)
assert.equal(timingSafeEqual('a', 'a'), true);
assert.equal(timingSafeEqual('a', 'bb'), false);
assert.equal(timingSafeEqual(null, 'a'), false);

console.log('auth.test.mjs: all assertions passed');
