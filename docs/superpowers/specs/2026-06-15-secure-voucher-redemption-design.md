# Anchor Drops — Secure Voucher Redemption

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Problem

Loyalty vouchers currently auto-apply based on **phone number alone**. Anyone who
knows a customer's phone can redeem that customer's earned free refills on their
own order. We must require *proof of control* before a voucher reduces a bill.

## Decision (from brainstorming)

Build **both** redemption paths; remove phone-only auto-apply:

- **Path A — Messenger one-time code** (instant self-service for reachable, linked
  customers). Kept minimal: if the code can't be sent (not linked, or outside
  Meta's 24-hour messaging window), it **silently falls back** to Path B with no
  error shown.
- **Path B — Admin-applied** (universal fallback). The order is placed at full
  price flagged "free refill requested ×N"; staff apply the credit after
  confirming identity at delivery.

The `/rewards` lookup page is unchanged (showing a progress/voucher *count* by
phone is low-harm and stays view-only).

## Security model

- A discount is applied **only** when (a) a valid, unexpired, unused Messenger
  code for that phone is consumed at order time, or (b) an admin applies it.
- Regardless of path, the server still recomputes `available` from delivered
  orders and clamps redemption to it — so even a replayed code can never redeem
  more than the customer has actually earned (this is the existing backstop and
  it remains the hard cap).
- Codes are 6 digits, hashed at rest (SHA-256 salted with the normalized phone),
  single-use, 10-minute expiry, with a 5-attempt cap to stop brute force.

## Data model

**New table `reward_codes`** (created in `lib/db.js` via `CREATE TABLE IF NOT
EXISTS`):
- `id` TEXT PRIMARY KEY (uuid)
- `phone` TEXT NOT NULL (normalized digits)
- `code_hash` TEXT NOT NULL
- `expires_at` TEXT NOT NULL (ISO)
- `used` INTEGER NOT NULL DEFAULT 0
- `attempts` INTEGER NOT NULL DEFAULT 0
- `created_at` TEXT NOT NULL

**New column on `orders`** (via `ADD COLUMN IF NOT EXISTS`):
- `reward_requested INTEGER NOT NULL DEFAULT 0` — free refills the customer asked
  for but that are **not yet applied** (awaiting admin). Distinct from
  `voucher_count` (= actually applied).

## Components / files

**Create:**
- `lib/reward-codes.js` — server-only crypto helpers: `CODE_TTL_MINUTES = 10`,
  `CODE_MAX_ATTEMPTS = 5`, `generateCode()` (6-digit string), and
  `hashCode(phone, code)` (SHA-256 of `phone:code` via `node:crypto`). Kept
  separate from `lib/loyalty.js` so `node:crypto` never enters the client bundle.
- `pages/api/rewards/send-code.js` — `POST {phone}`. Normalizes phone; if the
  phone has `available < 1`, returns `{ sent:false }`. Finds a `messenger_psid`
  from that phone's orders; if none → `{ sent:false }`. Otherwise generates a code,
  stores a `reward_codes` row, and calls `sendMessengerMessage(psid, text)`. On
  send success → `{ sent:true }`; on any failure (24h window/API error) deletes the
  row and returns `{ sent:false }`. (The client treats every `sent:false` the same
  — silent Path B fallback.)
- `pages/api/rewards/verify-code.js` — `POST {phone, code}`. Non-consuming check
  used for the checkout discount preview. Finds the latest unused, unexpired code
  for the phone; increments `attempts`; if `attempts > 5` marks it used and returns
  `{ valid:false }`. On hash match returns `{ valid:true, available }`. Does NOT
  mark used (consumption happens at order time).
- `pages/api/orders/[id]/apply-reward.js` — `POST` (admin password header). Loads
  the order; requires `reward_requested > 0`; recomputes the phone's `available`;
  sets `voucher_count = min(reward_requested, available, quantity)`,
  `voucher_discount = count × 30`, `total_amount = max(0, total_amount − count×30)`,
  and `reward_requested = 0`. Returns the updated order.

**Modify:**
- `lib/db.js` — add the `reward_codes` table and the `reward_requested` column +
  migration.
