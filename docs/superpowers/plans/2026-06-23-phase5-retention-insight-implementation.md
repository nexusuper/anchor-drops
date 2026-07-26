# Phase 5 — Retention & Insight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reorder alerts, full inventory tracking, and an admin dashboard to the Anchor Drops CRM.

**Architecture:** Three independent features over the existing virtual-customer/orders model. Reorder + dashboard are pure SQL-aggregate reads. Inventory adds two tables, three APIs, and one idempotent auto-deduct hook in the order-status PATCH. All UI lives in new tabs/sections of `components/AdminPanel.js`. Charts are inline SVG (no new dependency).

**Tech Stack:** Next.js 16 Pages Router, JavaScript, Neon Postgres (tagged-template `sql`), Zod, React.

## Global Constraints

- Next.js 16 Pages Router, JavaScript only (no TypeScript).
- Neon Postgres via `@neondatabase/serverless` tagged-template `sql` — NO `sql.unsafe()`, no ORM, no string interpolation into SQL.
- Every admin endpoint: `rateLimit()` then `verifyAdmin(req)` (password header) BEFORE any DB work; unauthorized → 401.
- New tables/columns added in `lib/db.js` `initDb()` via `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, each in try/catch.
- All request bodies validated with Zod; invalid → 400 with generic message; never leak internals (500 → generic message).
- Customer identity: `phone_normalized` via `normalizePhone` from `lib/loyalty.js`.
- Product ids: `slim5`, `round5`, `round3` (`lib/products.js` → `PRODUCTS`, `PRODUCTS_BY_ID`); `orders.product_type` holds the product id.
- Currency: PHP (₱).
- Charts: inline SVG/CSS only.
- No cron/scheduled jobs — compute on request.
- Date windows in Asia/Manila via `new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })` (matches Phase 4 route fix).
- Design system: `clay-raised`, `clay-raised-sm`, `clay-inset`, `clay-btn-primary`, `clay-btn-white`, `clay-pressable`, `clay-tile`; icons via `components/ui/ClayIcon.js`. Admin auth header is `savedPassword`; tabs switch via `activeTab`/`setActiveTab`.
- No automated test framework — "verify" = `npm run build` succeeds + manual admin check + code review.

---

### Task 1: Inventory schema + migrations

**Files:**
- Modify: `lib/db.js` (inside `initDb()`, before `initialized = true`)

**Interfaces:**
- Produces: tables `inventory(product_id PK, current_stock, low_stock_threshold, updated_at)`, `inventory_log(id PK, product_id, delta, type, reason, order_id, created_at)`; column `orders.inventory_deducted INTEGER DEFAULT 0`; seeded inventory rows for each product id.

- [ ] **Step 1: Add tables, column, index, and seed** — insert this block in `lib/db.js` immediately before `initialized = true;`:

```js
  try {
    await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_deducted INTEGER NOT NULL DEFAULT 0`;
  } catch (e) {}
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS inventory (
        product_id TEXT PRIMARY KEY,
        current_stock INTEGER NOT NULL DEFAULT 0,
        low_stock_threshold INTEGER NOT NULL DEFAULT 10,
        updated_at TEXT NOT NULL
      )
    `;
  } catch (e) {}
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS inventory_log (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        type TEXT NOT NULL,
        reason TEXT DEFAULT '',
        order_id TEXT,
        created_at TEXT NOT NULL
      )
    `;
  } catch (e) {}
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log (product_id)`;
  } catch (e) {}
  try {
    const now = new Date().toISOString();
    const ids = ['slim5', 'round5', 'round3'];
    for (const pid of ids) {
      await sql`
        INSERT INTO inventory (product_id, current_stock, low_stock_threshold, updated_at)
        VALUES (${pid}, 0, 10, ${now})
        ON CONFLICT (product_id) DO NOTHING
      `;
    }
  } catch (e) {}
```

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/db.js
git commit -m "feat(inventory): add inventory schema, deduct flag, and product seed"
```

---

### Task 2: Reorder cadence logic (`lib/reorder.js`)

**Files:**
- Create: `lib/reorder.js`

**Interfaces:**
- Produces: `computeReorderStatus(orders)` → `{ eligible: boolean, avgIntervalDays: number, daysSinceLast: number, status: 'ok'|'due'|'overdue' }`. `orders` is an array of objects each with a `created_at` ISO string; order within the array does not matter.

- [ ] **Step 1: Write `lib/reorder.js`**

