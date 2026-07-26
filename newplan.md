# Anchor Drops — Assess & Improve (Route + Rewards + Admin login)

## Context

Anchor Drops is a live water-refill order app (Next.js 16 Pages Router, Supabase, Vercel). Owner flagged three worries, and a full audit confirmed them:

1. **Delivery route doesn't map.** The "Route" tab is only an alphabetical barangay checklist ([RouteTab.js](components/admin/RouteTab.js), [orders/route.js](pages/api/orders/route.js)). No map, no lat/lng, no nav. The driver gets a text list, not directions.
2. **Rewards/vouchers likely don't fire.** Loyalty math is fine, but the whole redemption path depends on a customer's Messenger PSID, and the **only** way PSID gets captured today is the customer *manually messaging the Page with their Order ID*. Nothing on the confirmation page prompts or links them to do it ([confirmation.js](pages/order/confirmation.js) has no `m.me` link). So most customers never bind → voucher codes silently fail → everything falls back to "apply on delivery."
3. **Admin re-login on every refresh.** Password lives only in React state ([AdminPanel.js](components/AdminPanel.js)); a page reload logs the owner out.

The rest of the audit was reassuring: security is solid (timing-safe auth, rate limits, signed URLs, HMAC webhooks, strong CSP), API routes are consistently validated, no XSS sinks. Findings are polish, not holes.

**Constraint:** free services only. Chosen approach uses **Google Maps deep-links** (no API key, no billing) and Facebook Messenger (already partially set up). **No changes to the sibling `anchor-drops-system` DB repo** — no schema change needed.

---

## 1. Delivery route → one-tap Google Maps navigation

Free, no API key, no geocoding, no DB change. Google geocodes the address strings itself.

**[components/admin/RouteTab.js](components/admin/RouteTab.js)**
- Add a top **"Open route in Google Maps"** button that builds a directions URL from the store origin through every stop in the already-sorted list order:
  `https://www.google.com/maps/dir/<origin>/<stop1>/<stop2>/…` — each segment `encodeURIComponent(`${o.address}, ${grp.barangay}, Cagayan de Oro`)`. Path form handles many stops; opens turn-by-turn in the driver's Google Maps app.
- Add a per-stop **"Navigate"** link next to the existing `tel:` link → single-destination `https://www.google.com/maps/dir/?api=1&destination=<addr>&travelmode=driving`.
- Flatten `route.barangays[].orders` into one ordered list for the full-route URL.

**[lib/products.js](lib/products.js)** (already holds `BUSINESS_PHONE_*`)
- Add `export const STORE_MAP_ORIGIN = '<store address, Cagayan de Oro>';` with a comment to edit it to the real store address. Used as the route origin.

**Notes / ceilings**
- `// ponytail: stops go in barangay-then-time order; free Google Maps URLs don't optimize stop order (that's the paid Directions API). Driver can drag to reorder in-app.`
- Very large day (~10+ stops) may hit URL length limits — fine for a small shop; note the ceiling in a comment.

## 2. Rewards / Messenger → make PSID binding actually happen + stop the webhook crash

Root cause: no easy path for a customer to link Messenger. Fix the funnel, not just symptoms.

**[pages/order/confirmation.js](pages/order/confirmation.js)** — the key fix
- Add a prominent **"Get updates & unlock free-refill rewards on Messenger"** button:
  `https://m.me/${process.env.NEXT_PUBLIC_FB_PAGE_ID || '1210958972092166'}?ref=${order.id}`.
  One tap opens Messenger with the order id in the `ref` param — no typing an Order ID.
- Short copy: link Messenger to get status updates and receive reward codes.

**[pages/api/messenger-webhook.js](pages/api/messenger-webhook.js)** — capture the `ref` + kill the 500
- Refactor the UUID→PSID bind block (currently inline at lines 102–120) into a shared `linkOrderToPsid(senderPsid, orderId)` (keeps the existing 30-day / not-delivered / not-already-bound guards).
- In the event loop, also read the referral so the m.me click binds automatically:
  `if (event.referral?.ref) await linkOrderToPsid(senderPsid, extractUuid(event.referral.ref));`
  `if (event.postback?.referral?.ref) await linkOrderToPsid(senderPsid, extractUuid(event.postback.referral.ref));`
  Keep the existing text-message UUID path as fallback.
- Replace the **unguarded** `sendMessengerMessage(...)` at line 120 with the already-`try/catch`ed `sendReply(...)` (the user just interacted, so a standard message is in-window). This fixes the bug where a Messenger send error 500s the whole webhook after the DB write already committed.

**[pages/api/rewards/send-code.js](pages/api/rewards/send-code.js) + [pages/order.js](pages/order.js)** — surface the reason (light touch)
- `send-code.js`: when no linked PSID, return `{ sent: false, reason: 'not_linked' }` instead of a bare `false`.
- `order.js`: in the reward fallback UI, when `reason === 'not_linked'`, show a one-line hint that they can link Messenger after placing the order (or just apply on delivery). No new binding flow here — the real binding moment is the confirmation page (no order id exists yet mid-checkout).

**Setup + test checklist (delivered as a doc, since FB is "partially set up")**
Verify in Vercel env: `FB_PAGE_ACCESS_TOKEN`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `REWARD_CODE_SECRET`, `NEXT_PUBLIC_FB_PAGE_ID`. In Meta Developer console: webhook callback URL = `https://clear-flow-nine.vercel.app/api/messenger-webhook`, verify token matches `FB_VERIFY_TOKEN`, subscribe the Page to `messages`, `messaging_postbacks`, `messaging_referrals`. Set up the Get Started button. Test: place a real order → tap the Messenger link on confirmation → confirm the "order linked" reply → check rewards code send.

## 3. Admin stays logged in

**[components/AdminPanel.js](components/AdminPanel.js)**
- On successful login, `sessionStorage.setItem('cf_admin_pw', pw)`; initialize `savedPassword` from `sessionStorage` on mount and skip the login screen when present; logout clears the key.
- Use `sessionStorage` (not `localStorage`): clears on tab close — better security balance. `// ponytail: sessionStorage; readable by JS but repo has no XSS sinks + strict CSP, and it clears on tab close.`
- If a stored password is rejected by an admin call (401/429), clear it and drop back to the login screen.

---

## Out of scope (this pass, per owner)
- In-app Leaflet map (needs coords in the sibling DB repo).
- `fb-orders.js:77` bare `crypto.randomUUID()` — flagged; on Vercel's Node 20 `crypto` is a global so it likely works, but it's inconsistent with the rest of the repo. Left as a noted follow-up.
- Docs "DB-backed lockout" wording, `rewards.js` Zod, order_number exposure, stray `screenshot.png`.

## Verification
- `npm run lint` and `npm run build` must pass.
- Run existing assertion scripts: `node scripts/loyalty.test.mjs`, `node scripts/scheduling.test.mjs`, `node scripts/reward-codes.test.mjs` (needs `REWARD_CODE_SECRET`).
- Local smoke: `npm run dev`, open admin Route tab, confirm the "Open route in Google Maps" button produces a valid `google.com/maps/dir/...` URL with the stops; open a confirmation page and confirm the `m.me/...?ref=<id>` link is well-formed; reload admin and confirm no re-login.
- Messenger binding itself can only be fully tested against the live Vercel webhook (FB can't reach localhost) — covered by the setup checklist above.
