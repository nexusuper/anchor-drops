# Pickup & Delivery Scheduling + Container Pickups Admin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vague AM/PM/pickup delivery slot with explicit pickup (empty containers) and delivery (refilled water) date+time scheduling, enforce the pickup-before-delivery time-window rules, and add a Container Pickups admin tab.

**Architecture:** A new pure-function module (`lib/scheduling.js`) centralizes all window/validation logic so client and server share identical rules. `orders` gains structured date/time columns plus a `has_empty_containers` flag; a new `container_pickups` table is written atomically alongside refill orders via `sql.transaction`. Two new admin API routes and one new admin panel component follow the exact patterns already used by `orders.js`/`orders/[id].js` and `POSPanel.js`.

**Tech Stack:** Next.js Pages Router, Neon Postgres (`@neondatabase/serverless`), Zod, plain `node:assert/strict` test scripts (no test framework configured), Tailwind clay design system.

## Global Constraints

- Pickup window: 6:00 AM–10:59 AM (morning) or 1:00 PM–5:00 PM (afternoon); 11:00 AM–12:59 PM is not selectable.
- Morning pickup → same-day delivery window 1:00 PM–5:00 PM.
- Afternoon pickup → next-day delivery window 7:00 AM–6:00 PM (any time).
- Delivery-only orders (`has_empty_containers = false`): delivery date >= today, time 7:00 AM–6:00 PM, no pickup fields.
- Invariant: delivery datetime must always be strictly later than pickup datetime, enforced independently of the window-bucket check, both client- and server-side.
- Afternoon pickup selection shows the notice: "We will try to pick up in the afternoon but delivery will be tomorrow."
- Times stored as 24h `HH:MM` strings; dates as `YYYY-MM-DD` strings.
- Auth on all new/changed admin routes: `verifyAdminWithLockout(req, res)` from `lib/auth.js`.
- IDs: `uuidv4().slice(0, 8).toUpperCase()`.
- Currency: PHP (unaffected by this feature, no monetary changes).
- No Twilio/SMS-sending integration exists — "SMS" stays copy-to-clipboard, matching `pages/api/notify.js`.

---

## File Structure

- **Create** `lib/scheduling.js` — pure functions: window constants, `classifyPickupTime`, `computeAllowedDeliveryWindow`, `validatePickupDelivery`. Isomorphic (client + server import it).
- **Create** `scripts/scheduling.test.mjs` — assertion tests for `lib/scheduling.js`, run via `node scripts/scheduling.test.mjs`.
- **Modify** `lib/db.js` — add `has_empty_containers`, `pickup_date`, `pickup_time`, `delivery_date_new`, `delivery_time` columns to `orders`; add `container_pickups` table + indexes.
- **Modify** `lib/notifications.js` — add `PICKUP_SMS_MESSAGES` / `PICKUP_MESSENGER_MESSAGES` + `buildPickupStatusMessage`.
- **Modify** `pages/api/orders.js` — replace `delivery_slot`/`delivery_date` fields in `OrderSchema` with the new fields; validate via `lib/scheduling.js`; insert `container_pickups` row transactionally.
- **Create** `pages/api/container-pickups/index.js` — admin `GET` list with filter/sort.
- **Create** `pages/api/container-pickups/[id].js` — admin `PATCH` (status) / `DELETE`.
- **Create** `pages/api/container-pickups/[id]/notify.js` — admin `POST`, SMS-copy-text + Messenger send, mirrors `pages/api/notify.js` + `pages/api/messenger-notify.js`.
- **Modify** `pages/order.js` — replace the "Preferred Delivery Time" card with the has-empty-containers toggle + pickup/delivery date+time pickers and the afternoon-pickup notice.
- **Create** `components/admin/ContainerPickupsPanel.js` — new admin tab component, modeled on `POSPanel.js`.
- **Modify** `components/AdminPanel.js` — add `pickups` tab button + render block; update Orders tab table to show new date/time columns instead of `DELIVERY_SLOT_SHORT`.

---

### Task 1: Scheduling rules module + tests

**Files:**
- Create: `lib/scheduling.js`
- Test: `scripts/scheduling.test.mjs`

**Interfaces:**
- Produces (used by Tasks 3, 4, 6, 8):
  - `PICKUP_MORNING_START = '06:00'`, `PICKUP_MORNING_END = '10:59'`, `PICKUP_AFTERNOON_START = '13:00'`, `PICKUP_AFTERNOON_END = '17:00'`
  - `DELIVERY_SAME_DAY_START = '13:00'`, `DELIVERY_SAME_DAY_END = '17:00'`
  - `DELIVERY_NEXT_DAY_START = '07:00'`, `DELIVERY_NEXT_DAY_END = '18:00'`
  - `DELIVERY_ONLY_START = '07:00'`, `DELIVERY_ONLY_END = '18:00'`
  - `classifyPickupTime(time)` → `'morning' | 'afternoon' | null` (`time` is `'HH:MM'`; `null` if outside allowed ranges or in the 11:00–12:59 gap)
  - `addDays(dateStr, n)` → `'YYYY-MM-DD'` string, `n` days after `dateStr`
  - `computeAllowedDeliveryWindow({ pickupDate, pickupTime })` → `{ date: 'YYYY-MM-DD', minTime: 'HH:MM', maxTime: 'HH:MM' } | null` (`null` if `pickupTime` invalid)
  - `validateSchedule({ hasEmptyContainers, pickupDate, pickupTime, deliveryDate, deliveryTime, today })` → `{ ok: true } | { ok: false, error: string }`. `today` is an injected `'YYYY-MM-DD'` string (caller passes `new Date().toISOString().slice(0,10)` — keeps the function pure/testable without mocking the clock).

- [ ] **Step 1: Write the failing test file**