```js
// Pure, isomorphic reorder-cadence logic. Safe for client or server import.

const DAY_MS = 86_400_000;

/**
 * Given a customer's orders (any order), compute their reorder cadence status.
 * Requires >= 2 orders with valid timestamps to be eligible.
 */
export function computeReorderStatus(orders) {
  const none = { eligible: false, avgIntervalDays: 0, daysSinceLast: 0, status: 'ok' };
  if (!Array.isArray(orders) || orders.length < 2) return none;

  const times = orders
    .map((o) => Date.parse(o.created_at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (times.length < 2) return none;

  const first = times[0];
  const last = times[times.length - 1];
  const avgIntervalDays = (last - first) / (times.length - 1) / DAY_MS;
  if (!Number.isFinite(avgIntervalDays) || avgIntervalDays <= 0) return none;

  const daysSinceLast = (Date.now() - last) / DAY_MS;

  let status = 'ok';
  if (daysSinceLast >= avgIntervalDays * 1.5) status = 'overdue';
  else if (daysSinceLast >= avgIntervalDays) status = 'due';

  return { eligible: true, avgIntervalDays, daysSinceLast, status };
}
```

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/reorder.js
git commit -m "feat(reorder): add pure cadence-status logic"
```

---

### Task 3: Reorder alerts API (`GET /api/customers/reorders`)

**Files:**
- Create: `pages/api/customers/reorders.js`

**Interfaces:**
- Consumes: `computeReorderStatus` from `lib/reorder.js`; `computeSegment` from `lib/segments.js`.
- Produces: `GET /api/customers/reorders` → `{ customers: [{ phone_normalized, phone_display, customer_name, last_order, total_orders, avgIntervalDays, daysSinceLast, daysOverdue, status, has_messenger }], count }`.

- [ ] **Step 1: Write `pages/api/customers/reorders.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeReorderStatus } from '@/lib/reorder';
import { computeSegment } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 60 });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const rows = await sql`
      SELECT phone_normalized, customer_name, phone, total_amount, created_at, messenger_psid
      FROM orders
      WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
      ORDER BY phone_normalized, created_at
    `;

    const groups = new Map();
    for (const o of rows) {
      const key = o.phone_normalized;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }

    const customers = [];
    for (const [phone, list] of groups.entries()) {
      const reorder = computeReorderStatus(list);
      if (!reorder.eligible || reorder.status === 'ok') continue;

      const latest = list.reduce((a, b) =>
        Date.parse(a.created_at) >= Date.parse(b.created_at) ? a : b
      );
      const totalSpent = list.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      const segment = computeSegment({
        total_orders: list.length,
        total_spent: totalSpent,
        last_order: latest.created_at,
      });
      if (segment === 'churned') continue;

      customers.push({
        phone_normalized: phone,
        phone_display: latest.phone,
        customer_name: latest.customer_name,
        last_order: latest.created_at,
        total_orders: list.length,
        avgIntervalDays: Math.round(reorder.avgIntervalDays * 10) / 10,
        daysSinceLast: Math.round(reorder.daysSinceLast * 10) / 10,
        daysOverdue: Math.round((reorder.daysSinceLast - reorder.avgIntervalDays) * 10) / 10,
        status: reorder.status,
        has_messenger: list.some((o) => o.messenger_psid),
      });
    }

    customers.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return res.status(200).json({ customers, count: customers.length });
  } catch (err) {
    console.error('Reorders query failed:', err);
    return res.status(500).json({ error: 'Failed to load reorder list' });
  }
}
```

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/customers/reorders.js
git commit -m "feat(reorder): add due-for-reorder API"
```

---

### Task 4: Inventory APIs (list, restock, adjust)

**Files:**
- Create: `pages/api/inventory/index.js`
- Create: `pages/api/inventory/restock.js`
- Create: `pages/api/inventory/adjust.js`

**Interfaces:**
- Produces:
  - `GET /api/inventory` → `{ items: [{ product_id, name, current_stock, low_stock_threshold, low_stock }], low_stock_count, log: [{ id, product_id, delta, type, reason, order_id, created_at }] }`
  - `POST /api/inventory/restock` body `{ product_id, quantity, reason? }` → `{ success, current_stock }`
  - `POST /api/inventory/adjust` body `{ product_id, delta, reason?, threshold? }` → `{ success, current_stock }`