- `lib/loyalty.js` — unchanged (stays browser-safe; no `node:crypto`). Its existing
  exports (`computeRewards`, `maxRedeemable`, `normalizePhone`, `VOUCHER_VALUE`) are
  reused as-is.
- `pages/api/orders.js` (POST) — accept `reward_requested` and `reward_code`. If a
  valid unused unexpired code matches the phone → mark it used, apply
  `voucher_count = min(reward_requested, available, quantity)`, set discount, reduce
  total, store `reward_requested = 0`. Else → `voucher_count = 0`, no discount, store
  `reward_requested = min(reward_requested, quantity)` (pending). The existing
  server-side `available` clamp stays.
- `pages/order.js` — replace the auto-applying stepper with: a count stepper
  (intent), a **"Send my code"** button (calls send-code), a code input + **"Apply
  code"** (calls verify-code; on `valid` shows the discount in the summary and locks
  the count), and a silent fallback note ("We'll apply your free refill when we
  confirm your delivery") whenever a code isn't active. The summary shows the
  discount **only** when a code is verified. Submit sends `reward_requested` (the
  count) and `reward_code` (only if verified).
- `pages/order/confirmation.js` — show "Free refill applied −₱X" when
  `voucher_discount > 0`, or "Free refill requested — we'll apply it on delivery"
  when `reward_requested > 0`.
- `components/AdminPanel.js` — for orders with `reward_requested > 0`, show a
  "Wants N free refill(s)" badge and an **Apply reward** button (with a confirm
  dialog) that calls the apply-reward endpoint and refreshes. Keep the existing
  "−₱{voucher_discount} reward" tag for applied ones.

## Data flow

1. Checkout: phone entered → `/api/rewards` shows progress (view-only). If
   available and the cart supports it, the reward section appears.
2. Customer picks a count and taps **Send my code**.
   - Reachable on Messenger → code arrives; they enter it, tap **Apply code**
     (verify-code) → discount previews. Submit carries the code → server consumes
     it and applies.
   - Not reachable → silent fallback: order submits with `reward_requested`, full
     price, no code.
3. Admin sees pending-reward orders, confirms identity, taps **Apply reward** →
   credit applied, voucher consumed against `available`.

## Error handling & edge cases

- **Wrong/expired code at submit:** server applies 0 and stores the request as
  pending (admin can still apply); the confirmation reflects "requested," not
  "applied," so the customer is never charged a phantom discount.
- **Brute force:** 5-attempt cap per code, then it's locked.
- **Replay / double-apply:** `available` recomputation caps total redemption to
  earned, independent of codes.
- **Cancelled orders:** still return their voucher (existing behavior;
  `voucher_count` only counts on non-cancelled orders). A cancelled *pending*
  order simply never gets applied.
- **No Messenger secret needed:** codes are hashed in the DB; no signing key /
  new env var required.

## Testing / verification

- `lib/reward-codes.js` is pure-ish (crypto) → add Node assertions in
  `scripts/loyalty.test.mjs` (or a sibling) for `hashCode` determinism, salting by
  phone, and `generateCode()` shape (6 digits).
- `npm run lint` clean (baseline: the pre-existing `set-state-in-effect` errors).
- `npm run build` succeeds; new routes listed.
- Manual e2e (dev DB): (1) code path — link a Messenger test user, earn a voucher,
  send+enter code, see discount, place order, confirm applied + code now used;
  (2) fallback — a non-linked phone places a request, admin applies it, total drops
  and badge→tag; (3) attack — a different session using the same phone WITHOUT the
  code cannot get a discount (lands as a pending request the admin won't approve);
  (4) brute force — 6 wrong codes locks it.

## Non-goals (YAGNI)

- No SMS provider / SMS OTP.
- No customer accounts or passwords.
- No HMAC redemption tokens (the single-use code + `available` cap suffice).
- No change to how vouchers are *earned* or to the `/rewards` page.

## Related

[[loyalty-vouchers]], [[design-system-claymorphism]]. Builds directly on
`lib/loyalty.js` and the existing Messenger integration (`lib/facebook.js`,
`messenger_psid`).
