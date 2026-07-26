# Secure Voucher Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop phone-only voucher theft by requiring either a Messenger one-time code (instant self-service) or admin approval before a loyalty voucher discounts a bill.

**Architecture:** A short-lived, hashed, single-use code is sent to the customer's linked Messenger and consumed at order time; if Messenger can't reach them it silently becomes an admin-approved "reward requested." The server always re-clamps redemption to vouchers actually earned. Crypto helpers live in a server-only `lib/reward-codes.js`; `lib/loyalty.js` stays browser-safe.

**Tech Stack:** Next.js 16.2.7 (pages router), React 19, Neon Postgres, `node:crypto`, existing Messenger integration (`lib/facebook.js`).

---

## Verification model (read first)

- `lib/reward-codes.js` is testable → Task 1 ships `scripts/reward-codes.test.mjs`
  (`node scripts/reward-codes.test.mjs`).
- `npm run lint` — **baseline:** the pre-existing `set-state-in-effect` errors in
  `pages/order.js` and `pages/track.js` (currently ~3 in order.js + 1 in track.js).
  `order.js` is rewritten here; it may keep effects of the same type — no NEW error
  *types* may appear. Report counts.
- `npm run build` — succeeds.
- DB-backed flows can't fully run without `POSTGRES_URL`; where noted, verify logic
  by build + reading, and leave live e2e for the real environment (Task 10).

Commit after every task. Windows — PowerShell-friendly commands.

---

## File structure

**Create:**
- `lib/reward-codes.js` — `generateCode`, `hashCode`, `CODE_TTL_MINUTES`, `CODE_MAX_ATTEMPTS`.
- `scripts/reward-codes.test.mjs` — Node assertions.
- `pages/api/rewards/send-code.js` — send a code to Messenger.
- `pages/api/rewards/verify-code.js` — non-consuming code check (checkout preview).
- `pages/api/orders/[id]/apply-reward.js` — admin applies a pending reward.

**Modify:**
- `lib/db.js` — `reward_codes` table + `reward_requested` column.
- `pages/api/orders.js` — code-gated redemption on POST.
- `pages/order.js` — replace auto-apply with the code flow + silent fallback.
- `pages/order/confirmation.js` — show applied vs requested.
- `components/AdminPanel.js` — pending badge + Apply-reward button.

---

## Task 1: `lib/reward-codes.js` crypto helpers (TDD)

**Files:**
- Create: `lib/reward-codes.js`
- Create: `scripts/reward-codes.test.mjs`

- [ ] **Step 1: Write the failing test** — create `scripts/reward-codes.test.mjs`:

```js
import assert from 'node:assert/strict';
import { CODE_TTL_MINUTES, CODE_MAX_ATTEMPTS, generateCode, hashCode } from '../lib/reward-codes.js';

assert.equal(CODE_TTL_MINUTES, 10);
assert.equal(CODE_MAX_ATTEMPTS, 5);

const h1 = hashCode('09171234567', '123456');
assert.equal(h1, hashCode('09171234567', '123456'));      // deterministic
assert.notEqual(h1, hashCode('09990001111', '123456'));   // salted by phone
assert.notEqual(h1, hashCode('09171234567', '654321'));   // depends on code
assert.match(h1, /^[0-9a-f]{64}$/);                        // sha256 hex

for (let i = 0; i < 50; i++) {
  assert.match(generateCode(), /^\d{6}$/);                 // always 6 digits
}

console.log('reward-codes.test.mjs: all assertions passed');
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/reward-codes.test.mjs`
Expected: failure — cannot find module `../lib/reward-codes.js`.

- [ ] **Step 3: Create `lib/reward-codes.js`**

```js
// Server-only crypto helpers for loyalty reward codes. Do NOT import in client code.
import crypto from 'node:crypto';

export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;

export function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

export function hashCode(phone, code) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node scripts/reward-codes.test.mjs`
Expected: `reward-codes.test.mjs: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add lib/reward-codes.js scripts/reward-codes.test.mjs
git commit -m "feat(redeem): add reward-code crypto helpers with Node tests"
```

---

## Task 2: Database — `reward_codes` table + `reward_requested` column

**Files:**
- Modify: `lib/db.js`

- [ ] **Step 1: Read `lib/db.js`.** It has `CREATE TABLE IF NOT EXISTS orders (...)`
ending with `voucher_discount REAL NOT NULL DEFAULT 0` as its last column, then a
series of `ADD COLUMN IF NOT EXISTS` migrations, then `initialized = true;`.

- [ ] **Step 2: Add `reward_requested` to the orders CREATE.** Change the last
orders column line from:
```
      voucher_discount REAL NOT NULL DEFAULT 0
```
to:
```
      voucher_discount REAL NOT NULL DEFAULT 0,
      reward_requested INTEGER NOT NULL DEFAULT 0
```