- [ ] **Step 1: Write `pages/api/inventory/index.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS } from '@/lib/products';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const rows = await sql`SELECT * FROM inventory`;
    const byId = Object.fromEntries(rows.map((r) => [r.product_id, r]));

    const items = PRODUCTS.map((p) => {
      const inv = byId[p.id] || { current_stock: 0, low_stock_threshold: 10 };
      const stock = Number(inv.current_stock) || 0;
      const threshold = Number(inv.low_stock_threshold) || 0;
      return {
        product_id: p.id,
        name: p.name,
        current_stock: stock,
        low_stock_threshold: threshold,
        low_stock: stock <= threshold,
      };
    });
    const low_stock_count = items.filter((i) => i.low_stock).length;

    const log = await sql`SELECT * FROM inventory_log ORDER BY created_at DESC LIMIT 20`;

    return res.status(200).json({ items, low_stock_count, log });
  } catch (err) {
    console.error('Inventory query failed:', err);
    return res.status(500).json({ error: 'Failed to load inventory' });
  }
}
```

- [ ] **Step 2: Write `pages/api/inventory/restock.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS_BY_ID } from '@/lib/products';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

const PRODUCT_IDS = Object.keys(PRODUCTS_BY_ID);
const RestockSchema = z.object({
  product_id: z.enum(PRODUCT_IDS),
  quantity: z.coerce.number().int().min(1).max(10000),
  reason: z.string().max(200).optional().default(''),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = RestockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid restock data' });
  }
  const { product_id, quantity, reason } = parsed.data;

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const now = new Date().toISOString();
    const updated = await sql`
      UPDATE inventory
      SET current_stock = current_stock + ${quantity}, updated_at = ${now}
      WHERE product_id = ${product_id}
      RETURNING current_stock
    `;
    if (updated.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    await sql`
      INSERT INTO inventory_log (id, product_id, delta, type, reason, order_id, created_at)
      VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${product_id}, ${quantity}, 'restock', ${reason}, NULL, ${now})
    `;
    return res.status(201).json({ success: true, current_stock: updated[0].current_stock });
  } catch (err) {
    console.error('Restock failed:', err);
    return res.status(500).json({ error: 'Failed to restock' });
  }
}
```

- [ ] **Step 3: Write `pages/api/inventory/adjust.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS_BY_ID } from '@/lib/products';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

const PRODUCT_IDS = Object.keys(PRODUCTS_BY_ID);
const AdjustSchema = z.object({
  product_id: z.enum(PRODUCT_IDS),
  delta: z.coerce.number().int().min(-10000).max(10000),
  reason: z.string().max(200).optional().default(''),
  threshold: z.coerce.number().int().min(0).max(10000).optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = AdjustSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid adjustment data' });
  }
  const { product_id, delta, reason, threshold } = parsed.data;
  if (delta === 0 && threshold === undefined) {
    return res.status(400).json({ error: 'Nothing to adjust' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const now = new Date().toISOString();
    let current;
    if (threshold !== undefined) {
      const updated = await sql`
        UPDATE inventory
        SET current_stock = current_stock + ${delta}, low_stock_threshold = ${threshold}, updated_at = ${now}
        WHERE product_id = ${product_id}
        RETURNING current_stock
      `;
      if (updated.length === 0) return res.status(404).json({ error: 'Product not found' });
      current = updated[0].current_stock;
    } else {
      const updated = await sql`
        UPDATE inventory
        SET current_stock = current_stock + ${delta}, updated_at = ${now}
        WHERE product_id = ${product_id}
        RETURNING current_stock
      `;
      if (updated.length === 0) return res.status(404).json({ error: 'Product not found' });
      current = updated[0].current_stock;
    }
    if (delta !== 0) {
      await sql`
        INSERT INTO inventory_log (id, product_id, delta, type, reason, order_id, created_at)
        VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${product_id}, ${delta}, 'adjust', ${reason}, NULL, ${now})
      `;
    }
    return res.status(200).json({ success: true, current_stock: current });
  } catch (err) {
    console.error('Adjust failed:', err);
    return res.status(500).json({ error: 'Failed to adjust' });
  }
}
```

