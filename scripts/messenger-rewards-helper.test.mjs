// Drives the real pages/api/messenger-webhook.js handler (and the real
// Anthropic SDK) with signed fake webhook events. Supabase, the Graph API and
// the Anthropic API are stubbed at fetch level.
//
//   node scripts/messenger-rewards-helper.test.mjs
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { register } from 'node:module';

const ROOT = new URL('../', import.meta.url).href;
const STUB = 'data:text/javascript,export const getSupabase = () => globalThis.__sb;';
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
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

const chain = {
  upsert: () => chain, select: () => chain, eq: () => chain,
  maybeSingle: async () => ({ data: null, error: null }),
  then: (resolve) => resolve({ data: [], error: null }),
};
globalThis.__sb = { from: () => chain, rpc: async () => ({ data: true, error: null }) };

let sent = [];
let claudeCalls = [];
let claudeMode = 'ok'; // 'ok' | 'error' | 'refusal'
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.anthropic.com/')) {
    claudeCalls.push({ body: JSON.parse(opts.body), headers: new Headers(opts.headers) });
    if (claudeMode === 'error') {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }),
        { status: 500, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' } });
    }
    const refusal = claudeMode === 'refusal';
    return new Response(JSON.stringify({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5',
      content: refusal ? [] : [{ type: 'text', text: `Go to the order page (turn ${claudeCalls.length})` }],
      stop_reason: refusal ? 'refusal' : 'end_turn', stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  sent.push(JSON.parse(opts.body));
  return { ok: true, json: async () => ({}) };
};

const { default: handler } = await import('../pages/api/messenger-webhook.js');
const { redact, FALLBACK_REPLY, SYSTEM_PROMPT } = await import('../lib/rewards-helper.js');

let ip = 0;
async function deliver(event) {
  const raw = Buffer.from(JSON.stringify({ object: 'page', entry: [{ messaging: [event] }] }));
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.headers = {
    'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(raw).digest('hex'),
    'x-vercel-forwarded-for': `10.1.0.${++ip}`,
  };
  let status;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json() { return this; } };
  sent = [];
  claudeCalls = [];
  await handler(req, res);
  assert.equal(status, 200);
  return sent;
}
const text = (psid, t) => deliver({ sender: { id: psid }, message: { text: t } });
const tap = (psid, payload) => deliver({ sender: { id: psid }, postback: { payload } });
const isWelcome = (m) => m.message.attachment?.payload?.text?.startsWith('👋 Welcome');

// redact(): codes and phones in any format go; small numbers stay.
assert.equal(redact('code 482913 pls'), 'code [number removed] pls');
assert.equal(redact('call +63 917 123 4567'), 'call [number removed]');
assert.equal(redact('0917-123-4567'), '[number removed]');
assert.equal(redact('I have 10 refills, ₱150'), 'I have 10 refills, ₱150');

// The prompt carries the live constants, not placeholders.
assert.match(SYSTEM_PROMPT, /10 delivered refills = 1 free refill/);
assert.match(SYSTEM_PROMPT, /₱30 off/);
assert.match(SYSTEM_PROMPT, /expires after 10 minutes and allows 5 tries/);
assert.doesNotMatch(SYSTEM_PROMPT, /\[BUSINESS CONTACT\]|\{\{/);

// A voucher question goes to Claude, with numbers stripped first.
let out = await text('A', 'how do i redeem my voucher? my number is 0917 123 4567');
assert.equal(claudeCalls.length, 1);
const { body, headers } = claudeCalls[0];
assert.equal(body.model, 'claude-opus-5');
assert.equal(body.fallbacks, 'default');
assert.match(headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
assert.equal(body.system, SYSTEM_PROMPT);
assert.deepEqual(body.messages, [{ role: 'user', content: 'how do i redeem my voucher? my number is [number removed]' }]);
assert.ok(!JSON.stringify(body).includes('0917'));
assert.equal(out.length, 1);
assert.equal(out[0].message.text, 'Go to the order page (turn 1)');
assert.equal(out[0].message.quick_replies.length, 3);

// Follow-up without a keyword stays in the helper, with history.
out = await text('A', 'wala man ni abot');
assert.equal(claudeCalls.length, 1);
assert.equal(claudeCalls[0].body.messages.length, 3);
assert.equal(claudeCalls[0].body.messages[1].role, 'assistant');
assert.equal(out.length, 1);

// A menu tap leaves the helper; plain chat is back to the welcome card.
await tap('A', 'MENU_PRICES');
out = await text('A', 'hi');
assert.equal(claudeCalls.length, 0);
assert.ok(isWelcome(out[0]));

// Non-voucher chat never reaches Claude.
out = await text('B', 'hi');
assert.equal(claudeCalls.length, 0);
assert.ok(isWelcome(out[0]));

// API error or refusal: static fallback, still a reply.
claudeMode = 'error';
out = await text('C', 'free refill?');
assert.equal(out.length, 1);
assert.equal(out[0].message.text, FALLBACK_REPLY);
claudeMode = 'refusal';
out = await text('D', 'free refill?');
assert.equal(out[0].message.text, FALLBACK_REPLY);
claudeMode = 'ok';

// Owner handoff silences the helper too.
await tap('E', 'MENU_HUMAN');
out = await text('E', 'voucher?');
assert.equal(out.length, 0);
assert.equal(claudeCalls.length, 0);

// Per-PSID turn cap: after 12 model calls, fallback without calling Claude.
for (let i = 0; i < 12; i++) await text('F', 'reward help');
out = await text('F', 'reward help');
assert.equal(claudeCalls.length, 0);
assert.equal(out[0].message.text, FALLBACK_REPLY);

console.log('messenger-rewards-helper: all assertions passed');