Create `scripts/scheduling.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import {
  classifyPickupTime, addDays, computeAllowedDeliveryWindow, validateSchedule,
} from '../lib/scheduling.js';

// classifyPickupTime
assert.equal(classifyPickupTime('06:00'), 'morning');
assert.equal(classifyPickupTime('10:59'), 'morning');
assert.equal(classifyPickupTime('11:00'), null);
assert.equal(classifyPickupTime('12:59'), null);
assert.equal(classifyPickupTime('13:00'), 'afternoon');
assert.equal(classifyPickupTime('17:00'), 'afternoon');
assert.equal(classifyPickupTime('17:01'), null);
assert.equal(classifyPickupTime('05:59'), null);
assert.equal(classifyPickupTime('not-a-time'), null);

// addDays
assert.equal(addDays('2026-07-03', 1), '2026-07-04');
assert.equal(addDays('2026-07-31', 1), '2026-08-01');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');

// computeAllowedDeliveryWindow
assert.deepEqual(
  computeAllowedDeliveryWindow({ pickupDate: '2026-07-03', pickupTime: '09:00' }),
  { date: '2026-07-03', minTime: '13:00', maxTime: '17:00' }
);
assert.deepEqual(
  computeAllowedDeliveryWindow({ pickupDate: '2026-07-03', pickupTime: '14:30' }),
  { date: '2026-07-04', minTime: '07:00', maxTime: '18:00' }
);
assert.equal(computeAllowedDeliveryWindow({ pickupDate: '2026-07-03', pickupTime: '11:30' }), null);

// validateSchedule: delivery-only order
assert.deepEqual(
  validateSchedule({
    hasEmptyContainers: false, pickupDate: null, pickupTime: null,
    deliveryDate: '2026-07-03', deliveryTime: '10:00', today: '2026-07-03',
  }),
  { ok: true }
);
// delivery-only: date in the past
assert.equal(
  validateSchedule({
    hasEmptyContainers: false, pickupDate: null, pickupTime: null,
    deliveryDate: '2026-07-02', deliveryTime: '10:00', today: '2026-07-03',
  }).ok,
  false
);
// delivery-only: time outside 7-18
assert.equal(
  validateSchedule({
    hasEmptyContainers: false, pickupDate: null, pickupTime: null,
    deliveryDate: '2026-07-03', deliveryTime: '19:00', today: '2026-07-03',
  }).ok,
  false
);

// validateSchedule: refill, morning pickup, valid same-day afternoon delivery
assert.deepEqual(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '09:00',
    deliveryDate: '2026-07-03', deliveryTime: '14:00', today: '2026-07-03',
  }),
  { ok: true }
);
// refill, morning pickup, delivery date wrong (next day instead of same day)
assert.equal(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '09:00',
    deliveryDate: '2026-07-04', deliveryTime: '14:00', today: '2026-07-03',
  }).ok,
  false
);
// refill, afternoon pickup, valid next-day delivery
assert.deepEqual(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '14:00',
    deliveryDate: '2026-07-04', deliveryTime: '08:00', today: '2026-07-03',
  }),
  { ok: true }
);
// refill, afternoon pickup, same-day delivery attempted (violates invariant + window)
assert.equal(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '14:00',
    deliveryDate: '2026-07-03', deliveryTime: '16:00', today: '2026-07-03',
  }).ok,
  false
);
// refill: pickup time in the gap
assert.equal(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-03', pickupTime: '12:00',
    deliveryDate: '2026-07-03', deliveryTime: '14:00', today: '2026-07-03',
  }).ok,
  false
);
// refill: pickup date in the past
assert.equal(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-02', pickupTime: '09:00',
    deliveryDate: '2026-07-02', deliveryTime: '14:00', today: '2026-07-03',
  }).ok,
  false
);
// invariant: delivery must be strictly after pickup even if someone forges a same-window-looking pair across dates
assert.equal(
  validateSchedule({
    hasEmptyContainers: true, pickupDate: '2026-07-04', pickupTime: '09:00',
    deliveryDate: '2026-07-03', deliveryTime: '14:00', today: '2026-07-03',
  }).ok,
  false
);

console.log('scheduling.test.mjs: all assertions passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/scheduling.test.mjs`
Expected: FAIL — `Cannot find module '../lib/scheduling.js'`

- [ ] **Step 3: Implement `lib/scheduling.js`**

```javascript
// Pure, isomorphic pickup/delivery scheduling rules — shared by the order
// form (client) and the orders API (server, source of truth).

export const PICKUP_MORNING_START = '06:00';
export const PICKUP_MORNING_END = '10:59';
export const PICKUP_AFTERNOON_START = '13:00';
export const PICKUP_AFTERNOON_END = '17:00';

export const DELIVERY_SAME_DAY_START = '13:00';
export const DELIVERY_SAME_DAY_END = '17:00';
export const DELIVERY_NEXT_DAY_START = '07:00';
export const DELIVERY_NEXT_DAY_END = '18:00';

export const DELIVERY_ONLY_START = '07:00';
export const DELIVERY_ONLY_END = '18:00';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidTime(t) {
  return typeof t === 'string' && TIME_RE.test(t);
}

function isValidDate(d) {
  return typeof d === 'string' && DATE_RE.test(d);
}

// String comparison is safe for 'HH:MM' (zero-padded, fixed width) and
// 'YYYY-MM-DD' (zero-padded, fixed width) — no need to parse into Date objects.
function timeInRange(t, start, end) {
  return t >= start && t <= end;
}

export function classifyPickupTime(time) {
  if (!isValidTime(time)) return null;
  if (timeInRange(time, PICKUP_MORNING_START, PICKUP_MORNING_END)) return 'morning';
  if (timeInRange(time, PICKUP_AFTERNOON_START, PICKUP_AFTERNOON_END)) return 'afternoon';
  return null;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function computeAllowedDeliveryWindow({ pickupDate, pickupTime }) {
  if (!isValidDate(pickupDate)) return null;
  const slot = classifyPickupTime(pickupTime);
  if (!slot) return null;
  if (slot === 'morning') {
    return { date: pickupDate, minTime: DELIVERY_SAME_DAY_START, maxTime: DELIVERY_SAME_DAY_END };
  }
  return { date: addDays(pickupDate, 1), minTime: DELIVERY_NEXT_DAY_START, maxTime: DELIVERY_NEXT_DAY_END };
}

// today: 'YYYY-MM-DD' string, injected by the caller (never computed internally)
// so this function stays pure and testable without mocking the clock.
export function validateSchedule({ hasEmptyContainers, pickupDate, pickupTime, deliveryDate, deliveryTime, today }) {
  if (!isValidDate(today)) return { ok: false, error: 'Invalid reference date' };
  if (!isValidDate(deliveryDate) || !isValidTime(deliveryTime)) {
    return { ok: false, error: 'Delivery date/time required' };
  }

  if (!hasEmptyContainers) {
    if (deliveryDate < today) return { ok: false, error: 'Delivery date cannot be in the past' };
    if (!timeInRange(deliveryTime, DELIVERY_ONLY_START, DELIVERY_ONLY_END)) {
      return { ok: false, error: 'Delivery time must be between 7:00 AM and 6:00 PM' };
    }
    return { ok: true };
  }

  if (!isValidDate(pickupDate) || !isValidTime(pickupTime)) {
    return { ok: false, error: 'Pickup date/time required' };
  }
  if (pickupDate < today) return { ok: false, error: 'Pickup date cannot be in the past' };
  if (!classifyPickupTime(pickupTime)) {
    return { ok: false, error: 'Pickup time must be 6:00–10:59 AM or 1:00–5:00 PM' };
  }

  const allowed = computeAllowedDeliveryWindow({ pickupDate, pickupTime });
  if (!allowed || deliveryDate !== allowed.date || !timeInRange(deliveryTime, allowed.minTime, allowed.maxTime)) {
    return { ok: false, error: 'Delivery time is outside the allowed window for this pickup time' };
  }

  // Explicit ordering invariant, independent of the window-bucket check above.
  if (`${deliveryDate}T${deliveryTime}` <= `${pickupDate}T${pickupTime}`) {
    return { ok: false, error: 'Delivery must be scheduled after pickup' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/scheduling.test.mjs`