- [ ] **Step 4: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add pages/api/inventory/
git commit -m "feat(inventory): add list, restock, and adjust APIs"
```

---

### Task 5: Auto-deduct hook on delivery

**Files:**
- Modify: `pages/api/orders/[id].js` (inside the `status !== undefined` block, after the notify block, before `return res.status(200)`)

**Interfaces:**
- Consumes: `order` row (already fetched as `order` in the status block, has `inventory_deducted`, `product_type`, `quantity`), `sql`, `uuidv4`, `id` (all in scope).

- [ ] **Step 1: Add the deduct block** — in `pages/api/orders/[id].js`, inside `if (status !== undefined) { ... }`, immediately after the auto-notify `if (NOTIFIABLE_STATUSES.includes(status)) { ... }` block and before `return res.status(200).json({ success: true });`:

```js
      // Inventory auto-deduct on delivery (idempotent via inventory_deducted flag)
      if (status === 'delivered' && Number(order.inventory_deducted) === 0) {
        try {
          const qty = Number(order.quantity) || 0;
          const pid = order.product_type;
          if (qty > 0 && pid) {
            const inv = await sql`SELECT product_id FROM inventory WHERE product_id = ${pid}`;
            if (inv.length > 0) {
              const nowIso = new Date().toISOString();
              await sql`
                UPDATE inventory
                SET current_stock = current_stock - ${qty}, updated_at = ${nowIso}
                WHERE product_id = ${pid}
              `;
              await sql`
                INSERT INTO inventory_log (id, product_id, delta, type, reason, order_id, created_at)
                VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${pid}, ${-qty}, 'sale', '', ${id}, ${nowIso})
              `;
              await sql`UPDATE orders SET inventory_deducted = 1 WHERE id = ${id}`;
            } else {
              console.error('Inventory deduct skipped: no inventory row for product', pid);
            }
          }
        } catch (invErr) {
          console.error('Inventory auto-deduct failed:', invErr);
        }
      }
```

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/orders/[id].js
git commit -m "feat(inventory): auto-deduct stock on order delivery (idempotent)"
```

---

### Task 6: Dashboard API (`GET /api/dashboard`)

**Files:**
- Create: `pages/api/dashboard.js`

**Interfaces:**
- Produces: `GET /api/dashboard` → `{ kpis: { revenueThisMonth, ordersThisMonth, activeCustomers30d, avgOrderValue }, revenueSeries: [{ date, revenue, orders }], statusBreakdown: [{ status, count }], topBarangays: [{ barangay, count }], topCustomers: [{ customer_name, phone_display, total_spent, total_orders }] }`.

- [ ] **Step 1: Write `pages/api/dashboard.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 60 });

// YYYY-MM-DD in Asia/Manila
function manilaDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const today = manilaDate();
    const monthPrefix = today.slice(0, 7); // YYYY-MM

    // 30-day window: build the list of dates (oldest..today) in Manila tz
    const days = [];
    for (let i = 29; i >= 0; i--) {
      days.push(manilaDate(new Date(Date.now() - i * 86_400_000)));
    }
    const windowStart = days[0];

    // Pull orders created within the window (created_at is ISO; compare by date prefix).
    const recent = await sql`
      SELECT created_at, total_amount, status, phone_normalized
      FROM orders
      WHERE created_at >= ${windowStart}
    `;

    // KPIs (this calendar month, Manila)
    const monthOrders = recent.filter(
      (o) => manilaDate(new Date(o.created_at)).slice(0, 7) === monthPrefix && o.status !== 'cancelled'
    );
    const revenueThisMonth = monthOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const ordersThisMonth = monthOrders.length;
    const avgOrderValue = ordersThisMonth > 0 ? revenueThisMonth / ordersThisMonth : 0;
    const activeCustomers30d = new Set(
      recent.map((o) => o.phone_normalized).filter(Boolean)
    ).size;

    // Revenue series (zero-filled per day, Manila), excluding cancelled
    const seriesMap = new Map(days.map((d) => [d, { date: d, revenue: 0, orders: 0 }]));
    for (const o of recent) {
      if (o.status === 'cancelled') continue;
      const d = manilaDate(new Date(o.created_at));
      const entry = seriesMap.get(d);
      if (entry) {
        entry.revenue += Number(o.total_amount) || 0;
        entry.orders += 1;
      }
    }
    const revenueSeries = days.map((d) => {
      const e = seriesMap.get(d);
      return { date: d, revenue: Math.round(e.revenue * 100) / 100, orders: e.orders };
    });

    // Status breakdown (all-time)
    const statusRows = await sql`
      SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status ORDER BY count DESC
    `;
    const statusBreakdown = statusRows.map((r) => ({ status: r.status, count: Number(r.count) }));

    // Top barangays (all-time, by order count)
    const barangayRows = await sql`
      SELECT barangay, COUNT(*)::int AS count
      FROM orders
      WHERE barangay IS NOT NULL AND barangay <> ''
      GROUP BY barangay ORDER BY count DESC LIMIT 5
    `;
    const topBarangays = barangayRows.map((r) => ({ barangay: r.barangay, count: Number(r.count) }));

    // Top customers (all-time, by spend; exclude cancelled)
    const customerRows = await sql`
      SELECT phone_normalized,
             MAX(customer_name) AS customer_name,
             MAX(phone) AS phone_display,
             SUM(total_amount)::float AS total_spent,
             COUNT(*)::int AS total_orders
      FROM orders
      WHERE status <> 'cancelled' AND phone_normalized IS NOT NULL AND phone_normalized <> ''
      GROUP BY phone_normalized
      ORDER BY total_spent DESC
      LIMIT 5
    `;
    const topCustomers = customerRows.map((r) => ({
      customer_name: r.customer_name,
      phone_display: r.phone_display,
      total_spent: Math.round((Number(r.total_spent) || 0) * 100) / 100,
      total_orders: Number(r.total_orders),
    }));

    return res.status(200).json({
      kpis: {
        revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
        ordersThisMonth,
        activeCustomers30d,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
      },
      revenueSeries,
      statusBreakdown,
      topBarangays,
      topCustomers,
    });
  } catch (err) {
    console.error('Dashboard query failed:', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
}
```

