# Phase 5 — Retention & Insight Design

**Date:** 2026-06-23
**Status:** Approved
**Project:** Anchor Drops — purified water refill order/delivery CRM (Philippines)

## Goal

Add the final CRM phase: help the owner retain customers and understand the
business. Three independent features — reorder alerts, inventory tracking, and
an admin dashboard — all built on the existing virtual-customer / orders model
and the claymorphism design system.

## Global Constraints

- **Stack:** Next.js 16 Pages Router, JavaScript (no TypeScript), Neon Postgres
  via `@neondatabase/serverless` tagged-template `sql` (NO `sql.unsafe()`, no ORM).
- **Auth:** every admin endpoint calls `verifyAdmin(req)` (password header,
  timing-safe) and a per-IP `rateLimit()` before any DB work.
- **DB init/migrations:** new tables/columns added inline in `lib/db.js`
  `initDb()` using `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`,
  each wrapped in try/catch like the existing migrations.
- **Validation:** all request bodies validated with Zod; reject invalid with
  400 and a generic message (no internal error leakage).
- **Identity:** customers are virtual, keyed by `phone_normalized` (digits only,
  via `normalizePhone` from `lib/loyalty.js`).
- **Products:** ids are `slim5`, `round5`, `round3` (see `lib/products.js`,
  `PRODUCTS_BY_ID`). `orders.product_type` stores the product id.
- **Currency:** Philippine Pesos (₱ / PHP).
- **Charts:** inline SVG/CSS only — NO new charting dependency.
- **No cron / scheduled jobs:** every metric computes on page load (request time).
- **Design:** claymorphism classes (`clay-raised`, `clay-raised-sm`, `clay-inset`,
  `clay-btn-primary`, `clay-btn-white`, `clay-pressable`, `clay-tile`); icons via
  `components/ui/ClayIcon.js`.

---

## Feature A — Reorder Alerts (cadence-based, on-demand)

A "Due for Reorder" view listing customers overdue based on their own ordering
rhythm. No automation — the owner stays in control.

### Cadence logic — `lib/reorder.js` (pure, isomorphic)

`computeReorderStatus(orders)` takes a customer's orders (any order) and returns
`{ eligible, avgIntervalDays, daysSinceLast, status }` where:

- `eligible` is `false` when the customer has `< 2` orders (no cadence yet).
- `avgIntervalDays = (lastOrderMs - firstOrderMs) / (count - 1) / 86_400_000`,
  using `Date.parse` on `created_at`. If any timestamp is non-finite, treat the
  customer as not eligible.
- `daysSinceLast = (Date.now() - lastOrderMs) / 86_400_000`.
- `status`:
  - `'overdue'` when `daysSinceLast >= avgIntervalDays * 1.5`
  - `'due'` when `daysSinceLast >= avgIntervalDays`
  - `'ok'` otherwise
- Customers classified `'churned'` by `computeSegment` (no order in 90+ days) are
  excluded from the surfaced list (re-win problem, not a reorder nudge) — this
  exclusion happens in the API, not in the pure function.

### API — `GET /api/customers/reorders`

Admin-only, rate-limited (60/min). One SQL pass over `orders` ordered by phone +
date; group by `phone_normalized` in JS; for each group compute segment +
reorder status; keep only `eligible && status in ('due','overdue') && segment !=
'churned'`. Return array sorted most-overdue first (largest
`daysSinceLast - avgIntervalDays`), each item:
`{ phone_normalized, phone_display, customer_name, last_order, total_orders,
avgIntervalDays, daysSinceLast, daysOverdue, status, has_messenger }`.

### UI — "Due for Reorder" section

In the admin Customers area, a collapsible/section list: customer name, phone,
last-order date, "X days overdue" pill (amber for `due`, red for `overdue`), a
one-tap **Messenger nudge** button (only when `has_messenger`) that POSTs to the
existing `/api/customers/[phone]/message` endpoint with a friendly reorder
message, and a tap-to-call link for the rest. A count badge shows how many
customers are due.

---

## Feature B — Inventory Tracking (full)

Track filled-container stock per product, auto-deducted when orders are
delivered, with manual restock/adjust and low-stock alerts.

### Tables (in `lib/db.js`)

```sql
CREATE TABLE IF NOT EXISTS inventory (
  product_id TEXT PRIMARY KEY,
  current_stock INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 10,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_log (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  type TEXT NOT NULL,          -- 'restock' | 'sale' | 'adjust'
  reason TEXT DEFAULT '',
  order_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_log_product ON inventory_log (product_id);
```

Plus `ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_deducted INTEGER NOT
NULL DEFAULT 0`. On init, seed an `inventory` row for each product id in
`PRODUCTS` if missing (`current_stock` 0, `low_stock_threshold` 10).

### Auto-deduct hook (in `pages/api/orders/[id].js` PATCH)