Expected: `scheduling.test.mjs: all assertions passed`

- [ ] **Step 5: Commit**

```bash
git add lib/scheduling.js scripts/scheduling.test.mjs
git commit -m "feat: add pickup/delivery scheduling rules module"
```

---

### Task 2: Database migration — orders columns + container_pickups table

**Files:**
- Modify: `lib/db.js:210-219` (insert new migrations right before the `auth_failures` block, after the existing `sale_channel`/`cash_tendered`/inventory-seed block)

**Interfaces:**
- Produces (used by Tasks 3, 5, 6):
  - `orders` columns: `has_empty_containers INTEGER NOT NULL DEFAULT 0`, `pickup_date TEXT`, `pickup_time TEXT`, `delivery_date_new TEXT`, `delivery_time TEXT`
  - `container_pickups` table: `id, order_id, customer_name, phone, phone_normalized, address, barangay, container_qty, pickup_date, pickup_time, delivery_date, delivery_time, status, notes, messenger_psid, created_at, updated_at`

- [ ] **Step 1: Add the migration block**

In `lib/db.js`, insert immediately before the `auth_failures` block (currently starting at line 210):

```javascript
  // Migration: pickup/delivery scheduling
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS has_empty_containers INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_date TEXT`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_time TEXT`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date_new TEXT`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_time TEXT`;
  } catch (e) {}
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS container_pickups (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id),
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        phone_normalized TEXT NOT NULL,
        address TEXT NOT NULL,
        barangay TEXT NOT NULL,
        container_qty INTEGER NOT NULL,
        pickup_date TEXT NOT NULL,
        pickup_time TEXT NOT NULL,
        delivery_date TEXT NOT NULL,
        delivery_time TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        notes TEXT DEFAULT '',
        messenger_psid TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
  } catch (e) {}
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_container_pickups_status ON container_pickups (status)`;
  } catch (e) {}
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_container_pickups_date ON container_pickups (pickup_date)`;
  } catch (e) {}
```

- [ ] **Step 2: Verify locally**

Run: `npm run dev`, then in another terminal: `curl -s http://localhost:3000/api/orders -X GET -H "password: $ADMIN_PASSWORD" | head -c 200`
Expected: no 500 error (confirms `initDb()` ran the new migration without throwing). If `ADMIN_PASSWORD`/`POSTGRES_URL` aren't set locally, just visually inspect the diff for syntax correctness and rely on Task 3/5's manual smoke test to exercise it against the real dev DB.

- [ ] **Step 3: Commit**

```bash
git add lib/db.js
git commit -m "feat: add pickup/delivery columns and container_pickups table"
```

---

### Task 3: Notification message templates for pickups

**Files:**
- Modify: `lib/notifications.js`

**Interfaces:**
- Consumes: none new
- Produces (used by Tasks 6, 7): `PICKUP_NOTIFIABLE_STATUSES = ['scheduled', 'picked_up', 'delivered']`, `buildPickupStatusMessage(pickup, status, channel)` → `string | null`

- [ ] **Step 1: Add templates and builder function**

Append to `lib/notifications.js`:

```javascript
export const PICKUP_NOTIFIABLE_STATUSES = ['scheduled', 'picked_up', 'delivered'];

const PICKUP_SMS_MESSAGES = {
  scheduled: (name, pickupDate, pickupTime, qty) =>
    `Hi ${name}! We've scheduled pickup of your ${qty} empty container(s) on ${pickupDate} at ${pickupTime}. Please have them ready outside. Thank you! 💧`,
  picked_up: (name, deliveryDate, deliveryTime) =>
    `Hi ${name}! We've picked up your empty containers. Your refilled water will be delivered on ${deliveryDate} at ${deliveryTime}. 🛵`,
  delivered: (name) =>
    `Hi ${name}! Your refilled water has been delivered. 🎉 Thank you for choosing Anchor Drops!`,
};

const PICKUP_MESSENGER_MESSAGES = {
  scheduled: (name, pickupDate, pickupTime, qty) =>
    `📦 Hi ${name}! We've scheduled pickup of your ${qty} empty container(s) on ${pickupDate} at ${pickupTime}.\n\nPlease have them ready outside. Thank you! 💧`,
  picked_up: (name, deliveryDate, deliveryTime) =>
    `🛵 Hi ${name}! We've picked up your empty containers.\n\nYour refilled water will be delivered on ${deliveryDate} at ${deliveryTime}. 💧`,
  delivered: (name) =>
    `🎉 Hi ${name}! Your refilled water has been delivered.\n\nThank you for choosing Anchor Drops! 💧`,
};

export function buildPickupStatusMessage(pickup, status, channel) {
  const table = channel === 'messenger' ? PICKUP_MESSENGER_MESSAGES : PICKUP_SMS_MESSAGES;
  const fn = table[status];
  if (!fn) return null;
  return fn(pickup.customer_name, pickup.pickup_date || pickup.delivery_date, pickup.pickup_time || pickup.delivery_time, pickup.container_qty);
}
```

- [ ] **Step 2: Manual check**

Run: `node -e "import('./lib/notifications.js').then(m => console.log(m.buildPickupStatusMessage({customer_name:'Juan', pickup_date:'2026-07-04', pickup_time:'09:00', container_qty:3}, 'scheduled', 'sms')))"`
Expected: prints the interpolated scheduled-status SMS string containing "Juan", "2026-07-04", "09:00", "3".

- [ ] **Step 3: Commit**

```bash
git add lib/notifications.js
git commit -m "feat: add container pickup notification templates"
```

---

### Task 4: Orders API — accept structured schedule fields, validate, create pickup row

**Files:**
- Modify: `pages/api/orders.js`

**Interfaces:**
- Consumes: `validateSchedule` from `lib/scheduling.js` (Task 1)
- Produces: POST `/api/orders` now accepts `has_empty_containers` (boolean), `pickupDate`, `pickupTime`, `deliveryDate`, `deliveryTime` in place of `delivery_slot`/`delivery_date`; on success, a `container_pickups` row exists when `has_empty_containers` is true.

- [ ] **Step 1: Update the Zod schema**

In `pages/api/orders.js`, replace lines 31-32:

```javascript
  delivery_slot: z.enum(['am', 'pm', 'pickup']).optional().nullable(),
  delivery_date: z.string().max(20).optional().nullable(),