- [ ] **Step 3: Add the `reward_codes` table.** Immediately after the orders
`CREATE TABLE ... \`;` statement (before the migration try/catch blocks), add:
```js
  await sql`
    CREATE TABLE IF NOT EXISTS reward_codes (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `;
```

- [ ] **Step 4: Add the `reward_requested` migration.** After the
`voucher_discount` migration try/catch and before `initialized = true;`, add:
```js
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS reward_requested INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {
    // Column may already exist, ignore error
  }
```

- [ ] **Step 5: Verify** — `npm run lint` (baseline only); `npm run build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add lib/db.js
git commit -m "feat(redeem): add reward_codes table and reward_requested column"
```

---

## Task 3: `POST /api/rewards/send-code`

**Files:**
- Create: `pages/api/rewards/send-code.js`

- [ ] **Step 1: Create the endpoint**

> Always returns HTTP 200 with `{ sent: true|false }` — a `false` covers every
> "can't reach them" case (not linked, no vouchers, Meta error/24h window) and the
> client silently falls back to admin approval. The `'\\D'` double-backslash is
> intentional (JS template literal → `\D` in Postgres).

```js
import { initDb } from '@/lib/db';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { generateCode, hashCode, CODE_TTL_MINUTES } from '@/lib/reward-codes';
import { sendMessengerMessage } from '@/lib/facebook';
import { v4 as uuidv4 } from 'uuid';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    return res.status(500).json({ error: `DB init failed: ${err.message}` });
  }

  const phone = normalizePhone(req.body?.phone);
  if (phone.length < 7) return res.status(200).json({ sent: false });

  try {
    const rows = await sql`
      SELECT status, container_size, quantity, voucher_count, messenger_psid
      FROM orders
      WHERE regexp_replace(phone, '\\D', '', 'g') = ${phone}
    `;
    const { available } = computeRewards(rows);
    if (available < 1) return res.status(200).json({ sent: false });

    const linked = rows.find((r) => r.messenger_psid);
    if (!linked) return res.status(200).json({ sent: false });

    const code = generateCode();
    const id = uuidv4();
    const expires = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
    const created = new Date().toISOString();

    await sql`
      INSERT INTO reward_codes (id, phone, code_hash, expires_at, used, attempts, created_at)
      VALUES (${id}, ${phone}, ${hashCode(phone, code)}, ${expires}, 0, 0, ${created})
    `;

    try {
      await sendMessengerMessage(
        linked.messenger_psid,
        `Your Anchor Drops reward code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Enter it at checkout to use your free refill.`
      );
      return res.status(200).json({ sent: true });
    } catch (e) {
      await sql`DELETE FROM reward_codes WHERE id = ${id}`;
      return res.status(200).json({ sent: false });
    }
  } catch (err) {
    return res.status(200).json({ sent: false });
  }
}
```

- [ ] **Step 2: Verify** — `npm run lint` (baseline only, zero referencing the new
file); `npm run build` succeeds and lists `/api/rewards/send-code`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/rewards/send-code.js
git commit -m "feat(redeem): add send-code endpoint (Messenger OTP)"
```

---

## Task 4: `POST /api/rewards/verify-code`

**Files:**
- Create: `pages/api/rewards/verify-code.js`

- [ ] **Step 1: Create the endpoint** (non-consuming check; increments attempts; caps brute force)

```js
import { initDb } from '@/lib/db';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { hashCode, CODE_MAX_ATTEMPTS } from '@/lib/reward-codes';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    return res.status(500).json({ error: `DB init failed: ${err.message}` });
  }

  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '');
  if (phone.length < 7 || !code) return res.status(200).json({ valid: false });

  try {
    const rows = await sql`
      SELECT id, code_hash, expires_at, used, attempts
      FROM reward_codes
      WHERE phone = ${phone} AND used = 0
      ORDER BY created_at DESC LIMIT 1
    `;
    const row = rows[0];
    const nowIso = new Date().toISOString();
    if (!row || row.expires_at <= nowIso) return res.status(200).json({ valid: false });

    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await sql`UPDATE reward_codes SET used = 1 WHERE id = ${row.id}`;
      return res.status(200).json({ valid: false });
    }
    await sql`UPDATE reward_codes SET attempts = attempts + 1 WHERE id = ${row.id}`;

    if (row.code_hash === hashCode(phone, code)) {
      const orderRows = await sql`
        SELECT status, container_size, quantity, voucher_count
        FROM orders
        WHERE regexp_replace(phone, '\\D', '', 'g') = ${phone}
      `;
      const { available } = computeRewards(orderRows);
      return res.status(200).json({ valid: true, available });
    }
    return res.status(200).json({ valid: false });
  } catch (err) {
    return res.status(200).json({ valid: false });
  }
}
```

- [ ] **Step 2: Verify** — `npm run lint` (baseline only); `npm run build` lists `/api/rewards/verify-code`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/rewards/verify-code.js
git commit -m "feat(redeem): add verify-code endpoint with attempt cap"
```

