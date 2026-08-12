import assert from 'node:assert/strict';
import { rateLimit } from '../lib/rate-limit.js';

// Minimal req/res stand-ins — the limiter only reads headers/socket and only
// writes a header + a 429 body.
const req = (url, ip = '1.2.3.4') => ({
  url,
  headers: { 'x-vercel-forwarded-for': ip },
  socket: {},
});
const res = () => {
  const r = { code: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

// The regression this exists for: a dynamic route puts the record id in req.url,
// so a url-derived bucket key gave every id its own counter and throttled
// nothing. Same limiter + same IP must share one bucket across every concrete
// url it is called with.
const dynamic = rateLimit({ windowMs: 60_000, max: 3 });
for (let i = 0; i < 3; i++) {
  assert.equal(dynamic(req(`/api/orders/id-${i}`), res()), true, `request ${i} should pass`);
}
const blocked = res();
assert.equal(dynamic(req('/api/orders/id-999'), blocked), false);
assert.equal(blocked.code, 429);
assert.ok(Number(blocked.headers['Retry-After']) > 0);

// A query string is not a fresh bucket either.
assert.equal(dynamic(req('/api/orders/id-0?phone=09171234567'), res()), false);

// Different limiter instance = different route handler = independent budget.
const other = rateLimit({ windowMs: 60_000, max: 3 });
assert.equal(other(req('/api/orders/id-0'), res()), true);

// Different IP, same limiter = independent budget.
assert.equal(dynamic(req('/api/orders/id-0', '5.6.7.8'), res()), true);

// Key cardinality is bounded by (limiters x IPs), not by url: 1000 distinct urls
// from one IP must not mint 1000 entries — proven by the counter still being the
// single shared one, i.e. every call past the cap is refused.
for (let i = 0; i < 1000; i++) {
  assert.equal(dynamic(req(`/api/orders/${i}`), res()), false);
}

// The window expires and the budget comes back.
const short = rateLimit({ windowMs: 1, max: 1 });
assert.equal(short(req('/api/x'), res()), true);
assert.equal(short(req('/api/x'), res()), false);
await new Promise((r) => setTimeout(r, 5));
assert.equal(short(req('/api/x'), res()), true);

console.log('rate-limit.test.mjs: all assertions passed');