```

with:

```javascript
  has_empty_containers: z.boolean().or(z.literal(0)).or(z.literal(1)).optional().default(false),
  pickupDate: z.string().max(10).optional().nullable(),
  pickupTime: z.string().max(5).optional().nullable(),
  deliveryDate: z.string().max(10).min(1),
  deliveryTime: z.string().max(5).min(1),
```

- [ ] **Step 2: Import scheduling validator and add server-side validation**

At the top of `pages/api/orders.js`, add to the import list (line 7):

```javascript
import { PRODUCTS_BY_ID, deliveryFee } from '@/lib/products';
import { validateSchedule } from '@/lib/scheduling';
```

Replace the destructure at lines 106-113:

```javascript
    const {
      customer_name, phone, address, barangay,
      product_type, quantity,
      need_container, container_quantity,
      payment_method, gcash_number, reference_number, payment_screenshot,
      notes, reward_requested, reward_code,
      delivery_slot, delivery_date,
    } = parsed.data;
```

with:

```javascript
    const {
      customer_name, phone, address, barangay,
      product_type, quantity,
      need_container, container_quantity,
      payment_method, gcash_number, reference_number, payment_screenshot,
      notes, reward_requested, reward_code,
      has_empty_containers, pickupDate, pickupTime, deliveryDate, deliveryTime,
    } = parsed.data;

    const hasEmptyContainers = !!has_empty_containers;
    const today = new Date().toISOString().slice(0, 10);
    const scheduleCheck = validateSchedule({
      hasEmptyContainers, pickupDate, pickupTime, deliveryDate, deliveryTime, today,
    });
    if (!scheduleCheck.ok) {
      return res.status(400).json({ error: scheduleCheck.error });
    }
```

Place this new block immediately after the existing `if (!product) { return res.status(400)... }` check (currently lines 117-120), so pricing validation happens first, matching existing ordering.

- [ ] **Step 3: Update the delivery-fee computation (was based on `delivery_slot === 'pickup'`)**

Replace line 124:

```javascript
    const computedBase = refillSubtotal + containerSubtotal + (delivery_slot === 'pickup' ? 0 : deliveryFee(quantity));
```

with:

```javascript
    const computedBase = refillSubtotal + containerSubtotal + deliveryFee(quantity);
```

(The old `pickup` option meant "customer picks up themselves, no delivery" — that concept is superseded by this feature: every order now gets a scheduled delivery, so the fee waiver no longer applies. This matches the spec's scope: delivery-only vs refill-pickup both end in an actual delivery.)

- [ ] **Step 4: Update the INSERT statement**

Replace lines 186-205:

```javascript
    try {
      await sql`
        INSERT INTO orders (
          id, customer_name, phone, address, barangay,
          product_type, container_size, quantity,
          need_container, container_quantity,
          payment_method, gcash_number, reference_number, payment_screenshot,
          notes, total_amount, created_at,
          voucher_count, voucher_discount, reward_requested,
          phone_normalized, delivery_slot, delivery_date
        ) VALUES (
          ${id}, ${customer_name}, ${phone}, ${address}, ${barangay},
          ${product_type}, ${containerSize}, ${quantity},
          ${nc}, ${cq},
          ${payment_method}, ${gn}, ${rn}, ${ps},
          ${nt}, ${finalTotal}, ${created_at},
          ${voucher_count}, ${voucher_discount}, ${reward_requested_store},
          ${normPhone}, ${delivery_slot || null}, ${delivery_date || null}
        )
      `;
    } catch (err) {
      console.error('Order insert failed:', err);
      return res.status(500).json({ error: 'Failed to place order' });
    }

    return res.status(201).json({ id, created_at });
```

with:

```javascript
    const hec = hasEmptyContainers ? 1 : 0;
    const insertOrder = sql`
      INSERT INTO orders (
        id, customer_name, phone, address, barangay,
        product_type, container_size, quantity,
        need_container, container_quantity,
        payment_method, gcash_number, reference_number, payment_screenshot,
        notes, total_amount, created_at,
        voucher_count, voucher_discount, reward_requested,
        phone_normalized, has_empty_containers, pickup_date, pickup_time,
        delivery_date_new, delivery_time
      ) VALUES (
        ${id}, ${customer_name}, ${phone}, ${address}, ${barangay},
        ${product_type}, ${containerSize}, ${quantity},
        ${nc}, ${cq},
        ${payment_method}, ${gn}, ${rn}, ${ps},
        ${nt}, ${finalTotal}, ${created_at},
        ${voucher_count}, ${voucher_discount}, ${reward_requested_store},
        ${normPhone}, ${hec}, ${hasEmptyContainers ? pickupDate : null}, ${hasEmptyContainers ? pickupTime : null},
        ${deliveryDate}, ${deliveryTime}
      )
    `;

    try {
      if (hasEmptyContainers) {
        const pickupId = uuidv4().slice(0, 8).toUpperCase();
        const insertPickup = sql`
          INSERT INTO container_pickups (
            id, order_id, customer_name, phone, phone_normalized, address, barangay,
            container_qty, pickup_date, pickup_time, delivery_date, delivery_time,
            status, notes, messenger_psid, created_at, updated_at
          ) VALUES (
            ${pickupId}, ${id}, ${customer_name}, ${phone}, ${normPhone}, ${address}, ${barangay},
            ${quantity}, ${pickupDate}, ${pickupTime}, ${deliveryDate}, ${deliveryTime},
            'scheduled', '', NULL, ${created_at}, ${created_at}
          )
        `;
        await sql.transaction([insertOrder, insertPickup]);
      } else {
        await insertOrder;
      }
    } catch (err) {
      console.error('Order insert failed:', err);
      return res.status(500).json({ error: 'Failed to place order' });
    }

    return res.status(201).json({ id, created_at });
```

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`, then:

```bash
curl -s -X POST http://localhost:3000/api/orders -H "Content-Type: application/json" -d '{
  "customer_name":"Test User","phone":"09171234567","address":"123 St","barangay":"Brgy 1",
  "product_type":"slim5","container_size":"5-Gal","quantity":2,
  "payment_method":"cod","total_amount":0,
  "has_empty_containers":true,"pickupDate":"2026-07-04","pickupTime":"09:00",
  "deliveryDate":"2026-07-04","deliveryTime":"14:00"
}'
```

Expected: `201` with `{"id": "...", "created_at": "..."}`. Then verify a matching `container_pickups` row exists:

```bash
curl -s "http://localhost:3000/api/container-pickups" -H "password: $ADMIN_PASSWORD"
```

