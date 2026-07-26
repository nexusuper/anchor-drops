# Loyalty Vouchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give customers one free 5-gallon refill (₱30) for every 10 gallons of delivered water, tracked by phone with no login, shown on a `/rewards` page and auto-applied at checkout.

**Architecture:** A pure `lib/loyalty.js` module holds all voucher math (gallons, earned/redeemed/available, redemption caps) and is reused by a new `GET /api/rewards` endpoint, the `POST /api/orders` validation, the order form, and the rewards page. Earned vouchers are *computed* from delivered orders; two new `orders` columns record redemptions. No customer accounts.

**Tech Stack:** Next.js 16.2.7 (pages router), React 19, Neon Postgres (`@neondatabase/serverless`), Tailwind v4 + the existing claymorphism component layer.

---

## Verification model (read first)

No test runner is installed, but the core math in `lib/loyalty.js` is **pure**, so
Task 1 ships a real Node assertion test (`node scripts/loyalty.test.mjs`). All
other tasks verify via:

1. `npm run lint` — clean. **Baseline:** two pre-existing `set-state-in-effect`
   errors in `pages/order.js` and `pages/track.js`. `order.js` gains more logic in
   this plan; that one pre-existing effect error may shift line number but no NEW
   error types may appear.
2. `npm run build` — succeeds.
3. Manual end-to-end notes where DB behavior matters.

Commit after every task. Windows machine — use PowerShell-friendly commands.

---

## File structure

**Create:**
- `lib/loyalty.js` — pure voucher math (no DB/React imports).
- `scripts/loyalty.test.mjs` — Node assertions for `lib/loyalty.js`.
- `pages/api/rewards.js` — `GET /api/rewards?phone=…`.
- `pages/rewards.js` — My Rewards page.

**Modify:**
- `lib/db.js` — add two columns (CREATE + migration).
- `pages/api/orders.js` — validate + persist voucher redemption on POST.
- `pages/order.js` — rewards lookup, apply-voucher UI, summary + submit payload.
- `pages/order/confirmation.js` — savings note + rewards link.
- `components/Navbar.js`, `components/Footer.js` — Rewards link.
- `components/AdminPanel.js` — per-order reward tag.

---

## Task 1: `lib/loyalty.js` pure module (TDD)

**Files:**
- Create: `lib/loyalty.js`
- Create: `scripts/loyalty.test.mjs`

- [ ] **Step 1: Write the failing test** — create `scripts/loyalty.test.mjs`:

```js
import assert from 'node:assert/strict';
import {
  GALLONS_BY_SIZE, VOUCHER_VALUE, GALLONS_PER_VOUCHER,
  normalizePhone, gallonsForOrder, computeRewards, maxRedeemable,
} from '../lib/loyalty.js';

// constants
assert.equal(VOUCHER_VALUE, 30);
assert.equal(GALLONS_PER_VOUCHER, 10);
assert.equal(GALLONS_BY_SIZE['5-Gal'], 5);
assert.equal(GALLONS_BY_SIZE['3-Gal'], 3);

// normalizePhone
assert.equal(normalizePhone('0917-123 4567'), '09171234567');
assert.equal(normalizePhone(''), '');
assert.equal(normalizePhone(null), '');

// gallonsForOrder
assert.equal(gallonsForOrder({ container_size: '5-Gal', quantity: 2 }), 10);
assert.equal(gallonsForOrder({ container_size: '3-Gal', quantity: 1 }), 3);
assert.equal(gallonsForOrder({ container_size: 'weird', quantity: 5 }), 0);

// computeRewards: empty
assert.deepEqual(computeRewards([]), {
  deliveredGallons: 0, earned: 0, redeemed: 0, available: 0,
  gallonsToNext: 10, progressPct: 0,
});

// computeRewards: 10 delivered gallons → 1 earned, bar resets, next is 10 away
let r = computeRewards([{ status: 'delivered', container_size: '5-Gal', quantity: 2, voucher_count: 0 }]);
assert.equal(r.deliveredGallons, 10);
assert.equal(r.earned, 1);
assert.equal(r.available, 1);
assert.equal(r.gallonsToNext, 10);
assert.equal(r.progressPct, 0);

// computeRewards: 5 delivered gallons → halfway, none earned
r = computeRewards([{ status: 'delivered', container_size: '5-Gal', quantity: 1, voucher_count: 0 }]);
assert.equal(r.earned, 0);
assert.equal(r.gallonsToNext, 5);
assert.equal(r.progressPct, 0.5);

// pending order does NOT accrue; cancelled redemption does NOT count
r = computeRewards([
  { status: 'delivered', container_size: '5-Gal', quantity: 4, voucher_count: 0 }, // 20 gal → earned 2
  { status: 'pending',   container_size: '5-Gal', quantity: 4, voucher_count: 0 }, // ignored for gallons
  { status: 'cancelled', container_size: '5-Gal', quantity: 1, voucher_count: 1 }, // redemption ignored
  { status: 'confirmed', container_size: '5-Gal', quantity: 1, voucher_count: 1 }, // redemption counts
]);
assert.equal(r.deliveredGallons, 20);
assert.equal(r.earned, 2);
assert.equal(r.redeemed, 1);
assert.equal(r.available, 1);

// maxRedeemable: capped by available, quantity, and refill value (whole vouchers)
assert.equal(maxRedeemable({ available: 3, quantity: 2, refillSubtotal: 60 }), 2);
assert.equal(maxRedeemable({ available: 3, quantity: 5, refillSubtotal: 60 }), 2);
assert.equal(maxRedeemable({ available: 1, quantity: 5, refillSubtotal: 20 }), 0);
assert.equal(maxRedeemable({ available: 0, quantity: 5, refillSubtotal: 90 }), 0);

console.log('loyalty.test.mjs: all assertions passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/loyalty.test.mjs`
Expected: FAIL — `Cannot find module '../lib/loyalty.js'` (file not created yet).

- [ ] **Step 3: Create `lib/loyalty.js`**

```js
// Pure loyalty math — no DB or React imports, safe in both server and client bundles.
export const GALLONS_BY_SIZE = { '5-Gal': 5, '3-Gal': 3 };
export const VOUCHER_VALUE = 30;       // ₱ value of one free 5-gallon refill
export const GALLONS_PER_VOUCHER = 10; // gallons needed to earn one voucher

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function gallonsForOrder(order) {
  const per = GALLONS_BY_SIZE[order.container_size] || 0;
  const qty = Number(order.quantity) || 0;
  return per * qty;
}

// `orders` = all order rows for ONE customer (already filtered by phone).
export function computeRewards(orders) {
  let deliveredGallons = 0;
  let redeemed = 0;
  for (const o of orders) {
    if (o.status === 'delivered') deliveredGallons += gallonsForOrder(o);
    if (o.status !== 'cancelled') redeemed += Number(o.voucher_count) || 0;
  }
  const earned = Math.floor(deliveredGallons / GALLONS_PER_VOUCHER);
  const available = Math.max(0, earned - redeemed);
  const remainder = deliveredGallons % GALLONS_PER_VOUCHER;
  const gallonsToNext = remainder === 0 ? GALLONS_PER_VOUCHER : GALLONS_PER_VOUCHER - remainder;
  const progressPct = remainder / GALLONS_PER_VOUCHER;
  return { deliveredGallons, earned, redeemed, available, gallonsToNext, progressPct };
}

// How many vouchers may be applied to one order: capped by what's available,
// the number of refills in the cart, and whole-voucher value vs the refill subtotal.
export function maxRedeemable({ available, quantity, refillSubtotal }) {
  const byValue = Math.floor((Number(refillSubtotal) || 0) / VOUCHER_VALUE);
  return Math.max(0, Math.min(Number(available) || 0, Number(quantity) || 0, byValue));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/loyalty.test.mjs`
Expected: `loyalty.test.mjs: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add lib/loyalty.js scripts/loyalty.test.mjs
git commit -m "feat(loyalty): add pure voucher math module with Node tests"
```