---

## Task 5: Code-gated redemption in `POST /api/orders`

**Files:**
- Modify: `pages/api/orders.js`

- [ ] **Step 1: Read `pages/api/orders.js`.** It currently imports
`{ computeRewards, normalizePhone, VOUCHER_VALUE }`, destructures `voucher_count,
voucher_discount` from the body, has an "Authoritative voucher validation" block,
and an INSERT that writes `voucher_count, voucher_discount`.

- [ ] **Step 2: Update the import line** to also pull in `hashCode`:
```js
import { computeRewards, normalizePhone, VOUCHER_VALUE } from '@/lib/loyalty';
import { hashCode } from '@/lib/reward-codes';
```

- [ ] **Step 3: Change the body destructure.** Replace `notes, total_amount,
voucher_count, voucher_discount,` with:
```js
      notes, total_amount, reward_requested, reward_code,
```

- [ ] **Step 4: Replace the entire existing voucher-validation block.** Replace
everything from `// Authoritative voucher validation:` down to (and including) the
`const finalTotal = ...` line with:
```js
    // Loyalty redemption: never trust the client. A discount is applied only when
    // a valid Messenger code is consumed; otherwise the request is stored as
    // pending for admin approval. `available` re-clamp caps redemption to earned.
    const normPhone = normalizePhone(phone);
    let available = 0;
    try {
      const prior = await sql`
        SELECT status, container_size, quantity, voucher_count
        FROM orders
        WHERE regexp_replace(phone, '\\D', '', 'g') = ${normPhone}
      `;
      available = computeRewards(prior).available;
    } catch (e) {
      available = 0;
    }
    const requested = Math.max(0, Math.min(parseInt(reward_requested) || 0, parseInt(quantity) || 0));

    let voucher_count = 0;
    let reward_requested_store = 0;
    if (requested > 0 && reward_code) {
      try {
        const codeRows = await sql`
          SELECT id, code_hash, expires_at, used FROM reward_codes
          WHERE phone = ${normPhone} AND used = 0
          ORDER BY created_at DESC LIMIT 5
        `;
        const nowIso = new Date().toISOString();
        const match = codeRows.find(
          (r) => r.expires_at > nowIso && r.code_hash === hashCode(normPhone, String(reward_code))
        );
        if (match) {
          await sql`UPDATE reward_codes SET used = 1 WHERE id = ${match.id}`;
          voucher_count = Math.min(requested, available);
        } else {
          reward_requested_store = requested; // invalid/expired code → pending
        }
      } catch (e) {
        reward_requested_store = requested;
      }
    } else if (requested > 0) {
      reward_requested_store = requested; // no code → pending admin approval
    }
    const voucher_discount = voucher_count * VOUCHER_VALUE;
    const finalTotal = Math.max(0, (Number(total_amount) || 0) - voucher_discount);
```

- [ ] **Step 5: Update the INSERT** to write `reward_requested`. Replace the INSERT
statement with:
```js
    try {
      await sql`
        INSERT INTO orders (
          id, customer_name, phone, address, barangay,
          product_type, container_size, quantity,
          need_container, container_quantity,
          payment_method, gcash_number, reference_number,
          notes, total_amount, created_at,
          voucher_count, voucher_discount, reward_requested
        ) VALUES (
          ${id}, ${customer_name}, ${phone}, ${address}, ${barangay},
          ${product_type}, ${container_size}, ${quantity},
          ${nc}, ${cq},
          ${payment_method}, ${gn}, ${rn},
          ${nt}, ${finalTotal}, ${created_at},
          ${voucher_count}, ${voucher_discount}, ${reward_requested_store}
        )
      `;
    } catch (err) {
      return res.status(500).json({ error: `Insert failed: ${err.message}` });
    }
```

Leave the GET handler, required-field validation, `id`/`created_at`/`nc`/`cq`/`gn`/
`rn`/`nt` locals, and the `201` response unchanged.

- [ ] **Step 6: Verify** — `npm run lint` (baseline only); `npm run build` succeeds.

- [ ] **Step 7: Commit**

```bash
git add pages/api/orders.js
git commit -m "feat(redeem): gate order discount behind verified code or pending request"
```

---

## Task 6: `POST /api/orders/[id]/apply-reward` (admin)

**Files:**
- Create: `pages/api/orders/[id]/apply-reward.js`

- [ ] **Step 1: Create the endpoint** (admin password header, mirrors the auth in
`pages/api/orders/[id].js`)

