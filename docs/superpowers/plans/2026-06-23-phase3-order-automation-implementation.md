# Phase 3 Order Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-notifications on status change, payment verification toggle, and delivery time slots to the order flow.

**Architecture:** Extract notification message templates into a shared `lib/notifications.js` (channel-aware). Hook auto-notify into the existing order status PATCH. Add four additive columns to `orders`. Surface new fields in the order form and admin panel.

**Tech Stack:** Next.js 16 (Pages Router), Neon Postgres (`@neondatabase/serverless`), React 19, Tailwind CSS 4, Zod, uuid

## Global Constraints

- JavaScript (no TypeScript)
- Auth: `verifyAdmin(req)` from `lib/auth.js` on all admin endpoints
- Rate limiting: existing `rateLimit()` instances
- Validation: Zod for request bodies
- DB: `initDb()` migration pattern with `ADD COLUMN IF NOT EXISTS`
- IDs: `uuidv4().slice(0,8).toUpperCase()`
- Timestamps: `new Date().toISOString()`
- Notify side effects must NEVER make the status update fail — wrap in try/catch, log only
- The extracted message text must match current output EXACTLY (SMS plain text; Messenger with emoji + `\n`)
- Currency: Philippine Pesos (PHP)

---

### Task 1: Shared Notifications Module

**Files:**
- Create: `lib/notifications.js`
- Modify: `pages/api/notify.js`
- Modify: `pages/api/messenger-notify.js`

**Interfaces:**
- Produces:
  - `NOTIFIABLE_STATUSES` — array `['confirmed', 'out_for_delivery', 'delivered', 'cancelled']`
  - `buildStatusMessage(order, status, channel)` — returns the message string. `channel` is `'sms'` or `'messenger'`. Returns `null` if no template for that status.

- [ ] **Step 1: Create `lib/notifications.js`**

The SMS and Messenger templates differ and BOTH must be preserved verbatim from the current code.

```js
// Per-status notification message templates, shared by manual and auto notify.
export const NOTIFIABLE_STATUSES = ['confirmed', 'out_for_delivery', 'delivered', 'cancelled'];

const SMS_MESSAGES = {
  confirmed: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) has been confirmed and is being prepared. We'll be on our way soon! 💧`,
  out_for_delivery: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) is now OUT FOR DELIVERY! 🛵 Our rider is heading to you. Please be available to receive it. Thank you!`,
  delivered: (name, id) =>
    `Hi ${name}! Your Anchor Drops water order (ID: ${id}) has been delivered. 🎉 Thank you for choosing Anchor Drops! Order again anytime.`,
  cancelled: (name, id) =>
    `Hi ${name}, your Anchor Drops water order (ID: ${id}) has been cancelled. Please call us at 0912-345-6789 if you have questions.`,
};

const MESSENGER_MESSAGES = {
  confirmed: (name, id) =>
    `✅ Hi ${name}! Your Anchor Drops water order (#${id}) has been confirmed and is being prepared.\n\nWe'll notify you when it's on the way! 💧`,
  out_for_delivery: (name, id) =>
    `🛵 Hi ${name}! Your Anchor Drops water order (#${id}) is now OUT FOR DELIVERY!\n\nOur rider is heading to you. Please be available to receive it. Thank you! 💧`,
  delivered: (name, id) =>
    `🎉 Hi ${name}! Your Anchor Drops water order (#${id}) has been delivered!\n\nThank you for choosing Anchor Drops! Order again anytime at our website. 💧`,
  cancelled: (name, id) =>
    `❌ Hi ${name}, your Anchor Drops water order (#${id}) has been cancelled.\n\nIf you have questions, please reply to this message or call us at 0912-345-6789.`,
};

export function buildStatusMessage(order, status, channel) {
  const table = channel === 'messenger' ? MESSENGER_MESSAGES : SMS_MESSAGES;
  const fn = table[status];
  return fn ? fn(order.customer_name, order.id) : null;
}
```

- [ ] **Step 2: Refactor `pages/api/notify.js` to use the shared module**

Remove the inline `const MESSAGES = {...}` block (lines 7-16). Add import at top:
```js
import { buildStatusMessage } from '@/lib/notifications';
```
Replace the validation line `if (!MESSAGES[status]) return res.status(400).json({ error: 'No message for this status' });` (line 30) with:
```js
  if (!buildStatusMessage({ customer_name: 'x', id: 'x' }, status, 'sms')) {
    return res.status(400).json({ error: 'No message for this status' });
  }