(This will 404/error until Task 6 creates the route — acceptable at this step; just confirm the order POST itself succeeds and doesn't throw. Re-run this same curl after Task 6 to confirm the row.)

- [ ] **Step 6: Commit**

```bash
git add pages/api/orders.js
git commit -m "feat: replace delivery_slot with structured pickup/delivery scheduling"
```

---

### Task 5: Order form — has-empty-containers toggle + pickup/delivery pickers

**Files:**
- Modify: `pages/order.js`

**Interfaces:**
- Consumes: `classifyPickupTime`, `computeAllowedDeliveryWindow`, `validateSchedule`, `DELIVERY_ONLY_START`, `DELIVERY_ONLY_END`, `PICKUP_MORNING_START`, `PICKUP_MORNING_END`, `PICKUP_AFTERNOON_START`, `PICKUP_AFTERNOON_END` from `lib/scheduling.js`

- [ ] **Step 1: Import scheduling helpers and update form state**

Add to the imports (after line 7):

```javascript
import {
  classifyPickupTime, computeAllowedDeliveryWindow, validateSchedule,
  PICKUP_MORNING_START, PICKUP_MORNING_END, PICKUP_AFTERNOON_START, PICKUP_AFTERNOON_END,
  DELIVERY_ONLY_START, DELIVERY_ONLY_END,
} from '@/lib/scheduling';
```

Replace the `delivery_slot`/`delivery_date` keys in the initial `useState` (lines 51-52):

```javascript
    delivery_slot: '',
    delivery_date: '',
```

with:

```javascript
    has_empty_containers: false,
    pickup_date: '',
    pickup_time: '',
    delivery_date: '',
    delivery_time: '',
```

- [ ] **Step 2: Update the total calculation (delivery fee no longer waived by a "pickup" slot)**

Replace line 97:

```javascript
  const delivery = form.delivery_slot === 'pickup' ? 0 : deliveryFee(form.quantity);
```

with:

```javascript
  const delivery = deliveryFee(form.quantity);
```

- [ ] **Step 3: Add derived schedule state and validation**

After the `set` helper (line 108), add:

```javascript
  const today = new Date().toISOString().slice(0, 10);
  const pickupSlot = classifyPickupTime(form.pickup_time);
  const showAfternoonNotice = form.has_empty_containers && pickupSlot === 'afternoon';
  const allowedDelivery = form.has_empty_containers
    ? computeAllowedDeliveryWindow({ pickupDate: form.pickup_date, pickupTime: form.pickup_time })
    : null;
  const scheduleCheck = validateSchedule({
    hasEmptyContainers: form.has_empty_containers,
    pickupDate: form.pickup_date || null,
    pickupTime: form.pickup_time || null,
    deliveryDate: form.delivery_date,
    deliveryTime: form.delivery_time,
    today,
  });

  // Auto-fill the locked delivery date whenever pickup changes to a valid slot.
  useEffect(() => {
    if (form.has_empty_containers && allowedDelivery && form.delivery_date !== allowedDelivery.date) {
      setForm((f) => ({ ...f, delivery_date: allowedDelivery.date }));
    }
  }, [form.has_empty_containers, allowedDelivery?.date]);
```

- [ ] **Step 4: Replace the "Preferred Delivery Time" card**

Replace the entire card at lines 420-442:

```javascript
          {/* Delivery Time */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Preferred Delivery Time</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'pickup', label: 'For Pickup', sub: 'I’ll get it myself' },
                { id: 'am', label: 'Morning', sub: '8AM–12PM' },
                { id: 'pm', label: 'Afternoon', sub: '1PM–5PM' },
              ].map((s) => (
                <label key={s.id} className={`flex flex-col rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.delivery_slot === s.id ? 'clay-tile-selected' : ''}`}>
                  <div className="flex items-center gap-2">
                    <input type="radio" name="delivery_slot" value={s.id} checked={form.delivery_slot === s.id} onChange={() => set('delivery_slot', s.id)} className="accent-clay-sky" />
                    <span className="font-semibold text-clay-ink">{s.label}</span>
                  </div>
                  <span className="text-xs text-clay-muted ml-6">{s.sub}</span>
                </label>
              ))}
            </div>
            <div className="mt-3">
              <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery date</label>
              <input type="date" value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} className="clay-input" />
            </div>
          </ClayCard>
```

with:

```javascript
          {/* Pickup & Delivery Scheduling */}
          <ClayCard className="p-6">
            <h2 className="text-lg font-editorial font-semibold text-clay-ink2 mb-4">Pickup &amp; Delivery</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-clay-ink2 mb-2">Do you have empty containers at home for us to pick up? *</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { id: true, label: 'Yes, pick them up' },
                    { id: false, label: 'No, deliver only' },
                  ].map((opt) => (
                    <label key={String(opt.id)} className={`flex items-center justify-center rounded-2xl px-4 py-3 cursor-pointer clay-tile ${form.has_empty_containers === opt.id ? 'clay-tile-selected' : ''}`}>
                      <input
                        type="radio"
                        name="has_empty_containers"
                        checked={form.has_empty_containers === opt.id}
                        onChange={() => setForm((f) => ({ ...f, has_empty_containers: opt.id, pickup_date: '', pickup_time: '', delivery_date: '', delivery_time: '' }))}
                        className="accent-clay-sky mr-2"
                      />
                      <span className="font-semibold text-clay-ink">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {form.has_empty_containers ? (
                <>
                  <div>
                    <label className="block text-sm font-medium text-clay-ink2 mb-1">Pickup date *</label>
                    <input required type="date" min={today} value={form.pickup_date} onChange={(e) => set('pickup_date', e.target.value)} className="clay-input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-clay-ink2 mb-1">Pickup time *</label>
                    <input
                      required
                      type="time"
                      min={PICKUP_MORNING_START}
                      max={PICKUP_AFTERNOON_END}
                      value={form.pickup_time}
                      onChange={(e) => set('pickup_time', e.target.value)}
                      className="clay-input"
                    />
                    <p className="text-xs text-clay-muted mt-1">Allowed: {PICKUP_MORNING_START}–{PICKUP_MORNING_END} AM or {PICKUP_AFTERNOON_START}–{PICKUP_AFTERNOON_END} PM.</p>
                    {form.pickup_time && !pickupSlot && (
                      <p className="text-clay-danger text-xs mt-1" role="alert">Please choose a time in the morning or afternoon window above.</p>
                    )}
                  </div>

                  {showAfternoonNotice && (
                    <div className="clay-inset rounded-xl p-3 text-sm text-clay-ink2" role="status">
                      We will try to pick up in the afternoon but delivery will be tomorrow.
                    </div>
                  )}

                  {allowedDelivery && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery date</label>
                        <input type="date" value={allowedDelivery.date} readOnly disabled className="clay-input opacity-70" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery time *</label>
                        <input
                          required
                          type="time"
                          min={allowedDelivery.minTime}
                          max={allowedDelivery.maxTime}
                          value={form.delivery_time}
                          onChange={(e) => set('delivery_time', e.target.value)}
                          className="clay-input"
                        />
                        <p className="text-xs text-clay-muted mt-1">Allowed: {allowedDelivery.minTime}–{allowedDelivery.maxTime}.</p>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery date *</label>
                    <input required type="date" min={today} value={form.delivery_date} onChange={(e) => set('delivery_date', e.target.value)} className="clay-input" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-clay-ink2 mb-1">Delivery time *</label>
                    <input required type="time" min={DELIVERY_ONLY_START} max={DELIVERY_ONLY_END} value={form.delivery_time} onChange={(e) => set('delivery_time', e.target.value)} className="clay-input" />
                    <p className="text-xs text-clay-muted mt-1">Allowed: {DELIVERY_ONLY_START}–{DELIVERY_ONLY_END}.</p>
                  </div>
                </>
              )}

              {!scheduleCheck.ok && (form.delivery_time || form.pickup_time) && (
                <p className="text-clay-danger text-xs" role="alert">{scheduleCheck.error}</p>
              )}
            </div>
          </ClayCard>
```

