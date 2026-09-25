// Drives the real pages/api/messenger-webhook.js handler with signed fake
// webhook events. Supabase and the Graph API are stubbed; the stub's
// claim_messenger_welcome mirrors migration 0049 (count < 2, then refuse).
//
//   node scripts/messenger-welcome-cap.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { register } from 'node:module';

const ROOT = new URL('../', import.meta.url).href;
const STUB = 'data:text/javascript,export const getSupabase = () => globalThis.__sb;';
// '@/x' is the Next path alias; Node needs it spelled out.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec === '@/lib/supabaseAdmin') return { url: ${JSON.stringify(STUB)}, shortCircuit: true };
    if (spec.startsWith('@/')) return next(${JSON.stringify(ROOT)} + spec.slice(2) + '.js', ctx);
    return next(spec, ctx);
  }
`));

for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[k];
process.env.FB_APP_SECRET = 'test-secret';
process.env.FB_PAGE_ACCESS_TOKEN = 'test-token';

const welcomeCounts = new Map();
let dbDown = false;
// Every table read finds nothing; awaiting the chain resolves like a query.
const chain = {
  upsert: () => chain, select: () => chain, eq: () => chain,
  maybeSingle: async () => ({ data: null, error: null }),
  then: (resolve) => resolve({ data: [], error: null }),
};
globalThis.__sb = {
  from: () => chain,
  rpc: async (name, { p_psid }) => {
    assert.equal(name, 'claim_messenger_welcome');
    if (dbDown) return { data: null, error: { message: 'down' } };
    const n = welcomeCounts.get(p_psid) || 0;
    if (n >= 2) return { data: null, error: null };
    welcomeCounts.set(p_psid, n + 1);
    return { data: true, error: null };
  },
};

let sent = [];
globalThis.fetch = async (_url, opts) => {
  sent.push(JSON.parse(opts.body));
  return { ok: true, json: async () => ({}) };
};

const { default: handler } = await import('../pages/api/messenger-webhook.js');

let ip = 0;
async function deliver(event) {
  const raw = Buffer.from(JSON.stringify({ object: 'page', entry: [{ messaging: [event] }] }));
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = {
    'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex'),
    'x-vercel-forwarded-for': `10.0.0.${++ip}`,
  };
  let status;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json() { return this; } };
  sent = [];
  await handler(req, res);
  assert.equal(status, 200);
  return sent;
}
const text = (psid, t) => deliver({ sender: { id: psid }, message: { text: t } });
const tap = (psid, payload) => deliver({ sender: { id: psid }, postback: { payload } });
const isWelcome = (m) => m.message.attachment?.payload?.text?.startsWith('👋 Welcome');

function assertMenu(msgs) {
  for (const m of msgs) {
    assert.deepEqual(m.message.quick_replies.map((q) => [q.title, q.payload]), [
      ['💰 Prices', 'MENU_PRICES'],
      ['🛒 Order now', 'MENU_ORDER'],
      ['🙋 Talk to a person', 'MENU_HUMAN'],
    ]);
  }
}

// Messages 1 and 2 get the welcome card; 3 and 4 get silence.
let out = await text('A', 'hi');
assert.equal(out.length, 1); assert.ok(isWelcome(out[0])); assertMenu(out);
out = await text('A', 'magkano?');
assert.equal(out.length, 1); assert.ok(isWelcome(out[0])); assertMenu(out);
assert.equal((await text('A', 'hello?')).length, 0);
assert.equal((await text('A', 'still there')).length, 0);

// Get Started counts toward the same cap.
assert.equal((await tap('A', 'GET_STARTED')).length, 0);

// Button taps still answer after the cap.
for (const p of ['MENU_PRICES', 'MENU_ORDER', 'MENU_HUMAN']) {
  out = await tap('A', p);
  assert.equal(out.length, 1, p); assertMenu(out);
}
out = await deliver({ sender: { id: 'A' }, message: { text: '💰 Prices', quick_reply: { payload: 'MENU_PRICES' } } });
assert.equal(out.length, 1); assert.match(out[0].message.text, /Our prices/); assertMenu(out);

// Unknown order refs still get a reply after the cap.
out = await text('A', 'my order is 00000000-0000-0000-0000-000000000000');
assert.equal(out.length, 1); assertMenu(out);

// Caps are per PSID.
assert.ok(isWelcome((await text('B', 'hi'))[0]));

// DB error fails closed: no card.
dbDown = true;
assert.equal((await text('C', 'hi')).length, 0);

console.log('messenger-welcome-cap: all assertions passed');