```
Replace line 38 (`const message = MESSAGES[status](order.customer_name, order.id);`) with:
```js
    const message = buildStatusMessage(order, status, 'sms');
```

- [ ] **Step 3: Refactor `pages/api/messenger-notify.js` to use the shared module**

Remove the inline `const MESSAGES = {...}` block (lines 8-17). Add import at top:
```js
import { buildStatusMessage } from '@/lib/notifications';
```
Replace the validation `if (!MESSAGES[status]) { ... }` (lines 34-36) with:
```js
  if (!buildStatusMessage({ customer_name: 'x', id: 'x' }, status, 'messenger')) {
    return res.status(400).json({ error: 'No message template for this status' });
  }
```
Replace line 54 (`const messageText = MESSAGES[status](order.customer_name, order.id);`) with:
```js
    const messageText = buildStatusMessage(order, status, 'messenger');
```

- [ ] **Step 4: Verify build and message parity**

Run: `npx next build`
Expected: Compiles successfully. The refactor is behavior-preserving — message text is byte-for-byte identical to before.

- [ ] **Step 5: Commit**

```bash
git add lib/notifications.js pages/api/notify.js pages/api/messenger-notify.js
git commit -m "refactor(notify): extract shared notification templates to lib/notifications.js"
```

---

### Task 2: Database Migrations

**Files:**
- Modify: `lib/db.js`

**Interfaces:**
- Produces: `orders` table gains `sms_pending` (int, default 0), `payment_verified` (int, default 0), `delivery_slot` (text), `delivery_date` (text).

- [ ] **Step 1: Add migration blocks to `initDb()`**

In `lib/db.js`, after the existing `reward_requested` / `phone_normalized` migration try/catch blocks (the ones that `ALTER TABLE orders ADD COLUMN IF NOT EXISTS ...`), add four more in the same style:

```js
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS sms_pending INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_slot TEXT`;
  } catch (e) {}
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date TEXT`;
  } catch (e) {}