```js
import { initDb } from '@/lib/db';
import { computeRewards, normalizePhone, VOUCHER_VALUE } from '@/lib/loyalty';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { password } = req.headers;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    return res.status(500).json({ error: `DB init failed: ${err.message}` });
  }

  const { id } = req.query;
  try {
    const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.reward_requested || order.reward_requested <= 0) {
      return res.status(400).json({ error: 'No pending reward on this order' });
    }

    const normPhone = normalizePhone(order.phone);
    const prior = await sql`
      SELECT status, container_size, quantity, voucher_count
      FROM orders
      WHERE regexp_replace(phone, '\\D', '', 'g') = ${normPhone}
    `;
    const { available } = computeRewards(prior);
    const allowed = Math.max(0, Math.min(order.reward_requested, available, order.quantity));
    if (allowed <= 0) {
      return res.status(400).json({ error: 'No vouchers available to apply' });
    }

    const discount = allowed * VOUCHER_VALUE;
    const newTotal = Math.max(0, Number(order.total_amount) - discount);
    await sql`
      UPDATE orders
      SET voucher_count = ${allowed}, voucher_discount = ${discount},
          total_amount = ${newTotal}, reward_requested = 0
      WHERE id = ${id}
    `;
    return res.status(200).json({ success: true, applied: allowed, discount, total: newTotal });
  } catch (err) {
    return res.status(500).json({ error: `Apply failed: ${err.message}` });
  }
}
```

- [ ] **Step 2: Verify** — `npm run lint` (baseline only); `npm run build` lists `/api/orders/[id]/apply-reward`.

- [ ] **Step 3: Commit**

```bash
git add "pages/api/orders/[id]/apply-reward.js"
git commit -m "feat(redeem): add admin apply-reward endpoint"
```

---

## Task 7: Order form — code flow + silent fallback

**Files:**
- Modify: `pages/order.js`

- [ ] **Step 1: Replace the whole file** with this version (it removes phone-only
auto-apply; adds the count stepper + "Send code" → verify flow + fallback; sends
the pre-discount `total_amount`, `reward_requested`, and `reward_code`):