- [ ] **Step 5: Update submit payload and guard submit on schedule validity**

Replace lines 168-176:

```javascript
          ...form,
          container_size: selectedProduct.size,
          total_amount: baseTotal,
          reward_requested: rewardCount,
          reward_code: codeApplied ? codeInput : null,
          delivery_slot: form.delivery_slot || null,
          delivery_date: form.delivery_date || null,
```

with:

```javascript
          ...form,
          container_size: selectedProduct.size,
          total_amount: baseTotal,
          reward_requested: rewardCount,
          reward_code: codeApplied ? codeInput : null,
          has_empty_containers: form.has_empty_containers,
          pickupDate: form.has_empty_containers ? form.pickup_date : null,
          pickupTime: form.has_empty_containers ? form.pickup_time : null,
          deliveryDate: form.delivery_date,
          deliveryTime: form.delivery_time,
```

At the top of `handleSubmit` (after `setError('')` on line 162), add a client-side guard:

```javascript
    if (!scheduleCheck.ok) {
      setError(scheduleCheck.error);
      return;
    }
```

- [ ] **Step 6: Manual UI test**

Run: `npm run dev`, open `http://localhost:3000/order`.
1. Select "Yes, pick them up", pick a pickup time of `09:00` → confirm delivery date/time auto-locks to same day, `13:00`–`17:00`.
2. Change pickup time to `14:00` → confirm the afternoon notice appears and delivery date locks to tomorrow, `07:00`–`18:00`.
3. Select "No, deliver only" → confirm pickup fields disappear and delivery date/time are freely editable (today+, `07:00`–`18:00`).
4. Submit a valid order end-to-end and confirm it redirects to the confirmation page.

- [ ] **Step 7: Commit**

```bash
git add pages/order.js
git commit -m "feat: order form pickup/delivery scheduling UI"
```

---

### Task 6: Container Pickups API routes

**Files:**
- Create: `pages/api/container-pickups/index.js`
- Create: `pages/api/container-pickups/[id].js`
- Create: `pages/api/container-pickups/[id]/notify.js`

**Interfaces:**
- Consumes: `initDb` (`lib/db.js`), `verifyAdminWithLockout` (`lib/auth.js`), `rateLimit` (`lib/rate-limit.js`), `buildPickupStatusMessage`, `PICKUP_NOTIFIABLE_STATUSES` (`lib/notifications.js`, Task 3), `sendMessengerMessage` (`lib/facebook.js`), `normalizePhone` (`lib/loyalty.js`)
- Produces: `GET /api/container-pickups?status=&sort=`, `PATCH /api/container-pickups/[id]` (`{status}`), `DELETE /api/container-pickups/[id]`, `POST /api/container-pickups/[id]/notify` (`{channel: 'sms'|'messenger', status}`)

- [ ] **Step 1: Create `pages/api/container-pickups/index.js`**

```javascript
import { initDb } from '@/lib/db';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const statusFilter = req.query.status || '';
    const sortParam = req.query.sort || 'pickup_date_asc';

    const validStatuses = ['scheduled', 'picked_up', 'delivered', 'cancelled'];
    const hasStatus = validStatuses.includes(statusFilter);

    const sortMap = {
      pickup_date_asc: sql`pickup_date ASC, pickup_time ASC`,
      pickup_date_desc: sql`pickup_date DESC, pickup_time DESC`,
      status_asc: sql`status ASC`,
      name_asc: sql`customer_name ASC`,
      name_desc: sql`customer_name DESC`,
    };
    const orderBy = sortMap[sortParam] || sql`pickup_date ASC, pickup_time ASC`;

    const where = hasStatus ? sql`WHERE status = ${statusFilter}` : sql``;

    const [rows, statusRows] = await Promise.all([
      sql`SELECT * FROM container_pickups ${where} ORDER BY ${orderBy}`,
      sql`SELECT status, COUNT(*)::int AS count FROM container_pickups GROUP BY status`,
    ]);

    const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));
    return res.status(200).json({ pickups: rows, total: rows.length, statusCounts });
  } catch (err) {
    console.error('Container pickups list query failed:', err);
    return res.status(500).json({ error: 'Failed to load container pickups' });
  }
}
```

- [ ] **Step 2: Create `pages/api/container-pickups/[id].js`**

```javascript
import { initDb } from '@/lib/db';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const PatchSchema = z.object({
  status: z.enum(['scheduled', 'picked_up', 'delivered', 'cancelled']),
});

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  const { id } = req.query;

  if (req.method === 'PATCH') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data' });
    }
    const exists = await sql`SELECT id FROM container_pickups WHERE id = ${id}`;
    if (exists.length === 0) return res.status(404).json({ error: 'Pickup not found' });

    await sql`UPDATE container_pickups SET status = ${parsed.data.status}, updated_at = ${new Date().toISOString()} WHERE id = ${id}`;
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;

    const rows = await sql`SELECT status FROM container_pickups WHERE id = ${id}`;
    const pickup = rows[0];
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });
    if (!['delivered', 'cancelled'].includes(pickup.status)) {
      return res.status(400).json({ error: 'Only delivered or cancelled pickups can be deleted' });
    }
    await sql`DELETE FROM container_pickups WHERE id = ${id}`;
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 3: Create `pages/api/container-pickups/[id]/notify.js`**

```javascript
import { initDb } from '@/lib/db';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { sendMessengerMessage } from '@/lib/facebook';
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '@/lib/loyalty';
import { buildPickupStatusMessage } from '@/lib/notifications';
import { z } from 'zod';

const BodySchema = z.object({
  status: z.enum(['scheduled', 'picked_up', 'delivered']),
  channel: z.enum(['sms', 'messenger']),
});