> Note: `created_at` is stored as an ISO-8601 string (e.g. `2026-06-23T...`). Comparing `created_at >= 'YYYY-MM-DD'` is a correct lexicographic lower bound because ISO timestamps sort lexicographically. The window is intentionally generous (UTC vs Manila edge); per-row `manilaDate()` re-bucketing makes the series exact.

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add pages/api/dashboard.js
git commit -m "feat(dashboard): add KPI + analytics API"
```

---

### Task 7: ClayIcon additions

**Files:**
- Modify: `components/ui/ClayIcon.js`

**Interfaces:**
- Produces: icon names `chart`, `box`, `refresh` available to `<ClayIcon name="..." />`.

- [ ] **Step 1: Add three icon paths** — read `components/ui/ClayIcon.js` first and match its exact structure (it stores each icon as JSX path data keyed by name inside one `<svg>` with `stroke="currentColor"`). Add these three keys following that pattern, without changing existing icons:

```jsx
    chart: (
      <>
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </>
    ),
    box: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </>
    ),
    refresh: (
      <>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </>
    ),
```

- [ ] **Step 2: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/ClayIcon.js
git commit -m "feat(ui): add chart, box, refresh icons"
```

---

### Task 8: Dashboard tab (AdminPanel)

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `GET /api/dashboard`; admin header `savedPassword`; `activeTab`/`setActiveTab`.
- Produces: a `'dashboard'` tab rendering KPIs, revenue bar chart, status breakdown, top lists.

- [ ] **Step 1: Add state** — near the other `useState` declarations (after `savingContainer`):

```js
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
```

- [ ] **Step 2: Add fetch function** — alongside `fetchRoute`:

```js
  async function fetchDashboard() {
    setDashboardLoading(true);
    try {
      const res = await fetch('/api/dashboard', { headers: { password: savedPassword } });
      if (res.ok) setDashboard(await res.json());
    } catch (e) {
      // leave previous data
    } finally {
      setDashboardLoading(false);
    }
  }
```

- [ ] **Step 3: Trigger on tab open** — in the existing `useEffect` that watches `activeTab` (where `route` is fetched), add:

```js
    if (activeTab === 'dashboard' && authed) fetchDashboard();
```

- [ ] **Step 4: Add the tab button** — before the `orders` tab button (so Dashboard is leftmost/landing), mirroring the existing button markup:

```jsx
            <button
              onClick={() => setActiveTab('dashboard')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'dashboard' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              Dashboard
            </button>
```

- [ ] **Step 5: Add the tab panel** — alongside the other `activeTab === '...'` panels:

```jsx
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {dashboardLoading && !dashboard && (
                <p className="text-clay-ink/60 text-sm">Loading dashboard…</p>
              )}
              {dashboard && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {[
                      { label: 'Revenue (This Month)', value: '₱' + dashboard.kpis.revenueThisMonth.toLocaleString() },
                      { label: 'Orders (This Month)', value: dashboard.kpis.ordersThisMonth },
                      { label: 'Active Customers (30d)', value: dashboard.kpis.activeCustomers30d },
                      { label: 'Avg Order Value', value: '₱' + dashboard.kpis.avgOrderValue.toLocaleString() },
                    ].map((k) => (
                      <div key={k.label} className="clay-raised rounded-2xl p-4">
                        <p className="text-xs text-clay-ink/60 font-medium">{k.label}</p>
                        <p className="text-2xl font-bold text-sky-700 mt-1">{k.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="clay-raised rounded-2xl p-4">
                    <p className="text-sm font-semibold text-clay-ink mb-3">Revenue — last 30 days</p>
                    {(() => {
                      const max = Math.max(1, ...dashboard.revenueSeries.map((d) => d.revenue));
                      return (
                        <div className="flex items-end gap-[2px] h-32">
                          {dashboard.revenueSeries.map((d) => (
                            <div
                              key={d.date}
                              title={`${d.date}: ₱${d.revenue.toLocaleString()} (${d.orders} orders)`}
                              className="flex-1 bg-sky-400 hover:bg-sky-500 rounded-t transition-colors"
                              style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }}
                            />
                          ))}
                        </div>
                      );
                    })()}
                    <div className="flex justify-between text-[10px] text-clay-ink/50 mt-1">
                      <span>{dashboard.revenueSeries[0]?.date}</span>
                      <span>{dashboard.revenueSeries[dashboard.revenueSeries.length - 1]?.date}</span>
                    </div>
                  </div>

                  <div className="clay-raised rounded-2xl p-4">
                    <p className="text-sm font-semibold text-clay-ink mb-3">Orders by status</p>
                    {(() => {
                      const max = Math.max(1, ...dashboard.statusBreakdown.map((s) => s.count));
                      return (
                        <div className="space-y-2">
                          {dashboard.statusBreakdown.map((s) => (
                            <div key={s.status} className="flex items-center gap-2">
                              <span className="w-32 text-xs capitalize text-clay-ink/70">{s.status.replace(/_/g, ' ')}</span>
                              <div className="flex-1 bg-clay-inset rounded-full h-4 overflow-hidden">
                                <div className="bg-sky-400 h-full rounded-full" style={{ width: `${(s.count / max) * 100}%` }} />
                              </div>
                              <span className="w-8 text-right text-xs font-semibold text-clay-ink">{s.count}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="clay-raised rounded-2xl p-4">
                      <p className="text-sm font-semibold text-clay-ink mb-3">Top barangays</p>
                      <ul className="space-y-1.5">
                        {dashboard.topBarangays.map((b) => (
                          <li key={b.barangay} className="flex justify-between text-sm">
                            <span className="text-clay-ink/80">{b.barangay}</span>
                            <span className="font-semibold text-sky-700">{b.count}</span>
                          </li>
                        ))}
                        {dashboard.topBarangays.length === 0 && <li className="text-xs text-clay-ink/50">No data</li>}
                      </ul>
                    </div>
                    <div className="clay-raised rounded-2xl p-4">
                      <p className="text-sm font-semibold text-clay-ink mb-3">Top customers</p>
                      <ul className="space-y-1.5">
                        {dashboard.topCustomers.map((c) => (
                          <li key={c.phone_display} className="flex justify-between text-sm">
                            <span className="text-clay-ink/80 truncate mr-2">{c.customer_name}</span>
                            <span className="font-semibold text-sky-700 whitespace-nowrap">₱{c.total_spent.toLocaleString()}</span>
                          </li>
                        ))}
                        {dashboard.topCustomers.length === 0 && <li className="text-xs text-clay-ink/50">No data</li>}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 6: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(dashboard): add Dashboard tab with KPIs and charts"
```

---

### Task 9: Inventory tab (AdminPanel)

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `GET /api/inventory`, `POST /api/inventory/restock`, `POST /api/inventory/adjust`; `savedPassword`; `activeTab`.
- Produces: an `'inventory'` tab with per-product cards, restock/adjust controls, low-stock badges, and movement log.

- [ ] **Step 1: Add state**

```js
  const [inventory, setInventory] = useState(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [restockQty, setRestockQty] = useState({});
  const [adjustDelta, setAdjustDelta] = useState({});
  const [invSaving, setInvSaving] = useState(null);
```

- [ ] **Step 2: Add fetch + mutation functions**

```js
  async function fetchInventory() {
    setInventoryLoading(true);
    try {
      const res = await fetch('/api/inventory', { headers: { password: savedPassword } });
      if (res.ok) setInventory(await res.json());
    } catch (e) {
      // keep previous
    } finally {
      setInventoryLoading(false);
    }
  }

  async function restockProduct(productId) {
    const qty = parseInt(restockQty[productId], 10);
    if (!qty || qty < 1) return;
    setInvSaving(productId + ':restock');
    try {
      const res = await fetch('/api/inventory/restock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ product_id: productId, quantity: qty }),
      });
      if (res.ok) {
        setRestockQty((s) => ({ ...s, [productId]: '' }));
        await fetchInventory();
      }
    } finally {
      setInvSaving(null);
    }
  }

  async function adjustProduct(productId) {
    const delta = parseInt(adjustDelta[productId], 10);
    if (!delta || delta === 0) return;
    setInvSaving(productId + ':adjust');
    try {
      const res = await fetch('/api/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ product_id: productId, delta }),
      });
      if (res.ok) {
        setAdjustDelta((s) => ({ ...s, [productId]: '' }));
        await fetchInventory();
      }
    } finally {
      setInvSaving(null);
    }
  }
```

