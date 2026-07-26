# Anchor Drops — Loyalty Vouchers (Free Refill Every 10 Gallons)

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Goal

Reward repeat customers: every **10 gallons** of delivered water earns **one free
5-gallon refill** (a ₱30 credit). Customers track progress on a **My Rewards**
page and the voucher **auto-applies at checkout** — all without any login.

## Key decisions (from brainstorming)

- **Identity:** phone number is the loyalty key (normalized to digits). Customer
  name is shown for friendliness; `messenger_psid` is linked when present but is
  not required.
- **What counts:** only orders with status `delivered` accrue gallons.
- **Reward:** each voucher = one free 5-gal refill = a fixed **₱30** credit.
- **Redeem:** both a `/rewards` page (check progress by phone) **and** auto-apply
  at checkout. A customer may apply **multiple** vouchers on one order, up to what
  the cart supports.

## Data model

Source of truth stays the existing **`orders`** table — earned vouchers are
*computed*, not stored, so they can't drift. Two new columns added via the same
safe `ADD COLUMN IF NOT EXISTS` migration already used in `lib/db.js`:

- `voucher_count INTEGER NOT NULL DEFAULT 0` — vouchers redeemed on this order.
- `voucher_discount REAL NOT NULL DEFAULT 0` — peso value discounted (count × 30).

### Voucher math (per normalized phone)

- **Gallons per order** = `gallonsBySize(container_size) × quantity`, where
  `5-Gal → 5`, `3-Gal → 3`. Containers purchased do **not** count.
- **deliveredGallons** = Σ gallons over that phone's `delivered` orders.
- **earned** = `floor(deliveredGallons / 10)`.
- **redeemed** = Σ `voucher_count` over that phone's orders where status
  `!= 'cancelled'`.
- **available** = `max(0, earned − redeemed)`.
- **gallonsToNext** = `10 − (deliveredGallons mod 10)`; **progressPct** =
  `(deliveredGallons mod 10) / 10`.

Because redeemed only counts non-cancelled orders, **cancelling an order
automatically returns its voucher**. Self-healing, no extra bookkeeping.

## Components / files

**Create:**
- `lib/loyalty.js` — pure loyalty logic (no DB/React): `GALLONS_BY_SIZE`,
  `VOUCHER_VALUE = 30`, `GALLONS_PER_VOUCHER = 10`, `normalizePhone(phone)`,
  `gallonsForOrder(order)`, `computeRewards(orders)` → `{ deliveredGallons,
  earned, redeemed, available, gallonsToNext, progressPct }`, and
  `maxRedeemable({ available, quantity, refillSubtotal })`. Pure functions =
  independently testable and reused by both API routes and the UI.
- `pages/api/rewards.js` — `GET /api/rewards?phone=…` (public, like order
  tracking). Normalizes phone, requires ≥ 7 digits, queries that phone's orders,
  returns the `computeRewards` result. Returns zeros (not an error) for an unknown
  phone so the UI can show "no rewards yet."
- `pages/rewards.js` — **My Rewards** page (clay-styled): phone input → progress
  bar to next free refill, gallons delivered, available free refills, and a note
  that vouchers auto-apply at checkout. Reuses `ClayCard`/`ClayButton`/`ClayIcon`.

**Modify:**
- `lib/db.js` — add the two `ADD COLUMN IF NOT EXISTS` migrations.
- `pages/api/orders.js` (POST) — accept `voucher_count` from the client, but
  **recompute `available` server-side** and clamp: `allowed = max(0,
  min(voucher_count, available, quantity))`; `voucher_discount = allowed × 30`.
  Correct `total_amount` for any clamp (`total += clientDiscount − allowed×30`)
  and floor it at 0. Store `voucher_count` and `voucher_discount`. This prevents
  claiming vouchers a customer hasn't earned (see [[project-security]]).
- `pages/order.js` — after the phone field has ≥ 7 digits, fetch
  `/api/rewards?phone=…` (debounced). If `available ≥ 1`, show a clay reward
  banner with a toggle/stepper to apply 1…`maxRedeemable` vouchers. Applying
  subtracts `count × 30` from the summary and sends `voucher_count`. Cap shown to
  the user = `maxRedeemable({ available, quantity, refillSubtotal })` where
  `maxRedeemable = min(available, quantity, floor(refillSubtotal / 30))` — whole
  vouchers only, never discounting more than the refills are worth. (Consequence:
  an order must have ≥ ₱30 of refills to redeem; noted in §Edge cases.)
- `pages/order/confirmation.js` — if a voucher was applied, show a small "You
  saved ₱X with a free-refill reward" note; always show a link to `/rewards`.
- `components/Navbar.js` + `components/Footer.js` — add a **Rewards** link for
  discoverability.
- `components/AdminPanel.js` — on order rows that used a voucher, show a small
  "−₱{voucher_discount} reward" tag next to the total. No separate loyalty
  dashboard (YAGNI).

## Data flow

1. Customer places orders → admin marks them `delivered` → gallons accrue.
2. On the order form, entering their phone triggers a rewards lookup; available
   free refills are offered and applied to the total.
3. On submit, `POST /api/orders` validates and persists `voucher_count` /
   `voucher_discount`; the order's own gallons accrue only once it is delivered.
4. `/rewards` and the order form both read live state via `GET /api/rewards`.

## Error handling & edge cases

- **Phone normalization:** matching strips non-digits on both sides (SQL
  `regexp_replace(phone, '\D', '', 'g')`), so `0917-123-4567` == `09171234567`.
- **Cancelled redemption:** voucher returns automatically (excluded from
  `redeemed`).
- **Over-claim attempt:** server clamps to `available` and `quantity`; total is
  corrected and floored at 0.
- **Small 3-gal-only order:** if refill subtotal < ₱30, `maxRedeemable` = 0 and
  the UI explains a voucher needs ≥ ₱30 of refills. Honest (reward ≈ ₱30 value).
- **Unknown phone:** rewards endpoint returns zeros, UI shows an encouraging
  empty state, never an error.
- **Privacy:** rewards lookup reveals only gallon/voucher counts (no
  addresses/order details), consistent with the existing no-login model. No OTP —
  a conscious trade-off.

## Testing / verification

- `lib/loyalty.js` is pure — verify with a small Node assertion script (no test
  runner is installed): gallons math, `floor` thresholds at 9/10/11/20 gallons,
  `redeemed` excludes cancelled, `maxRedeemable` caps by available/quantity/value.
- `npm run build` and `npm run lint` clean (lint baseline: the 2 pre-existing
  `set-state-in-effect` errors).
- Manual end-to-end against the dev DB: place orders, mark delivered, confirm
  gallons/vouchers update on `/rewards`; apply a voucher at checkout and confirm
  the discount persists and shows in admin; cancel a redeeming order and confirm
  the voucher returns.
- Visual check of `/rewards` and the order-form banner at 375/768/1440 in the
  established claymorphism style; reduced-motion respected.

## Non-goals (YAGNI)

- No customer accounts, passwords, or OTP.
- No expiry dates on vouchers, no tiered/points system.
- No separate loyalty admin dashboard (just the per-order tag).
- No changes to pricing logic location (prices remain client-side constants; the
  server validates only the voucher portion, consistent with current design).
- No retroactive backfill UI — historical delivered orders already count via the
  computed math.

## Design system

Reuse the existing claymorphism layer (`ClayCard`, `ClayButton`, `ClayIcon`,
clay tokens, `clay-inset` progress track). See [[design-system-claymorphism]].