const checkRate = rateLimit({ windowMs: 60_000, max: 20 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { status, channel } = parsed.data;

  try {
    const sql = await initDb();
    const { id } = req.query;
    const rows = await sql`SELECT * FROM container_pickups WHERE id = ${id}`;
    const pickup = rows[0];
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });

    const message = buildPickupStatusMessage(pickup, status, channel);
    if (!message) return res.status(400).json({ error: 'No message template for this status' });

    if (channel === 'messenger') {
      if (!pickup.messenger_psid) {
        return res.status(400).json({ error: 'No Messenger linked', message: 'Customer has not linked their Messenger account. Use SMS instead.' });
      }
      await sendMessengerMessage(pickup.messenger_psid, message);
    }

    const normPhone = normalizePhone(pickup.phone);
    try {
      await sql`
        INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
        VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${normPhone}, ${channel}, 'outbound', ${message}, ${pickup.order_id}, ${new Date().toISOString()})
      `;
    } catch (logErr) {
      console.error('Contact log insert failed:', logErr);
    }

    return res.status(200).json({ success: true, phone: pickup.phone, message });
  } catch (err) {
    console.error('Pickup notify error:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
```

- [ ] **Step 4: Manual smoke test**

Run: `npm run dev`, re-run the `container_pickups` curl from Task 4 Step 5:

```bash
curl -s "http://localhost:3000/api/container-pickups" -H "password: $ADMIN_PASSWORD"
```

Expected: `200` with `{"pickups":[{...the row created in Task 4...}], "total":1, "statusCounts":{"scheduled":1}}`.

Then:

```bash
curl -s -X PATCH "http://localhost:3000/api/container-pickups/<id>" -H "Content-Type: application/json" -H "password: $ADMIN_PASSWORD" -d '{"status":"picked_up"}'
curl -s -X POST "http://localhost:3000/api/container-pickups/<id>/notify" -H "Content-Type: application/json" -H "password: $ADMIN_PASSWORD" -d '{"status":"picked_up","channel":"sms"}'
```

Expected: both `200`; the notify call returns a `message` string mentioning the delivery date/time.

- [ ] **Step 5: Commit**

```bash
git add pages/api/container-pickups
git commit -m "feat: add container pickups admin API routes"
```

---

### Task 7: Container Pickups admin panel component

**Files:**
- Create: `components/admin/ContainerPickupsPanel.js`

**Interfaces:**
- Consumes: `savedPassword` prop (string, same shape as `POSPanel`'s prop)
- Produces: default-exported React component `ContainerPickupsPanel({ savedPassword })`

- [ ] **Step 1: Create the component**

```javascript
import { useState, useEffect } from 'react';
import ClayIcon from '../ui/ClayIcon';

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS = {
  scheduled: 'bg-yellow-100 text-yellow-700',
  picked_up: 'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

const DELETABLE_STATUSES = ['delivered', 'cancelled'];

const SORT_OPTIONS = [
  { value: 'pickup_date_asc', label: 'Pickup date (soonest first)' },
  { value: 'pickup_date_desc', label: 'Pickup date (latest first)' },
  { value: 'status_asc', label: 'Status' },
  { value: 'name_asc', label: 'Customer A–Z' },
  { value: 'name_desc', label: 'Customer Z–A' },
];

export default function ContainerPickupsPanel({ savedPassword }) {
  const [pickups, setPickups] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('pickup_date_asc');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [notifying, setNotifying] = useState(null);
  const [notifyModal, setNotifyModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);

  async function fetchPickups(overrides) {
    setLoading(true);
    const f = overrides?.filter ?? filter;
    const sort = overrides?.sortBy ?? sortBy;
    const params = new URLSearchParams({ sort });
    if (f && f !== 'all') params.set('status', f);
    const res = await fetch(`/api/container-pickups?${params}`, { headers: { password: savedPassword } });
    if (res.ok) {
      const data = await res.json();
      setPickups(data.pickups || []);
    }
    setLoading(false);
  }

  useEffect(() => { fetchPickups(); }, []);

  async function updateStatus(id, status) {
    setUpdating(id);
    await fetch('/api/container-pickups/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ status }),
    });
    await fetchPickups();
    setUpdating(null);
  }

  async function deletePickup(id) {
    setDeleting(id);
    await fetch('/api/container-pickups/' + id, { method: 'DELETE', headers: { password: savedPassword } });
    await fetchPickups();
    setDeleting(null);
    setDeleteModal(null);
  }

  async function notify(id, status, channel) {
    setNotifying(id + channel);
    const res = await fetch(`/api/container-pickups/${id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ status, channel }),
    });
    const data = await res.json();
    if (channel === 'sms' && data.message) {
      setNotifyModal(data);
    } else if (data.error) {
      setNotifyModal({ error: data.error, message: data.message });
    }
    setNotifying(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['all', ...STATUS_OPTIONS.map((s) => s.value)].map((v) => (
          <button
            key={v}
            onClick={() => { setFilter(v); fetchPickups({ filter: v }); }}
            className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (filter === v ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
          >
            {v === 'all' ? 'All' : STATUS_OPTIONS.find((s) => s.value === v)?.label}
          </button>
        ))}
        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); fetchPickups({ sortBy: e.target.value }); }}
          className="ml-auto text-xs font-semibold border border-gray-200 rounded-full px-3 py-1.5"
        >
          {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : pickups.length === 0 ? (
        <p className="text-sm text-gray-500">No container pickups scheduled.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Pickup</th>
                  <th className="py-2 pr-3">Delivery</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-gray-800">{p.customer_name}</div>
                      <a href={`tel:${p.phone}`} className="text-xs text-sky-600">{p.phone}</a>
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-600">{p.address}, {p.barangay}</td>
                    <td className="py-2 pr-3">{p.container_qty}</td>
                    <td className="py-2 pr-3 text-xs">{p.pickup_date} {p.pickup_time}</td>
                    <td className="py-2 pr-3 text-xs">{p.delivery_date} {p.delivery_time}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={p.status}
                        disabled={updating === p.id}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className={'text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ' + STATUS_COLORS[p.status]}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <button onClick={() => notify(p.id, p.status, 'sms')} disabled={notifying === p.id + 'sms'} title="Copy SMS message" className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                          SMS
                        </button>
                        {p.messenger_psid && (
                          <button onClick={() => notify(p.id, p.status, 'messenger')} disabled={notifying === p.id + 'messenger'} title="Send via Messenger" className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                            Messenger
                          </button>
                        )}
                        {DELETABLE_STATUSES.includes(p.status) && (
                          <button onClick={() => setDeleteModal(p)} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-2 py-1 rounded-full transition-colors">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {pickups.map((p) => (
              <div key={p.id} className="clay-raised-sm rounded-2xl p-4">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <div className="font-semibold text-gray-800">{p.customer_name}</div>
                    <a href={`tel:${p.phone}`} className="text-xs text-sky-600">{p.phone}</a>
                  </div>
                  <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ' + STATUS_COLORS[p.status]}>
                    {STATUS_OPTIONS.find((s) => s.value === p.status)?.label}
                  </span>
                </div>
                <p className="text-xs text-gray-600 mb-1">{p.address}, {p.barangay}</p>
                <p className="text-xs text-gray-600 mb-1">Qty: {p.container_qty}</p>
                <p className="text-xs text-gray-600 mb-1">Pickup: {p.pickup_date} {p.pickup_time}</p>
                <p className="text-xs text-gray-600 mb-2">Delivery: {p.delivery_date} {p.delivery_time}</p>
                <select
                  value={p.status}
                  disabled={updating === p.id}
                  onChange={(e) => updateStatus(p.id, e.target.value)}
                  className={'text-xs font-semibold px-2 py-1 rounded-full border-0 mb-2 ' + STATUS_COLORS[p.status]}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <div className="flex flex-wrap gap-1">
                  <button onClick={() => notify(p.id, p.status, 'sms')} disabled={notifying === p.id + 'sms'} className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                    Copy SMS
                  </button>
                  {p.messenger_psid && (
                    <button onClick={() => notify(p.id, p.status, 'messenger')} disabled={notifying === p.id + 'messenger'} className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                      Messenger
                    </button>
                  )}
                  {DELETABLE_STATUSES.includes(p.status) && (
                    <button onClick={() => setDeleteModal(p)} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-2 py-1 rounded-full transition-colors">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {notifyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="clay-raised rounded-3xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold text-sky-800 mb-1"><ClayIcon name="clipboard" className="w-5 h-5 inline mr-1" /> Send Notification</h2>
            {notifyModal.error ? (
              <p className="text-sm text-red-600">{notifyModal.message || notifyModal.error}</p>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-3">Copy and send via SMS, Viber, or Messenger:</p>
                <div className="clay-inset rounded-xl p-4 text-sm text-gray-700 mb-4 leading-relaxed">{notifyModal.message}</div>
                <button onClick={() => navigator.clipboard.writeText(notifyModal.message)} className="w-full border border-sky-300 text-sky-600 font-semibold py-2 rounded-full hover:bg-sky-50 transition-colors text-sm mb-2">
                  Copy Message
                </button>
              </>
            )}
            <button onClick={() => setNotifyModal(null)} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-full transition-colors text-sm">
              Close
            </button>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="clay-raised rounded-3xl p-6 max-w-sm w-full">
            <h2 className="text-lg font-bold text-red-700 mb-2">Delete pickup record?</h2>
            <p className="text-sm text-gray-500 mb-4">This removes the pickup record for {deleteModal.customer_name}. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(null)} className="flex-1 border border-gray-300 text-gray-600 font-semibold py-2 rounded-full text-sm">Cancel</button>
              <button onClick={() => deletePickup(deleteModal.id)} disabled={deleting === deleteModal.id} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50 text-sm">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/ContainerPickupsPanel.js
git commit -m "feat: add ContainerPickupsPanel admin component"
```

---

### Task 8: Wire the Container Pickups tab into AdminPanel

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `ContainerPickupsPanel` (Task 7), `savedPassword` (existing prop already threaded through `AdminPanel`)

- [ ] **Step 1: Import the new component**

After line 4 (`import POSPanel from './admin/POSPanel';`), add:

```javascript
import ContainerPickupsPanel from './admin/ContainerPickupsPanel';
```

- [ ] **Step 2: Add the tab button**

After the `route` tab button block (ends at line 758, right before the `inventory` tab button which starts at line ~760), add a new button following the exact same pattern as the `route` button (lines 753-759):

```javascript
            <button
              onClick={() => setActiveTab('pickups')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'pickups' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Pickups
            </button>
```

- [ ] **Step 3: Add the tab content render block**

After the `activeTab === 'pos'` block (lines 1953-1955), add:

```javascript
          {activeTab === 'pickups' && (
            <ContainerPickupsPanel savedPassword={savedPassword} />
          )}
```

- [ ] **Step 4: Update the Orders tab table to show the new date/time columns**

Delete line 26 (`const DELIVERY_SLOT_SHORT = { pickup: 'PICKUP', am: 'AM', pm: 'PM' };`) entirely — no longer used after the next replacements.

Replace line 1104:

```javascript
                                {DELIVERY_SLOT_SHORT[o.delivery_slot] || o.delivery_slot}{o.delivery_date ? ` · ${o.delivery_date}` : ''}
```

with:

```javascript
                                {o.has_empty_containers ? `Pickup ${o.pickup_date || ''} ${o.pickup_time || ''} · ` : ''}Delivery {o.delivery_date_new || ''} {o.delivery_time || ''}
```

Replace line 1844:

```javascript
                                {o.delivery_slot && <span className="text-[10px] font-semibold text-sky-600">{DELIVERY_SLOT_SHORT[o.delivery_slot] || o.delivery_slot}</span>}
```

with:

```javascript
                                {o.delivery_time && <span className="text-[10px] font-semibold text-sky-600">{o.delivery_date_new} {o.delivery_time}</span>}
```

- [ ] **Step 5: Manual UI test**

Run: `npm run dev`, log into `/admin`, confirm:
1. A "Pickups" tab appears next to Route/Inventory/POS.
2. Clicking it loads the pickup created during Task 4/6's smoke test, with correct pickup/delivery date+time.
3. Changing its status dropdown updates immediately (persists on refresh).
4. "SMS" button opens the copy modal with the correct message for the current status.
5. Once status is `delivered`, the "Delete" button appears and works.
6. Orders tab still renders without errors and shows the new "Pickup ... · Delivery ..." text where applicable.

- [ ] **Step 6: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat: add Container Pickups tab to admin panel"
```

---

## Self-Review Notes

- **Spec coverage:** order-type toggle (Task 5), date-before-time UI ordering (Task 5, date input rendered above time input in both branches), exact hour:minute picker via native `<input type="time">` (Task 5), afternoon popup notice (Task 5 Step 4), pickup-before-delivery invariant (Task 1 `validateSchedule`, enforced both client Task 5 and server Task 4), Container Pickups tab with sorting/SMS/Messenger/delete (Tasks 6–8) — all covered.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `validateSchedule`/`classifyPickupTime`/`computeAllowedDeliveryWindow` signatures match between Task 1's definition and Tasks 4/5's usage; `buildPickupStatusMessage(pickup, status, channel)` matches between Task 3's definition and Tasks 6's usage; `ContainerPickupsPanel({ savedPassword })` matches between Task 7's definition and Task 8's usage.