```jsx
import Layout from '@/components/Layout';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import { maxRedeemable, VOUCHER_VALUE, normalizePhone } from '@/lib/loyalty';

const PRODUCTS = [
  { id: 'slim5', name: '5-Gallon Slim', refill: 30, container: 150, size: '5-Gal' },
  { id: 'round5', name: '5-Gallon Round', refill: 35, container: 170, size: '5-Gal' },
  { id: 'round3', name: '3-Gallon Round', refill: 20, container: 100, size: '3-Gal' },
];

function deliveryFee(qty) {
  if (qty >= 5) return 0;
  if (qty >= 2) return 15;
  return 20;
}

export default function Order() {
  const router = useRouter();
  const { product: queryProduct } = router.query;

  const [form, setForm] = useState({
    customer_name: '',
    phone: '',
    address: '',
    barangay: '',
    product_type: 'slim5',
    quantity: 1,
    need_container: false,
    container_quantity: 1,
    payment_method: 'cod',
    gcash_number: '',
    reference_number: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rewards, setRewards] = useState(null);
  const [rewardCount, setRewardCount] = useState(0);
  const [codePhase, setCodePhase] = useState('idle'); // idle|sending|entry|verifying|verified|fallback
  const [codeInput, setCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');

  function resetReward() {
    setRewardCount(0);
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  useEffect(() => {
    if (queryProduct) setForm((f) => ({ ...f, product_type: queryProduct }));
  }, [queryProduct]);

  // Look up loyalty rewards when the phone number looks complete.
  useEffect(() => {
    const digits = normalizePhone(form.phone);
    if (digits.length < 7) {
      setRewards(null);
      resetReward();
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rewards?phone=${encodeURIComponent(digits)}`);
        if (res.ok) setRewards(await res.json());
        else setRewards(null);
      } catch {
        setRewards(null);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form.phone]);

  const selectedProduct = PRODUCTS.find((p) => p.id === form.product_type) || PRODUCTS[0];
  const refillTotal = selectedProduct.refill * form.quantity;
  const containerTotal = form.need_container ? selectedProduct.container * form.container_quantity : 0;
  const delivery = deliveryFee(form.quantity);
  const baseTotal = refillTotal + containerTotal + delivery;
  const maxVouchers = maxRedeemable({
    available: rewards ? rewards.available : 0,
    quantity: form.quantity,
    refillSubtotal: refillTotal,
  });
  const codeApplied = codePhase === 'verified';
  const voucherDiscount = codeApplied ? rewardCount * VOUCHER_VALUE : 0;
  const grandTotal = Math.max(0, baseTotal - voucherDiscount);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  // Keep the chosen count within bounds; any bound change cancels a prior verification.
  useEffect(() => {
    setRewardCount((n) => Math.min(n, maxVouchers));
  }, [maxVouchers]);

  function changeCount(next) {
    setRewardCount(Math.max(0, Math.min(maxVouchers, next)));
    setCodePhase('idle');
    setCodeInput('');
    setCodeError('');
  }

  async function sendCode() {
    setCodePhase('sending');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone }),
      });
      const data = await res.json();
      setCodePhase(res.ok && data.sent ? 'entry' : 'fallback');
    } catch {
      setCodePhase('fallback');
    }
  }

  async function verifyCode() {
    setCodePhase('verifying');
    setCodeError('');
    try {
      const res = await fetch('/api/rewards/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: form.phone, code: codeInput }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setCodePhase('verified');
      } else {
        setCodePhase('entry');
        setCodeError('That code is invalid or expired.');
      }
    } catch {
      setCodePhase('entry');
      setCodeError('Could not verify. Please try again.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          container_size: selectedProduct.size,
          total_amount: baseTotal,
          reward_requested: rewardCount,
          reward_code: codeApplied ? codeInput : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to place order');
      router.push(`/order/confirmation?id=${data.id}`);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <Layout title="Place an Order — Anchor Drops">
      <section className="px-4 pt-8">
        <ClayCard className="max-w-2xl mx-auto py-10 text-center text-white" style={{ background: 'linear-gradient(160deg,#7dd3fc,#0ea5e9)' }}>
          <h1 className="text-3xl font-extrabold">Place Your Order</h1>
          <p className="text-sky-50 font-semibold mt-1">No account needed — just fill the form below.</p>
        </ClayCard>
      </section>

      <div className="max-w-2xl mx-auto px-4 py-10">
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Customer Info */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-display font-semibold text-clay-ink2 mb-4">Your Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input required value={form.customer_name} onChange={(e) => set('customer_name', e.target.value)} className="clay-input" placeholder="Juan Dela Cruz" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                <input required value={form.phone} onChange={(e) => set('phone', e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
                <input required value={form.address} onChange={(e) => set('address', e.target.value)} className="clay-input" placeholder="123 Rizal St." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Barangay *</label>
                <input required value={form.barangay} onChange={(e) => set('barangay', e.target.value)} className="clay-input" placeholder="Brgy. San Jose" />
              </div>
            </div>
          </ClayCard>

          {/* Loyalty reward */}
          {rewards && rewards.available > 0 && (
            <ClayCard variant="inset" className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="grid place-items-center w-11 h-11 rounded-2xl text-white clay-raised-sm" style={{ background: 'linear-gradient(145deg,#38bdf8,#0284c7)' }}>
                  <ClayIcon name="party" className="w-6 h-6" />
                </span>
                <div>
                  <p className="font-display font-bold text-clay-ink">You have {rewards.available} free refill{rewards.available > 1 ? 's' : ''}!</p>
                  <p className="text-xs text-clay-muted font-semibold">Each free 5-gallon refill saves you ₱{VOUCHER_VALUE}.</p>
                </div>
              </div>

              {maxVouchers > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-clay-ink2">Free refills to use</span>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => changeCount(rewardCount - 1)} className="w-8 h-8 rounded-full clay-raised-sm font-bold text-clay-skydeep clay-pressable" aria-label="Use fewer">−</button>
                      <span className="font-display font-bold text-clay-ink w-6 text-center">{rewardCount}</span>
                      <button type="button" onClick={() => changeCount(rewardCount + 1)} className="w-8 h-8 rounded-full clay-raised-sm font-bold text-clay-skydeep clay-pressable" aria-label="Use more">+</button>
                    </div>
                  </div>

                  {rewardCount > 0 && (
                    <>
                      {codePhase === 'idle' && (
                        <button type="button" onClick={sendCode} className="w-full clay-btn-primary clay-pressable rounded-full py-2.5 font-display font-semibold text-sm">
                          Verify with a Messenger code
                        </button>
                      )}
                      {codePhase === 'sending' && (
                        <p className="text-xs text-clay-muted font-semibold text-center">Sending your code…</p>
                      )}
                      {(codePhase === 'entry' || codePhase === 'verifying') && (
                        <div className="space-y-2">
                          <p className="text-xs text-clay-muted font-semibold">Enter the 6-digit code we sent to your Messenger:</p>
                          <div className="flex gap-2">
                            <input
                              value={codeInput}
                              onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                              inputMode="numeric"
                              placeholder="123456"
                              className="clay-input flex-1 font-mono tracking-widest"
                            />
                            <button type="button" onClick={verifyCode} disabled={codePhase === 'verifying' || codeInput.length < 6} className="clay-btn-primary clay-pressable rounded-full px-5 font-display font-semibold text-sm disabled:opacity-60">
                              {codePhase === 'verifying' ? '…' : 'Apply'}
                            </button>
                          </div>
                          {codeError && <p className="text-red-500 text-xs">{codeError}</p>}
                          <button type="button" onClick={() => setCodePhase('fallback')} className="text-xs text-clay-skydeep font-semibold hover:underline">
                            Didn&apos;t get it? Apply on delivery instead
                          </button>
                        </div>
                      )}
                      {codePhase === 'verified' && (
                        <p className="text-sm font-semibold text-clay-skydeep flex items-center gap-1">
                          <ClayIcon name="check" className="w-4 h-4" /> Code verified — ₱{rewardCount * VOUCHER_VALUE} off applied.
                        </p>
                      )}
                      {codePhase === 'fallback' && (
                        <p className="text-xs text-clay-muted font-semibold">
                          No problem — we&apos;ll apply your {rewardCount} free refill{rewardCount > 1 ? 's' : ''} when we confirm your delivery.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-xs text-clay-muted font-semibold">Add at least ₱{VOUCHER_VALUE} of refills to use a free refill on this order.</p>
              )}
            </ClayCard>
          )}

          {/* Product Selection */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-display font-semibold text-clay-ink2 mb-4">Water Selection</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Product *</label>
                <div className="grid grid-cols-1 gap-2">
                  {PRODUCTS.map((p) => (
                    <label key={p.id} className={`flex items-center justify-between rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.product_type === p.id ? 'clay-tile-selected' : ''}`}>
                      <div className="flex items-center gap-3">
                        <input type="radio" name="product_type" value={p.id} checked={form.product_type === p.id} onChange={() => set('product_type', p.id)} className="accent-clay-sky" />
                        <span className="font-semibold text-clay-ink">{p.name}</span>
                      </div>
                      <span className="font-display text-clay-skydeep font-bold">₱{p.refill}/refill</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Quantity (refills) *</label>
                <input type="number" min="1" max="50" required value={form.quantity} onChange={(e) => set('quantity', parseInt(e.target.value) || 1)} className="clay-input" />
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={form.need_container} onChange={(e) => set('need_container', e.target.checked)} className="w-4 h-4 accent-sky-500" />
                <span className="text-sm text-gray-700">I also need a new container (+₱{selectedProduct.container} each)</span>
              </label>

              {form.need_container && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of containers *</label>
                  <input type="number" min="1" max="10" value={form.container_quantity} onChange={(e) => set('container_quantity', parseInt(e.target.value) || 1)} className="clay-input" />
                </div>
              )}
            </div>
          </ClayCard>

          {/* Payment */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-display font-semibold text-clay-ink2 mb-4">Payment Method</h2>
            <div className="space-y-2">
              {[
                { id: 'cod', label: 'Cash on Delivery' },
                { id: 'gcash', label: 'GCash' },
                { id: 'paymaya', label: 'PayMaya' },
              ].map((m) => (
                <label key={m.id} className={`flex items-center gap-3 rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.payment_method === m.id ? 'clay-tile-selected' : ''}`}>
                  <input type="radio" name="payment_method" value={m.id} checked={form.payment_method === m.id} onChange={() => set('payment_method', m.id)} className="accent-clay-sky" />
                  <span className="font-semibold text-clay-ink">{m.label}</span>
                </label>
              ))}
            </div>

            {(form.payment_method === 'gcash' || form.payment_method === 'paymaya') && (
              <div className="mt-4 space-y-3 p-4 clay-inset rounded-xl">
                <p className="text-sm text-sky-700">Send payment to: <strong>0912-345-6789</strong> (Anchor Drops)</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your {form.payment_method === 'gcash' ? 'GCash' : 'PayMaya'} Number *</label>
                  <input required value={form.gcash_number} onChange={(e) => set('gcash_number', e.target.value)} className="clay-input" placeholder="09XX-XXX-XXXX" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference Number (after payment)</label>
                  <input value={form.reference_number} onChange={(e) => set('reference_number', e.target.value)} className="clay-input" placeholder="Optional, fill after sending" />
                </div>
              </div>
            )}
          </ClayCard>

          {/* Notes */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-display font-semibold text-clay-ink2 mb-4">Additional Notes</h2>
            <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="clay-input" placeholder="Delivery instructions, landmarks, etc." />
          </ClayCard>

          {/* Order Summary */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-display font-semibold text-clay-ink2 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">{selectedProduct.name} x{form.quantity}</span>
                <span className="font-medium">₱{refillTotal}</span>
              </div>
              {form.need_container && form.container_quantity > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Container x{form.container_quantity}</span>
                  <span className="font-medium">₱{containerTotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600">Delivery fee</span>
                <span className="font-medium">{delivery === 0 ? 'FREE' : `₱${delivery}`}</span>
              </div>
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-clay-skydeep font-semibold">
                  <span>Free refill reward ×{rewardCount}</span>
                  <span>−₱{voucherDiscount}</span>
                </div>
              )}
              {!codeApplied && codePhase === 'fallback' && rewardCount > 0 && (
                <div className="flex justify-between text-clay-muted">
                  <span>Free refill requested ×{rewardCount}</span>
                  <span>on delivery</span>
                </div>
              )}
              <div className="border-t border-sky-200 pt-2 mt-2 flex justify-between font-bold text-base">
                <span className="text-sky-900">Total</span>
                <span className="text-sky-600">₱{grandTotal}</span>
              </div>
            </div>
          </ClayCard>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full clay-btn-primary clay-pressable rounded-full py-4 text-lg font-display font-semibold disabled:opacity-60">
            {loading ? 'Placing Order...' : 'Place Order →'}
          </button>
        </form>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint` → no NEW error *types* vs baseline (the existing
`set-state-in-effect` pattern may persist on the phone-lookup and clamp effects;
report the counts).
Run: `npm run build` → `/order` compiles.

- [ ] **Step 3: Visual check** — `npm run dev`, open `/order`. With no rewards the
reward card is hidden and the form works exactly as before. (Reward UI is exercised
live in Task 10.)

- [ ] **Step 4: Commit**

```bash
git add pages/order.js
git commit -m "feat(redeem): replace auto-apply with Messenger-code flow + fallback"
```

---

## Task 8: Confirmation — applied vs requested

**Files:**
- Modify: `pages/order/confirmation.js`

- [ ] **Step 1: Read the file.** It already imports `ClayIcon`, `ClayCard`,
`ClayButton`, `Link`, and has a block that renders the savings note when
`order.voucher_discount > 0`, followed by a "check your rewards" `<p>`.

- [ ] **Step 2: Add a pending-request note.** Immediately AFTER the existing
`{order.voucher_discount > 0 && ( ... )}` block and BEFORE the
"Earning free refills…" `<p>`, insert:

```jsx
            {order.reward_requested > 0 && (
              <ClayCard variant="inset" className="p-4 text-center text-sm font-semibold text-clay-ink2">
                <ClayIcon name="info" className="w-4 h-4 inline mr-1" />
                Free refill requested ×{order.reward_requested} — we&apos;ll apply it when we confirm your delivery.
              </ClayCard>
            )}
```

- [ ] **Step 3: Verify** — `npm run lint` (baseline only); `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add pages/order/confirmation.js
git commit -m "feat(redeem): show pending free-refill request on confirmation"
```

---

## Task 9: Admin — pending-reward badge + Apply button

**Files:**
- Modify: `components/AdminPanel.js`

- [ ] **Step 1: Read `components/AdminPanel.js`.** Note: it has handler functions
like `updateStatus`/`deleteOrder` that use `fetch('/api/orders/' + id, { headers:{
password: savedPassword } })` and then `await fetchOrders()`; modal state vars like
`deleteModal`; a Total `<td>` that already renders the `voucher_discount` tag; and
an actions `<td>` with the SMS/Messenger/Delete buttons.

- [ ] **Step 2: Add state.** Next to the other `useState` calls (e.g. after
`const [deleteModal, setDeleteModal] = useState(null);`), add:
```jsx
  const [applyRewardModal, setApplyRewardModal] = useState(null);
  const [applyingReward, setApplyingReward] = useState(null);
```

- [ ] **Step 3: Add the handler.** Next to the other async handlers (e.g. after the
`deleteOrder` function), add:
```jsx
  async function applyReward(id) {
    setApplyingReward(id);
    await fetch('/api/orders/' + id + '/apply-reward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
    });
    await fetchOrders();
    setApplyingReward(null);
    setApplyRewardModal(null);
  }
```

- [ ] **Step 4: Add the pending badge to the Total cell.** The Total `<td>`
currently renders `₱{o.total_amount}` and, when `o.voucher_discount > 0`, a
`−₱{o.voucher_discount} reward` div. Immediately after that `voucher_discount` div
(still inside the same `<td>`), add:
```jsx
                            {o.reward_requested > 0 && (
                              <div className="text-[10px] font-semibold text-amber-600">wants {o.reward_requested} free refill{o.reward_requested > 1 ? 's' : ''}</div>
                            )}
```

- [ ] **Step 5: Add the Apply button to the actions cell.** In the actions `<td>`'s
`<div className="flex gap-1">`, after the existing buttons, add:
```jsx
                              {o.reward_requested > 0 && (
                                <button onClick={() => setApplyRewardModal(o)} title="Apply free refill reward" className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold px-2 py-1 rounded-full transition-colors">
                                  Apply reward
                                </button>
                              )}
```

- [ ] **Step 6: Add the confirm modal.** Next to the other modals (e.g. right after
the `{deleteModal && ( ... )}` block), add:
```jsx
          {applyRewardModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
                <h2 className="text-lg font-bold text-gray-800 text-center mb-1">Apply free refill reward?</h2>
                <p className="text-sm text-gray-500 text-center mb-1">Order <span className="font-mono font-bold text-sky-600">{applyRewardModal.id}</span></p>
                <p className="text-sm text-gray-500 text-center mb-4">{applyRewardModal.customer_name} requested {applyRewardModal.reward_requested} free refill(s) (−₱{applyRewardModal.reward_requested * 30}).</p>
                <p className="text-xs text-gray-400 text-center mb-5">Only apply after confirming this is the real customer.</p>
                <div className="flex gap-2">
                  <button onClick={() => setApplyRewardModal(null)} className="flex-1 border border-gray-200 text-gray-600 font-semibold py-2 rounded-full hover:bg-gray-50 transition-colors">Cancel</button>
                  <button onClick={() => applyReward(applyRewardModal.id)} disabled={applyingReward === applyRewardModal.id} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50">
                    {applyingReward === applyRewardModal.id ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          )}
```

Do not change any existing handler/state/markup beyond these additions.

- [ ] **Step 7: Verify** — `npm run lint` (baseline only); `npm run build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(redeem): add admin pending-reward badge and apply action"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + build + lint**

Run: `node scripts/reward-codes.test.mjs` → all assertions pass.
Run: `node scripts/loyalty.test.mjs` → still passes (unchanged).
Run: `npm run lint` → no NEW error *types* vs baseline (report counts).
Run: `npm run build` → succeeds; new routes present (`/api/rewards/send-code`,
`/api/rewards/verify-code`, `/api/orders/[id]/apply-reward`).

- [ ] **Step 2: Visual** — `npm run dev`; `/order` works with no rewards (card
hidden); `/rewards` still loads. Check 375 / 768 / 1440.

- [ ] **Step 3: End-to-end against a real DB (do in the deployed/production env, not the sandbox)**

1. **Theft is blocked:** with a phone that has an available voucher but is NOT your
   Messenger, go to `/order`, choose 1 free refill, you can't get a code → use
   "Apply on delivery" → order places at FULL price with a pending request; no
   discount is granted without admin.
2. **Self-service works:** for a Messenger-linked phone, tap "Verify with a
   Messenger code", receive the code in Messenger, enter it → discount shows →
   place order → confirmation shows "applied"; the code is now `used`.
3. **Admin path:** the pending order shows "wants N free refills" + Apply reward;
   click it → total drops by ₱30×N, badge becomes the "−₱ reward" tag, and
   `/rewards` available decreases.
4. **Brute force:** 6 wrong codes locks the code (verify returns invalid after).
5. **Earned cap holds:** a pending request for more than available, when applied,
   is clamped to available.

- [ ] **Step 4: Commit any fixes** (if needed)

```bash
git add -A
git commit -m "fix(redeem): final verification adjustments"
```

---

## Self-review notes (author)

- **Spec coverage:** phone-only auto-apply removed (Task 7); Path A code
  send/verify/consume (Tasks 1,3,4,5); silent fallback on any send failure
  (Task 3 returns `sent:false`; Task 7 → `fallback`); Path B admin apply (Tasks
  6,9); `reward_codes` + `reward_requested` (Task 2); hashed, single-use, 10-min,
  5-attempt cap (Tasks 1,3,4); `available` re-clamp backstop (Tasks 5,6);
  wrong/expired code → pending not phantom discount (Task 5); confirmation applied
  vs requested (Task 8); `lib/loyalty.js` untouched / crypto isolated (Task 1). All
  covered.
- **Placeholder scan:** none — every step has concrete code.
- **Name consistency:** `reward_requested`, `reward_code`, `voucher_count`,
  `voucher_discount` consistent across DB (Task 2), order POST (Task 5),
  apply-reward (Task 6), order form payload (Task 7), confirmation (Task 8), admin
  (Task 9). `hashCode(phone, code)`/`generateCode()`/`CODE_TTL_MINUTES`/
  `CODE_MAX_ATTEMPTS` identical across Tasks 1,3,4,5. `codePhase` states
  (`idle|sending|entry|verifying|verified|fallback`) used consistently in Task 7.
- **SQL gotcha:** `'\\D'` (JS → `\D` in Postgres) used in Tasks 3,4,5,6.
- **Total contract change noted:** order POST now receives the **pre-discount**
  `total_amount` (base) and subtracts the server-granted `voucher_discount`
  (Tasks 5,7) — no more client-claimed discount to "correct."
