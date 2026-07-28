# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (Next.js on port 3000)
npm run build    # Production build
npm run lint     # ESLint
```

Remotion (video asset pipeline):
```bash
npm run remotion        # Open Remotion Studio (interactive preview)
npm run render:video    # Render public/purify-process.mp4
npm run render:poster   # Render public/purify-process-poster.jpg
```

No test framework is configured. `scripts/` has a couple of plain-Node assertion scripts, run directly:

```bash
node scripts/loyalty.test.mjs
node scripts/reward-codes.test.mjs   # requires REWARD_CODE_SECRET in env
```

## Architecture

**Anchor Drops** is an order-and-delivery management app for a purified water refill business in the Philippines. Customers place orders through a public storefront; the business owner manages orders, customers, and notifications through a password-protected admin panel.

### Stack

- **Next.js 16** (Pages Router) — JavaScript, no TypeScript
- **Supabase Postgres** via `@supabase/supabase-js` (v2), server-only service_role client (no ORM)
- **Tailwind CSS v4** with a custom "claymorphism" design system
- **Zod** for API input validation
- **Facebook Messenger API** for order notifications and webhook intake
- **Deployed on Vercel** (linked project: `nexusupers-projects/anchor-drops`). The live URL is still `clear-flow-nine.vercel.app`: renaming the project did not move that alias, and it is the host the Facebook Messenger webhook points at, so it stays until an `anchor-drops` alias is added and the Meta app dashboard is re-pointed.

### Pages Router layout

- `pages/_app.js` — global fonts (Fredoka + Nunito), Facebook Pixel, Messenger floating button
- `pages/index.js` — public landing page
- `pages/order.js` — customer order form
- `pages/order/confirmation.js` — post-order confirmation
- `pages/track.js` — order tracking by phone
- `pages/rewards.js` — loyalty rewards lookup
- `pages/products.js` — product catalog
- `pages/admin/index.js` — admin panel entry (client-rendered via `next/dynamic`, no SSR), renders `components/AdminPanel.js` — orders, customers/CRM, inventory, and the POS counter-sale flow (`components/admin/POSPanel.js`) all live inside this one client component

### API routes (`pages/api/`)

Public routes follow: rate limit → Zod validation → Supabase query/RPC. Admin routes use `await verifyAdminWithLockout(req, res)` instead of the bare `verifyAdmin` — the pattern differs slightly from public routes.

Writes go through Postgres RPCs, not raw SQL:
- `create_order` — called by `orders.js`, `orders/pos.js`, `fb-orders.js`. **Authoritative for pricing**: callers deliberately pass `p_total_amount: 0`; the RPC computes the real total from the `products` table and `app_settings.delivery_fee_tiers` server-side. Don't "fix" the 0 — it's not a bug.
- `adjust_inventory` — called by `inventory/adjust.js`, `inventory/restock.js`, `orders/[id].js`, `orders/pos.js`.

`customers/stats.js`, `customers/index.js`, and `customers/export.js` read from a DB-side `customer_stats` view rather than computing aggregates in JS.

- `orders.js` — CRUD for orders (GET lists for admin, POST creates)
- `orders/[id].js` — single order read/update/delete
- `orders/[id]/apply-reward.js` — apply loyalty voucher to order
- `orders/bulk-delete.js` — batch delete delivered/cancelled orders
- `orders/pos.js` — create an in-person counter sale (POS), bypasses the public order rate limit
- `orders/delivery-route.js` — admin GET of today's active deliveries grouped by barangay, served at `/api/orders/delivery-route`. (Was `orders/route.js`, but Next 16 reserves the `route.js` filename for the App Router and mis-registered the Pages handler, so every call 500'd — renamed to fix.)
- `customers/index.js` — paginated customer list with search/sort
- `customers/[phone].js` — single customer detail
- `customers/[phone]/notes/` — CRUD for customer notes
- `customers/[phone]/contact-log.js` — contact log entries
- `customers/[phone]/container-adjust.js` — manual adjustment of a customer's returnable-container balance
- `customers/[phone]/message.js` — send an ad-hoc Messenger message to a customer
- `customers/stats.js` — aggregate customer statistics
- `customers/reorders.js` — customers due/overdue for reorder, from `lib/reorder.js` cadence logic
- `customers/tags.js` — customer segment tags, from `lib/segments.js`
- `customers/export.js` — CSV export of customers
- `dashboard.js` — aggregate admin dashboard metrics
- `inventory/index.js` / `inventory/adjust.js` / `inventory/restock.js` — stock levels, manual adjustments, restocking
- `rewards.js` — loyalty balance lookup
- `rewards/send-code.js` / `rewards/verify-code.js` — OTP-based reward code flow
- `notify.js` / `messenger-notify.js` — order status notifications via Messenger
- `messenger-webhook.js` — Facebook webhook (signature verification, PSID capture)
- `fb-orders.js` — webhook intake for orders from ManyChat/Facebook

### Key libs (`lib/`)

- `supabaseAdmin.js` — exports `getSupabase()`, a memoized service_role `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)`. Server-only, bypasses RLS — never import into browser code. No anon client exists.
- `auth.js` — timing-safe admin password comparison (`verifyAdmin`) + `verifyAdminWithLockout(req, res)` which adds DB-backed IP lockout (5 failures → 15-min block, clears on success). Use `verifyAdminWithLockout` on all new admin routes.
- `loyalty.js` — pure loyalty math (gallon counting, voucher computation) — isomorphic, safe for client import
- `reward-codes.js` — server-only OTP generation and hashing
- `facebook.js` — Messenger Send API helpers + webhook signature verification
- `products.js` — product catalog constants and delivery fee schedule
- `rate-limit.js` — in-memory per-IP rate limiter
- `notifications.js` — per-order-status Messenger message templates, shared by manual and automatic notify flows
- `reorder.js` — pure, isomorphic reorder-cadence logic (needs ≥2 orders with timestamps to compute a customer's due/overdue status)
- `segments.js` — isomorphic customer segment definitions (new/regular/vip/at-risk/churned) used by both API and UI

### Design system

The UI uses a custom "claymorphism" (soft 3D) style defined in `styles/globals.css`:
- Color tokens: `clay-bg`, `clay-surface`, `clay-ink`, `clay-sky`, `clay-skydeep`, etc.
- Surface classes: `clay-raised`, `clay-raised-sm`, `clay-inset`
- Button classes: `clay-btn-primary`, `clay-btn-white`, `clay-pressable`
- Reusable components in `components/ui/`: `ClayButton`, `ClayCard`, `ClayIcon`

### Auth model

Admin endpoints are protected by `verifyAdmin(req)` which compares `req.headers['password']` against `ADMIN_PASSWORD` env var using timing-safe comparison. There are no user accounts or sessions — customers order as guests identified by phone number.

### Database

**Schema lives outside this repo** — in the sibling staff-app repo `anchor-drops-system`, as SQL migrations under `supabase/migrations/*.sql` (0001..0016). This repo has zero `.sql` files and no runtime table creation; schema changes go in `anchor-drops-system`, not here.

Live tables (non-exhaustive): `orders`, `customers`, `customer_addresses`, `branches`, `profiles`, `products`, `inventory`, `inventory_log`, `container_ledger`, `container_pickups`, `customer_notes`, `contact_log`, `payments`, `proof_of_delivery`, `reward_codes`, `activity_logs`, `app_settings`, `expenses`, `suppliers`, `machines`, `production_logs`, `quality_tests`, `maintenance_logs`, `cash_reconciliations`, `sync_conflicts`. RLS is enabled on all of them; the service_role client in `lib/supabaseAdmin.js` bypasses it. Most tables carry `branch_id` (multi-branch). Phone numbers are normalized (digits only) and indexed as `phone_normalized`.

Payment screenshots are stored in Supabase Storage, bucket `payment-screenshots`; only the storage path is persisted in `orders.payment_screenshot_path` and resolved to short-lived signed URLs on read.

### Environment variables

See `.env.example` for all required vars. Key ones:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — service_role key, server-only
- `ADMIN_PASSWORD` — admin panel password
- `FB_PAGE_ACCESS_TOKEN` / `FB_VERIFY_TOKEN` / `FB_APP_SECRET` — Messenger integration
- `FB_WEBHOOK_SECRET` — ManyChat order intake webhook secret
- `NEXT_PUBLIC_FB_PIXEL_ID` / `NEXT_PUBLIC_FB_PAGE_ID` — client-side Facebook integration

### Remotion video assets

The purification process animation (`public/purify-process.mp4` + `public/purify-process-poster.jpg`) is rendered from `remotion/WaterRefillProcess.tsx` (registered in `remotion/Root.tsx`, entry `remotion/index.ts`; scene timings/colors/video dimensions live in `remotion/theme.ts`). Edit the composition there and re-run `npm run render:video` / `npm run render:poster` to update the assets.

This rendered asset is **not** currently wired into any page — `components/PurifyProcess.js` (used on the homepage) is a separate, pure CSS/SVG stage animation with no video. `components/VideoShowcase.js` is the component that renders a native `<video>`, but it points at `public/brand-video.mp4`, an unrelated asset. If you re-render the Remotion video and want it live on the site, you must manually point a `<video src>` (e.g. in `VideoShowcase.js`) at `/purify-process.mp4`.

`remotion-video/` (repo root, separate from `remotion/`) is an unrelated, unused default `create-video` scaffold — do not confuse it with the real pipeline above.

### Currency

All monetary values are in Philippine Pesos (₱ / PHP).