When `status` transitions to `'delivered'` AND `order.inventory_deducted === 0`:
deduct `order.quantity` from `inventory.current_stock` for `order.product_type`,
insert an `inventory_log` row `{type:'sale', delta:-quantity, order_id}`, and set
`orders.inventory_deducted = 1`. Idempotent (the flag guards re-saves). Wrapped
in try/catch so an inventory failure never blocks the status update or notify —
same defensive pattern as the existing notify hook. If the product id has no
inventory row (unknown product), skip silently and log to console.

### APIs

- `GET /api/inventory` — admin-only. Returns each product with name (joined from
  `PRODUCTS_BY_ID`), `current_stock`, `low_stock_threshold`, `low_stock`
  (boolean: `current_stock <= threshold`), and recent log (last 20 rows overall
  or per product). Also returns `low_stock_count`.
- `POST /api/inventory/restock` — admin-only. Zod `{ product_id: enum of product
  ids, quantity: int 1..10000, reason?: string<=200 }`. Adds to stock, logs
  `type:'restock'`.
- `POST /api/inventory/adjust` — admin-only. Zod `{ product_id: enum, delta: int
  -10000..10000 (non-zero), reason?: string<=200 }`. Applies correction, logs
  `type:'adjust'`. Optionally allow updating `low_stock_threshold` via a separate
  field `threshold?: int 0..10000`.

All rate-limited (30/min). Stock is never forced below 0 by sale deduction, but
manual adjust may set any value (owner correction); guard restock/adjust math to
integers.

### UI — "Inventory" tab

Per-product `clay-raised` cards: product name, current stock (large), low-stock
warning badge (`clay` amber) when `low_stock`, an inline **Restock** control
(number + button), an **Adjust** control for corrections, and the threshold.
Below: a recent movement log (type, delta with sign, reason/order, date). The tab
header shows a count badge when any product is low.

---

## Feature C — Admin Dashboard (KPIs + charts)

A new **Dashboard** tab, the admin landing view, summarizing the business.

### API — `GET /api/dashboard`

Admin-only, rate-limited. Computes via SQL aggregates over `orders`
(all amounts in PHP, excludes `cancelled` from revenue):

- **KPIs:** `revenueThisMonth`, `ordersThisMonth`, `activeCustomers30d`
  (distinct `phone_normalized` with an order in last 30 days), `avgOrderValue`
  (this month).
- **revenueSeries:** last 30 days, one entry per day `{ date, revenue, orders }`
  (zero-filled for days with no orders), days computed in Asia/Manila timezone.
- **statusBreakdown:** count of orders by status.
- **topBarangays:** top 5 barangays by order count `{ barangay, count }`.
- **topCustomers:** top 5 by total spend `{ customer_name, phone_display,
  total_spent, total_orders }`.

"This month" and the 30-day window are computed in Asia/Manila (`en-CA`
date strings, matching the Phase 4 route timezone fix) so figures are correct on
UTC servers (Vercel).

### UI — "Dashboard" tab

- Four KPI stat cards (`clay-raised`) at top.
- 30-day **revenue bar chart** — inline SVG, one bar per day, height scaled to
  max; hover/tap shows the value; styled with claymorphism colors.
- **Status breakdown** — horizontal bar row with counts.
- **Top barangays** and **Top customers** lists side by side (stack on mobile).
- Responsive: cards/lists stack on small screens (`sm:` breakpoints), matching
  the Phase 4 mobile work.

---

## Components & file map

- Create: `lib/reorder.js`, `pages/api/customers/reorders.js`,
  `pages/api/inventory/index.js`, `pages/api/inventory/restock.js`,
  `pages/api/inventory/adjust.js`, `pages/api/dashboard.js`.
- Modify: `lib/db.js` (tables + seed + `inventory_deducted` column),
  `pages/api/orders/[id].js` (auto-deduct hook),
  `components/AdminPanel.js` (Dashboard tab, Inventory tab, Due-for-Reorder
  section), `components/ui/ClayIcon.js` (any new icons: chart/box/refresh).

## Error handling

- Inventory deduct hook never throws into the order flow (try/catch, console
  error, continue) — status update and notify must still succeed.
- All APIs return generic 500 messages on failure; never leak internals.
- Reorder + dashboard are pure reads; on DB error return 500
  "Service temporarily unavailable" / "Failed to load …".

## Testing

No automated test framework in this repo (per CLAUDE.md). Verification is:
`npm run build` clean, manual admin walkthrough (deliver an order → stock drops
once and only once; restock/adjust update stock + log; dashboard figures match
known data; reorder list shows expected overdue customers), and per-task code
review in the subagent-driven flow.

## Out of scope (YAGNI)

- True scheduled auto-reordering or auto-messaging (no cron).
- Per-customer container deposit accounting beyond existing container tracking.
- Multi-warehouse / multi-location inventory.
- Exportable analytics / date-range pickers on the dashboard (fixed windows only).