---

## Task 2: Database columns

**Files:**
- Modify: `lib/db.js`

- [ ] **Step 1: Add columns to the CREATE TABLE and as migrations**

In `lib/db.js`, inside the `CREATE TABLE IF NOT EXISTS orders (...)` statement, add
these two lines immediately after the `messenger_psid TEXT` line (add a comma to
`messenger_psid TEXT` so it becomes `messenger_psid TEXT,`):

```
      voucher_count INTEGER NOT NULL DEFAULT 0,
      voucher_discount REAL NOT NULL DEFAULT 0
```

Then, immediately after the existing `messenger_psid` migration `try/catch` block,
add two more migration blocks:

```js
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS voucher_count INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {
    // Column may already exist, ignore error
  }
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS voucher_discount REAL NOT NULL DEFAULT 0`;
  } catch (e) {
    // Column may already exist, ignore error
  }
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint` → baseline only (2 pre-existing errors).
Run: `npm run build` → succeeds.

- [ ] **Step 3: Commit**

```bash
git add lib/db.js
git commit -m "feat(loyalty): add voucher_count and voucher_discount columns"
```

---

## Task 3: `GET /api/rewards`

**Files:**
- Create: `pages/api/rewards.js`

- [ ] **Step 1: Create the endpoint**

> Note: the SQL needs the literal regex `\D`. In a JS template literal you must
> write `'\\D'` so the string passed to Postgres is `\D`.

```js
import { initDb } from '@/lib/db';
import { computeRewards, normalizePhone } from '@/lib/loyalty';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    return res.status(500).json({ error: `DB init failed: ${err.message}` });
  }

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number' });
  }

  try {
    const rows = await sql`
      SELECT status, container_size, quantity, voucher_count
      FROM orders
      WHERE regexp_replace(phone, '\\D', '', 'g') = ${phone}
    `;
    return res.status(200).json(computeRewards(rows));
  } catch (err) {
    return res.status(500).json({ error: `Query failed: ${err.message}` });
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint` → baseline only.
Run: `npm run build` → succeeds; route `/api/rewards` appears in the output.

- [ ] **Step 3: Manual check (optional, needs dev DB)**

Run `npm run dev`, then in a browser open
`http://localhost:3000/api/rewards?phone=09171234567`. Expected JSON shape:
`{"deliveredGallons":0,"earned":0,"redeemed":0,"available":0,"gallonsToNext":10,"progressPct":0}`
for an unknown number (no error).

- [ ] **Step 4: Commit**

```bash
git add pages/api/rewards.js
git commit -m "feat(loyalty): add GET /api/rewards lookup endpoint"
```

---

## Task 4: Validate + persist redemption in `POST /api/orders`

**Files:**
- Modify: `pages/api/orders.js`

- [ ] **Step 1: Add imports**

At the top of `pages/api/orders.js`, after the existing imports, add:

```js
import { computeRewards, normalizePhone, VOUCHER_VALUE } from '@/lib/loyalty';
```

- [ ] **Step 2: Read voucher fields from the body**

In the `POST` branch, add `voucher_count` and `voucher_discount` to the destructure
of `req.body` (append to the existing list):

```js
      notes, total_amount, voucher_count, voucher_discount,
```

- [ ] **Step 3: Compute the authoritative allowed redemption**

After the required-fields validation (`if (!customer_name || ...) return ...`) and
before `const id = ...`, insert:

```js
    // Authoritative voucher validation: recompute what this phone has actually
    // earned from delivered orders; never trust the client's claimed count.
    const normPhone = normalizePhone(phone);
    let allowedVouchers = 0;
    try {
      const prior = await sql`
        SELECT status, container_size, quantity, voucher_count
        FROM orders
        WHERE regexp_replace(phone, '\\D', '', 'g') = ${normPhone}
      `;
      const { available } = computeRewards(prior);
      const requested = Math.max(0, parseInt(voucher_count) || 0);
      allowedVouchers = Math.max(0, Math.min(requested, available, parseInt(quantity) || 0));
    } catch (e) {
      allowedVouchers = 0; // if lookup fails, redeem nothing rather than over-credit
    }
    const allowedDiscount = allowedVouchers * VOUCHER_VALUE;
    const claimedDiscount = Math.max(0, Number(voucher_discount) || 0);
    // Correct the client total for any disallowed discount, never below 0.
    const finalTotal = Math.max(0, (Number(total_amount) || 0) + (claimedDiscount - allowedDiscount));
```

- [ ] **Step 4: Persist the new columns and use `finalTotal`**

Change the `INSERT` so it writes the two new columns and uses `finalTotal` instead
of `total_amount`. Replace the existing INSERT statement with:

```js
    try {
      await sql`
        INSERT INTO orders (
          id, customer_name, phone, address, barangay,
          product_type, container_size, quantity,
          need_container, container_quantity,
          payment_method, gcash_number, reference_number,
          notes, total_amount, created_at,
          voucher_count, voucher_discount
        ) VALUES (
          ${id}, ${customer_name}, ${phone}, ${address}, ${barangay},
          ${product_type}, ${container_size}, ${quantity},
          ${nc}, ${cq},
          ${payment_method}, ${gn}, ${rn},
          ${nt}, ${finalTotal}, ${created_at},
          ${allowedVouchers}, ${allowedDiscount}
        )
      `;
    } catch (err) {
      return res.status(500).json({ error: `Insert failed: ${err.message}` });
    }
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run lint` → baseline only.
Run: `npm run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add pages/api/orders.js
git commit -m "feat(loyalty): validate and persist voucher redemption on order create"
```

---

## Task 5: Order form — lookup, apply, summary, submit

**Files:**
- Modify: `pages/order.js`

- [ ] **Step 1: Add imports**

Replace the top import block of `pages/order.js`:

```jsx
import Layout from '@/components/Layout';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ClayCard from '@/components/ui/ClayCard';
```

with:

```jsx
import Layout from '@/components/Layout';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import ClayCard from '@/components/ui/ClayCard';
import ClayIcon from '@/components/ui/ClayIcon';
import { maxRedeemable, VOUCHER_VALUE, normalizePhone } from '@/lib/loyalty';
```

- [ ] **Step 2: Add rewards state**

After the line `const [error, setError] = useState('');` add:

```jsx
  const [rewards, setRewards] = useState(null);   // { available, deliveredGallons, gallonsToNext, ... }
  const [applyVouchers, setApplyVouchers] = useState(0);
```

- [ ] **Step 3: Add the debounced rewards lookup effect**

After the existing `useEffect` that handles `queryProduct`, add:

```jsx
  // Look up loyalty rewards when the phone number looks complete.
  useEffect(() => {
    const digits = normalizePhone(form.phone);
    if (digits.length < 7) {
      setRewards(null);
      setApplyVouchers(0);
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
```

- [ ] **Step 4: Compute voucher totals and clamp**

Replace the existing totals block:

```jsx
  const delivery = deliveryFee(form.quantity);
  const grandTotal = refillTotal + containerTotal + delivery;
```

with:

```jsx
  const delivery = deliveryFee(form.quantity);
  const maxVouchers = maxRedeemable({
    available: rewards ? rewards.available : 0,
    quantity: form.quantity,
    refillSubtotal: refillTotal,
  });
  const voucherDiscount = applyVouchers * VOUCHER_VALUE;
  const grandTotal = Math.max(0, refillTotal + containerTotal + delivery - voucherDiscount);
```

Then, right after the `set` helper line (`const set = ...`), add a clamp effect so
the applied count never exceeds what's currently allowed:

```jsx
  useEffect(() => {
    setApplyVouchers((n) => Math.min(n, maxVouchers));
  }, [maxVouchers]);
```

- [ ] **Step 5: Add the reward banner UI**

Immediately after the closing `</ClayCard>` of the "Your Information" card (the one
containing the phone field) and before the "Product Selection" card, insert:

```jsx
          {/* Loyalty reward */}
          {rewards && rewards.available > 0 && (
            <ClayCard variant="inset" className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="grid place-items-center w-11 h-11 rounded-2xl text-white clay-raised-sm"
                      style={{ background: 'linear-gradient(145deg,#38bdf8,#0284c7)' }}>
                  <ClayIcon name="party" className="w-6 h-6" />
                </span>
                <div>
                  <p className="font-display font-bold text-clay-ink">You have {rewards.available} free refill{rewards.available > 1 ? 's' : ''}!</p>
                  <p className="text-xs text-clay-muted font-semibold">Each free 5-gallon refill saves you ₱{VOUCHER_VALUE}.</p>
                </div>
              </div>
              {maxVouchers > 0 ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-clay-ink2">Apply to this order</span>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setApplyVouchers((n) => Math.max(0, n - 1))}
                            className="w-8 h-8 rounded-full clay-raised-sm font-bold text-clay-skydeep clay-pressable" aria-label="Use fewer">−</button>
                    <span className="font-display font-bold text-clay-ink w-6 text-center">{applyVouchers}</span>
                    <button type="button" onClick={() => setApplyVouchers((n) => Math.min(maxVouchers, n + 1))}
                            className="w-8 h-8 rounded-full clay-raised-sm font-bold text-clay-skydeep clay-pressable" aria-label="Use more">+</button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-clay-muted font-semibold">Add at least ₱{VOUCHER_VALUE} of refills to use a free refill on this order.</p>
              )}
            </ClayCard>
          )}
```

- [ ] **Step 6: Add the discount line to the Order Summary**

In the Order Summary card, immediately after the "Delivery fee" row `</div>` and
before the Total row `<div className="border-t ...">`, insert:

```jsx
              {voucherDiscount > 0 && (
                <div className="flex justify-between text-clay-skydeep font-semibold">
                  <span>Free refill reward ×{applyVouchers}</span>
                  <span>−₱{voucherDiscount}</span>
                </div>
              )}
```

- [ ] **Step 7: Send voucher fields in the submit payload**

In `handleSubmit`, change the `body: JSON.stringify({ ... })` to include the voucher
fields:

```jsx
        body: JSON.stringify({
          ...form,
          container_size: selectedProduct.size,
          total_amount: grandTotal,
          voucher_count: applyVouchers,
          voucher_discount: voucherDiscount,
        }),
```

- [ ] **Step 8: Verify build + lint**

Run: `npm run lint` → baseline only (the pre-existing `order.js` effect error may
change line number; no NEW error types).
Run: `npm run build` → succeeds.

- [ ] **Step 9: Manual check (dev DB)**

`npm run dev` → on `/order`, type a phone with no history: no reward banner. (Full
redemption flow is verified in Task 10 once data exists.)

- [ ] **Step 10: Commit**

```bash
git add pages/order.js
git commit -m "feat(loyalty): show and apply free-refill vouchers on the order form"
```

---

## Task 6: My Rewards page

**Files:**
- Create: `pages/rewards.js`

- [ ] **Step 1: Create the page**

```jsx
import Layout from '@/components/Layout';
import { useState } from 'react';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { normalizePhone, GALLONS_PER_VOUCHER, VOUCHER_VALUE } from '@/lib/loyalty';

export default function Rewards() {
  const [phone, setPhone] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const digits = normalizePhone(phone);
    if (digits.length < 7) { setError('Enter a valid phone number.'); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/rewards?phone=${encodeURIComponent(digits)}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not load rewards');
      setData(d);
    } catch (err) {
      setError(err.message);
      setData(null);
    }
    setLoading(false);
  }

  const earnedPct = data ? Math.round(data.progressPct * 100) : 0;

  return (
    <Layout title="My Rewards — Anchor Drops">
      <section className="px-4 pt-8">
        <ClayCard className="max-w-lg mx-auto py-10 text-center text-white" style={{ background: 'linear-gradient(160deg,#7dd3fc,#0ea5e9)' }}>
          <ClayIcon name="party" className="w-10 h-10 mx-auto mb-2" />
          <h1 className="text-3xl font-extrabold">My Rewards</h1>
          <p className="text-sky-50 font-semibold mt-1">Earn a free 5-gallon refill every {GALLONS_PER_VOUCHER} gallons.</p>
        </ClayCard>
      </section>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-6">
        <form onSubmit={handleSubmit} className="clay-raised rounded-3xl p-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Your Phone Number</label>
          <div className="flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XX-XXX-XXXX"
              className="clay-input flex-1"
            />
            <button type="submit" disabled={loading}
                    className="clay-btn-primary clay-pressable rounded-full px-5 py-2.5 font-display font-semibold disabled:opacity-60">
              {loading ? '...' : 'Check'}
            </button>
          </div>
          {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        </form>

        {data && (
          <>
            <ClayCard className="p-6 text-center">
              <p className="text-sm text-clay-muted font-semibold mb-1">Free refills available</p>
              <p className="font-display text-6xl font-bold text-clay-skydeep mb-1">{data.available}</p>
              <p className="text-xs text-clay-muted">{data.deliveredGallons} gallons delivered all-time</p>
            </ClayCard>

            <ClayCard className="p-6">
              <div className="flex justify-between text-sm font-semibold text-clay-ink2 mb-2">
                <span>Progress to next free refill</span>
                <span>{data.gallonsToNext} gal to go</span>
              </div>
              <div className="clay-inset rounded-full h-4 overflow-hidden">
                <div className="h-full rounded-full clay-btn-primary" style={{ width: `${earnedPct}%` }} />
              </div>
            </ClayCard>

            <ClayCard variant="inset" className="p-5 text-center text-sm text-clay-skydeep font-semibold">
              <ClayIcon name="info" className="w-4 h-4 inline mr-1" />
              Your free refills (₱{VOUCHER_VALUE} each) apply automatically at checkout.
            </ClayCard>

            <ClayButton href="/order" className="w-full">Order &amp; Redeem</ClayButton>
          </>
        )}
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run lint` → baseline only; zero problems in `pages/rewards.js`.
Run: `npm run build` → succeeds; `/rewards` listed.

- [ ] **Step 3: Commit**

```bash
git add pages/rewards.js
git commit -m "feat(loyalty): add My Rewards page with progress bar"
```

---

## Task 7: Navigation links

**Files:**
- Modify: `components/Navbar.js`
- Modify: `components/Footer.js`

- [ ] **Step 1: Navbar** — in `components/Navbar.js`, add a Rewards entry to the
`LINKS` array so it reads:

```jsx
const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/track', label: 'Track Order' },
];
```

- [ ] **Step 2: Footer** — in `components/Footer.js`, add a Rewards link to the
Quick Links list, after the Products line:

```jsx
              <li><Link href="/rewards" className="text-clay-muted hover:text-clay-skydeep transition-colors">Rewards</Link></li>
```

- [ ] **Step 3: Verify lint** → `npm run lint` → baseline only.

- [ ] **Step 4: Commit**

```bash
git add components/Navbar.js components/Footer.js
git commit -m "feat(loyalty): add Rewards links to nav and footer"
```

---

## Task 8: Confirmation page savings note

**Files:**
- Modify: `pages/order/confirmation.js`

- [ ] **Step 1: Add imports if missing**

Ensure `pages/order/confirmation.js` imports `ClayIcon` and `Link` (Link is already
imported; add ClayIcon if not already present from the redesign):

```jsx
import ClayIcon from '@/components/ui/ClayIcon';
```

- [ ] **Step 2: Add the savings note**

Inside the `{order && (...)}` block, immediately after the order-details `ClayCard`
closes and before the "we will call you" card, insert:

```jsx
            {order.voucher_discount > 0 && (
              <ClayCard variant="inset" className="p-4 text-center text-sm font-semibold text-clay-skydeep">
                <ClayIcon name="party" className="w-4 h-4 inline mr-1" />
                You saved ₱{order.voucher_discount} with a free-refill reward!
              </ClayCard>
            )}
            <p className="text-center text-xs text-clay-muted">
              Earning free refills with every order — <Link href="/rewards" className="text-clay-skydeep font-semibold hover:underline">check your rewards</Link>.
            </p>
```

- [ ] **Step 3: Verify build + lint** → `npm run lint` baseline only; `npm run build` succeeds.

- [ ] **Step 4: Commit**

```bash
git add pages/order/confirmation.js
git commit -m "feat(loyalty): show reward savings and rewards link on confirmation"
```

---

## Task 9: Admin per-order reward tag

**Files:**
- Modify: `components/AdminPanel.js`

- [ ] **Step 1: Show a tag on the Total cell**

In `components/AdminPanel.js`, find the orders-table Total cell:

```jsx
                          <td className="px-4 py-3 font-bold text-sky-600">₱{o.total_amount}</td>
```

Replace it with:

```jsx
                          <td className="px-4 py-3 font-bold text-sky-600">
                            ₱{o.total_amount}
                            {o.voucher_discount > 0 && (
                              <div className="text-[10px] font-semibold text-emerald-600">−₱{o.voucher_discount} reward</div>
                            )}
                          </td>
```

- [ ] **Step 2: Verify build + lint** → `npm run lint` baseline only; `npm run build` succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(loyalty): show applied reward on admin order rows"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Unit + build + lint**

Run: `node scripts/loyalty.test.mjs` → all assertions pass.
Run: `npm run lint` → only the 2 baseline errors.
Run: `npm run build` → succeeds; routes `/rewards` and `/api/rewards` present.

- [ ] **Step 2: End-to-end against the dev DB**

`npm run dev`, then:
1. Place an order (5-Gallon Slim ×2 = 10 gal) for phone `09990001111`.
2. In `/admin`, mark it **delivered**.
3. Visit `/rewards`, enter `09990001111` → expect **1** free refill, 10 gallons,
   bar full / "10 gal to go" for the next.
4. On `/order`, enter the same phone → reward banner shows "1 free refill"; set
   apply to 1 with a 5-gal product → summary shows `−₱30`; place the order.
5. Confirmation shows "You saved ₱30"; `/admin` shows the new order with a
   "−₱30 reward" tag.
6. Re-check `/rewards` for that phone → available is now **0** (1 earned − 1
   redeemed).
7. In `/admin`, cancel the redeeming order → `/rewards` shows available back to
   **1** (cancellation returns the voucher).

- [ ] **Step 3: Visual pass**

Check `/rewards` and the order-form reward banner at 375 / 768 / 1440px in the
clay style; confirm reduced-motion still freezes animations elsewhere.

- [ ] **Step 4: Commit any verification fixes** (if needed)

```bash
git add -A
git commit -m "fix(loyalty): final verification adjustments"
```

---

## Self-review notes (author)

- **Spec coverage:** data model + computed vouchers (Tasks 1–2); phone-normalized
  matching (Tasks 1,3,4); `GET /api/rewards` with zeros-for-unknown (Task 3);
  server-authoritative redemption clamp + persistence (Task 4); order-form lookup,
  multi-voucher apply capped by available/quantity/value, summary + payload
  (Tasks 1,5); `/rewards` page with progress (Task 6); nav/footer discoverability
  (Task 7); confirmation savings note (Task 8); admin tag (Task 9); cancellation
  self-heal verified (Task 10). Delivered-only accrual is enforced in
  `computeRewards` and exercised by the Task 1 test and Task 10 step 7.
- **Placeholder scan:** none — all steps show concrete code.
- **Name consistency:** `computeRewards`, `normalizePhone`, `gallonsForOrder`,
  `maxRedeemable`, `VOUCHER_VALUE`, `GALLONS_PER_VOUCHER`, `GALLONS_BY_SIZE` used
  identically across Tasks 1/3/4/5/6. Order payload fields `voucher_count` /
  `voucher_discount` match the columns (Task 2) and the POST reader (Task 4).
- **SQL gotcha noted:** `'\\D'` in JS source → `\D` in Postgres `regexp_replace`
  (Tasks 3 and 4).