- [ ] **Step 3: Trigger on tab open** — in the `activeTab` `useEffect`:

```js
    if (activeTab === 'inventory' && authed) fetchInventory();
```

- [ ] **Step 4: Add the tab button** — after the `route` tab button, with a low-stock count badge:

```jsx
            <button
              onClick={() => setActiveTab('inventory')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors relative ' + (activeTab === 'inventory' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              Inventory
              {inventory?.low_stock_count > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center text-[10px] font-bold bg-rose-500 text-white rounded-full w-4 h-4">{inventory.low_stock_count}</span>
              )}
            </button>
```

- [ ] **Step 5: Add the tab panel**

```jsx
          {activeTab === 'inventory' && (
            <div className="space-y-6">
              {inventoryLoading && !inventory && (
                <p className="text-clay-ink/60 text-sm">Loading inventory…</p>
              )}
              {inventory && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {inventory.items.map((it) => (
                      <div key={it.product_id} className="clay-raised rounded-2xl p-4">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-clay-ink">{it.name}</p>
                          {it.low_stock && (
                            <span className="text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full px-2 py-0.5">LOW</span>
                          )}
                        </div>
                        <p className="text-3xl font-bold text-sky-700 mt-2">{it.current_stock}</p>
                        <p className="text-xs text-clay-ink/50">in stock · alert at {it.low_stock_threshold}</p>

                        <div className="mt-3 flex items-center gap-2">
                          <input
                            type="number" min="1" placeholder="Qty"
                            value={restockQty[it.product_id] || ''}
                            onChange={(e) => setRestockQty((s) => ({ ...s, [it.product_id]: e.target.value }))}
                            className="clay-inset rounded-lg px-2 py-1 w-20 text-sm"
                          />
                          <button
                            onClick={() => restockProduct(it.product_id)}
                            disabled={invSaving === it.product_id + ':restock'}
                            className="clay-btn-primary text-sm px-3 py-1 rounded-full disabled:opacity-50"
                          >
                            {invSaving === it.product_id + ':restock' ? '…' : 'Restock'}
                          </button>
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number" placeholder="+/−"
                            value={adjustDelta[it.product_id] || ''}
                            onChange={(e) => setAdjustDelta((s) => ({ ...s, [it.product_id]: e.target.value }))}
                            className="clay-inset rounded-lg px-2 py-1 w-20 text-sm"
                          />
                          <button
                            onClick={() => adjustProduct(it.product_id)}
                            disabled={invSaving === it.product_id + ':adjust'}
                            className="clay-btn-white text-sm px-3 py-1 rounded-full disabled:opacity-50"
                          >
                            {invSaving === it.product_id + ':adjust' ? '…' : 'Adjust'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="clay-raised rounded-2xl p-4">
                    <p className="text-sm font-semibold text-clay-ink mb-3">Recent movements</p>
                    {inventory.log.length === 0 ? (
                      <p className="text-xs text-clay-ink/50">No movements yet</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {inventory.log.map((l) => (
                          <li key={l.id} className="flex items-center justify-between text-sm border-b border-clay-ink/5 pb-1">
                            <span className="text-clay-ink/70">
                              <span className="capitalize font-medium">{l.type}</span>
                              {' · '}{l.product_id}
                              {l.order_id ? ` · #${l.order_id}` : ''}
                              {l.reason ? ` · ${l.reason}` : ''}
                            </span>
                            <span className={'font-semibold ' + (l.delta < 0 ? 'text-rose-600' : 'text-emerald-600')}>
                              {l.delta > 0 ? '+' : ''}{l.delta}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
```

- [ ] **Step 6: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(inventory): add Inventory tab with restock, adjust, and log"
```

---

### Task 10: Due-for-Reorder section (AdminPanel, in Customers tab)

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `GET /api/customers/reorders`, existing `POST /api/customers/[phone]/message`; `savedPassword`; `activeTab`.
- Produces: a "Due for Reorder" panel at the top of the Customers tab with one-tap Messenger nudge.

- [ ] **Step 1: Add state**