```

- [ ] **Step 2: Verify dev server starts and migrations run**

Run: `npm run dev`, then load `/admin` and log in to trigger `initDb()`.
Expected: No SQL errors in the console.

- [ ] **Step 3: Commit**

```bash
git add lib/db.js
git commit -m "feat(orders): add sms_pending, payment_verified, delivery_slot, delivery_date columns"
```

---

### Task 3: Auto-notify + Payment Verification in Order PATCH

**Files:**
- Modify: `pages/api/orders/[id].js`
- Modify: `pages/api/notify.js`

**Interfaces:**
- Consumes: `buildStatusMessage`, `NOTIFIABLE_STATUSES` from `lib/notifications.js`; `sendMessengerMessage` from `lib/facebook.js`; `normalizePhone` from `lib/loyalty.js`; `uuid`
- Produces: `PATCH /api/orders/[id]` auto-notifies on status change and accepts `payment_verified`. `POST /api/notify` clears `sms_pending`.

- [ ] **Step 1: Add imports to `pages/api/orders/[id].js`**

At the top, add:
```js
import { buildStatusMessage, NOTIFIABLE_STATUSES } from '@/lib/notifications';
import { sendMessengerMessage } from '@/lib/facebook';
import { v4 as uuidv4 } from 'uuid';
```
(`normalizePhone` is already imported.)

- [ ] **Step 2: Rework the PATCH handler for status + payment_verified + auto-notify**

Replace the entire PATCH block (currently lines 50-62, the `if (req.method === 'PATCH') {...}` block) with:

```js
  if (req.method === 'PATCH') {
    if (!adminRate(req, res)) return;
    if (!verifyAdmin(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { status, payment_verified } = req.body;

    // Payment verification toggle (independent of status)
    if (payment_verified !== undefined) {
      if (typeof payment_verified !== 'boolean') {
        return res.status(400).json({ error: 'payment_verified must be a boolean' });
      }
      await sql`UPDATE orders SET payment_verified = ${payment_verified ? 1 : 0} WHERE id = ${id}`;
      if (status === undefined) {
        return res.status(200).json({ success: true });
      }
    }

    if (status !== undefined) {
      const valid = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
      if (!valid.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const rows = await sql`SELECT * FROM orders WHERE id = ${id}`;
      const order = rows[0];
      if (!order) return res.status(404).json({ error: 'Order not found' });

      await sql`UPDATE orders SET status = ${status} WHERE id = ${id}`;

      // Auto-notify on notifiable status changes
      if (NOTIFIABLE_STATUSES.includes(status)) {
        if (order.messenger_psid) {
          try {
            const text = buildStatusMessage(order, status, 'messenger');
            await sendMessengerMessage(order.messenger_psid, text);
            await sql`
              INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
              VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${normalizePhone(order.phone)}, 'messenger', 'outbound', ${text}, ${id}, ${new Date().toISOString()})
            `;
          } catch (notifyErr) {
            console.error('Auto Messenger notify failed:', notifyErr);
          }
        } else {
          try {
            await sql`UPDATE orders SET sms_pending = 1 WHERE id = ${id}`;
          } catch (flagErr) {
            console.error('Set sms_pending failed:', flagErr);
          }
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Nothing to update' });
  }
```

- [ ] **Step 3: Clear `sms_pending` in `pages/api/notify.js`**

In `notify.js`, after the contact_log insert try/catch (after line 49), before `return res.status(200).json({ phone, message });`, add:

```js
    try {
      await sql`UPDATE orders SET sms_pending = 0 WHERE id = ${orderId}`;
    } catch (clearErr) {
      console.error('Clear sms_pending failed:', clearErr);
    }
```

- [ ] **Step 4: Verify build**

Run: `npx next build`
Expected: Compiles successfully.

- [ ] **Step 5: Commit**

```bash
git add pages/api/orders/[id].js pages/api/notify.js
git commit -m "feat(orders): auto-notify on status change and payment verification toggle"
```

---

### Task 4: Delivery Slots — Order Form & APIs

**Files:**
- Modify: `pages/order.js`
- Modify: `pages/api/orders.js`
- Modify: `pages/api/fb-orders.js`
- Modify: `pages/order/confirmation.js`

**Interfaces:**
- Consumes: nothing new
- Produces: `POST /api/orders` accepts and stores `delivery_slot` (`'am'|'pm'`) and `delivery_date` (string). `fb-orders` accepts optional `delivery_slot`.

- [ ] **Step 1: Add delivery slot fields to the order form (`pages/order.js`)**

First read `pages/order.js` to find the form state object and the order-submit POST body. The form uses a single state object for fields. Add `delivery_slot: ''` and `delivery_date: ''` to the initial form state.

Add this field group in the form JSX, after the address/barangay fields and before the payment section (match the existing field wrapper styling — find an existing labeled field and copy its wrapper classes):

```jsx
<div>
  <label className="block text-sm font-semibold text-clay-ink mb-1">Preferred Delivery Time</label>
  <div className="flex gap-3">
    <label className="flex-1 flex items-center gap-2 clay-inset rounded-xl px-3 py-2 cursor-pointer">
      <input
        type="radio"
        name="delivery_slot"
        value="am"
        checked={form.delivery_slot === 'am'}
        onChange={(e) => setForm({ ...form, delivery_slot: e.target.value })}
      />
      <span className="text-sm">Morning (8AM–12PM)</span>
    </label>
    <label className="flex-1 flex items-center gap-2 clay-inset rounded-xl px-3 py-2 cursor-pointer">
      <input
        type="radio"
        name="delivery_slot"
        value="pm"
        checked={form.delivery_slot === 'pm'}
        onChange={(e) => setForm({ ...form, delivery_slot: e.target.value })}
      />
      <span className="text-sm">Afternoon (1PM–5PM)</span>
    </label>
  </div>
  <input
    type="date"
    value={form.delivery_date}
    onChange={(e) => setForm({ ...form, delivery_date: e.target.value })}
    className="clay-input w-full mt-2"
  />
  <p className="text-xs text-clay-muted mt-1">Leave date blank for ASAP / today.</p>
</div>
```

In the POST body sent to `/api/orders`, include `delivery_slot: form.delivery_slot || null` and `delivery_date: form.delivery_date || null`.

- [ ] **Step 2: Update the Zod schema and INSERT in `pages/api/orders.js`**

In the `OrderSchema` (after the `reward_code` field, around line 28), add:
```js
  delivery_slot: z.enum(['am', 'pm']).optional().nullable(),
  delivery_date: z.string().max(20).optional().nullable(),
```

Find the `INSERT INTO orders (...)` statement in the POST handler. Read the file to confirm the validated-data variable name. Add `delivery_slot` and `delivery_date` to the column list and the corresponding `${...delivery_slot || null}`, `${...delivery_date || null}` to the VALUES list.

- [ ] **Step 3: Accept `delivery_slot` in `pages/api/fb-orders.js`**

In `FbOrderSchema` (after the `notes` field, line 28), add:
```js
  delivery_slot: z.enum(['am', 'pm']).optional(),
```
In the `INSERT INTO orders (...)` statement, add `delivery_slot` to the column list and `${b.delivery_slot || null}` to the VALUES list (the validated data variable is `b`).

- [ ] **Step 4: Show slot on the confirmation page (`pages/order/confirmation.js`)**

Read `pages/order/confirmation.js` to find where order details are displayed. Where order fields are shown, add a conditional summary row (match the existing summary-row markup):
```jsx
{order.delivery_slot && (
  <div className="flex justify-between">
    <span className="text-clay-muted">Delivery Time</span>
    <span className="font-semibold">{order.delivery_slot === 'am' ? 'Morning (8AM–12PM)' : 'Afternoon (1PM–5PM)'}{order.delivery_date ? ` · ${order.delivery_date}` : ''}</span>
  </div>
)}
```

- [ ] **Step 5: Verify build and a test order**

Run: `npm run dev`. Place a test order from `/order` selecting AM, submit. Confirm it succeeds and the confirmation shows the slot.
Run: `npx next build` — compiles successfully.

- [ ] **Step 6: Commit**

```bash
git add pages/order.js pages/api/orders.js pages/api/fb-orders.js pages/order/confirmation.js
git commit -m "feat(orders): add AM/PM delivery time slots to order form and APIs"
```

---

### Task 5: Admin Panel UI — Badges, Toggle, Slot Display

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `PATCH /api/orders/[id]` with `{ payment_verified }`; order fields `sms_pending`, `payment_verified`, `delivery_slot`, `delivery_date`

- [ ] **Step 1: Add a payment-verify toggle handler**

After the existing `updateStatus` function in `components/AdminPanel.js`, add:

```js
async function togglePaymentVerified(id, verified) {
  await fetch('/api/orders/' + id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', password: savedPassword },
    body: JSON.stringify({ payment_verified: verified }),
  });
  await fetchOrders();
}
```

- [ ] **Step 2: Show "SMS reminder pending" badge in the Status column**

In the orders table Status cell (where the status `<select>` is rendered), add below the select:
```jsx
{o.sms_pending ? (
  <div className="text-[10px] font-semibold text-amber-600 mt-1">SMS reminder pending</div>
) : null}
```

- [ ] **Step 3: Show payment verification in the Payment column**

In the Payment cell (where `o.payment_method` and `o.reference_number` render), add for non-COD orders:
```jsx
{(o.payment_method === 'gcash' || o.payment_method === 'paymaya') && (
  <label className="flex items-center gap-1 mt-1 cursor-pointer">
    <input
      type="checkbox"
      checked={!!o.payment_verified}
      onChange={(e) => togglePaymentVerified(o.id, e.target.checked)}
      className="w-3.5 h-3.5 accent-green-500"
    />
    <span className={'text-[10px] font-semibold ' + (o.payment_verified ? 'text-green-600' : 'text-amber-600')}>
      {o.payment_verified ? 'Verified' : 'Unverified'}
    </span>
  </label>
)}
```

- [ ] **Step 4: Show delivery slot in the Order/Date column**

In the Date cell (where `o.created_at` is formatted), add below it:
```jsx
{o.delivery_slot ? (
  <div className="text-[10px] font-semibold text-sky-600">
    {o.delivery_slot === 'am' ? 'AM' : 'PM'}{o.delivery_date ? ` · ${o.delivery_date}` : ''}
  </div>
) : null}
```

- [ ] **Step 5: Verify in browser**

Run `npm run dev`, go to `/admin`, login.
- Change a Messenger customer's order status → message auto-sends (check contact log in their customer detail).
- Change a non-Messenger order's status → "SMS reminder pending" badge appears; click the SMS button → badge clears.
- Toggle payment verified on a GCash order → badge flips Verified/Unverified.
- Orders with a delivery slot show AM/PM.

- [ ] **Step 6: Verify build**

Run: `npx next build`
Expected: Compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(admin): sms_pending badge, payment verify toggle, delivery slot display"
```