```js
  const [reorders, setReorders] = useState(null);
  const [reordersLoading, setReordersLoading] = useState(false);
  const [nudging, setNudging] = useState(null);
  const [showReorders, setShowReorders] = useState(false);
```

- [ ] **Step 2: Add fetch + nudge functions** — verify at implementation time that `POST /api/customers/[phone]/message` expects a `{ message }` body; if the existing quick-send handler uses a different field name, match it here:

```js
  async function fetchReorders() {
    setReordersLoading(true);
    try {
      const res = await fetch('/api/customers/reorders', { headers: { password: savedPassword } });
      if (res.ok) setReorders(await res.json());
    } catch (e) {
      // keep previous
    } finally {
      setReordersLoading(false);
    }
  }

  async function nudgeReorder(c) {
    setNudging(c.phone_normalized);
    try {
      const msg = `Hi ${c.customer_name}! 💧 It's been a while since your last Anchor Drops water delivery. Ready for a refill? Reply here to place your order!`;
      const res = await fetch(`/api/customers/${c.phone_normalized}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) {
        setMessageResult({ ok: true, text: `Nudged ${c.customer_name}` });
      } else {
        setMessageResult({ ok: false, text: 'Failed to send nudge' });
      }
    } catch (e) {
      setMessageResult({ ok: false, text: 'Failed to send nudge' });
    } finally {
      setNudging(null);
    }
  }
```

- [ ] **Step 3: Trigger on Customers tab open** — in the `useEffect` block where `activeTab === 'customers'` already triggers `fetchCustomers`/`fetchCustStats`, also call `fetchReorders()`.

- [ ] **Step 4: Add the panel** — at the top of the `activeTab === 'customers'` panel, above the customer list/stats:

```jsx
              {reorders && reorders.count > 0 && (
                <div className="clay-raised rounded-2xl p-4 mb-4">
                  <button
                    onClick={() => setShowReorders((v) => !v)}
                    className="w-full flex items-center justify-between"
                  >
                    <span className="text-sm font-semibold text-clay-ink">
                      🔔 Due for Reorder
                      <span className="ml-2 text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full px-2 py-0.5">{reorders.count}</span>
                    </span>
                    <span className="text-xs text-clay-ink/50">{showReorders ? 'Hide' : 'Show'}</span>
                  </button>
                  {showReorders && (
                    <ul className="mt-3 space-y-2">
                      {reorders.customers.map((c) => (
                        <li key={c.phone_normalized} className="flex items-center justify-between gap-2 clay-inset rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-clay-ink truncate">{c.customer_name}</p>
                            <p className="text-xs text-clay-ink/60">
                              {Math.round(c.daysOverdue)}d overdue · every ~{Math.round(c.avgIntervalDays)}d
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={'text-[10px] font-bold rounded-full px-2 py-0.5 ' + (c.status === 'overdue' ? 'bg-rose-500 text-white' : 'bg-amber-400 text-amber-900')}>
                              {c.status}
                            </span>
                            {c.has_messenger ? (
                              <button
                                onClick={() => nudgeReorder(c)}
                                disabled={nudging === c.phone_normalized}
                                className="clay-btn-primary text-xs px-3 py-1 rounded-full disabled:opacity-50"
                              >
                                {nudging === c.phone_normalized ? '…' : 'Nudge'}
                              </button>
                            ) : (
                              <a href={`tel:${c.phone_display}`} className="clay-btn-white text-xs px-3 py-1 rounded-full">Call</a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
```

- [ ] **Step 5: Verify build** — Run: `npm run build`. Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(reorder): add Due-for-Reorder panel with Messenger nudge"
```

---

## Self-Review

**Spec coverage:**
- Feature A (reorder): Task 2 (logic) + Task 3 (API) + Task 10 (UI) ✓
- Feature B (inventory): Task 1 (schema) + Task 4 (APIs) + Task 5 (auto-deduct) + Task 9 (UI) ✓
- Feature C (dashboard): Task 6 (API) + Task 8 (UI) ✓
- ClayIcon additions: Task 7 ✓
- All constraints (auth order, Zod, Manila tz, no cron, claymorphism, idempotent deduct) reflected ✓

**Placeholder scan:** No TBD/TODO. Two implementation-time verification notes (ClayIcon structure in Task 7, message field name in Task 10) point to reading the existing file to match its pattern — correctness checks, not missing content.

**Type consistency:** API response shapes in each API task match the field names consumed in the UI tasks (`dashboard.kpis.revenueThisMonth`, `inventory.items[].current_stock`, `reorders.customers[].daysOverdue`). `computeReorderStatus` signature consistent between Task 2 and Task 3.
