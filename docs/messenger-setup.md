# Facebook Messenger + Rewards — Setup & Test Checklist

The loyalty/voucher flow delivers reward codes over Facebook Messenger, and order
status updates too. None of it works until the Page, tokens, and webhook are wired.
This checklist gets it live and verifies it end to end.

## How binding works (why this matters)

A customer can only receive Messenger messages (reward codes, status updates) once
their **PSID** (page-scoped ID) is stored on their order/customer record. There are
two ways that happens now:

1. **Confirmation-page deep-link (primary).** After ordering, the confirmation page
   shows a "Get updates & unlock rewards on Messenger" button:
   `https://m.me/<PAGE_ID>?ref=<orderId>`. One tap opens Messenger; the webhook reads
   the `ref` and binds automatically. Requires the Page subscribed to
   `messaging_referrals`.
2. **Typing the Order ID (fallback).** Customer messages the Page with their Order ID.

If Messenger isn't set up, the customer just sees the "apply on delivery" fallback —
nothing crashes, but codes never send.

## 1. Environment variables (Vercel → Project → Settings → Environment Variables)

| Var | Where to get it | Needed for |
|-----|-----------------|-----------|
| `FB_PAGE_ACCESS_TOKEN` | Meta app → Messenger → Generate token for your Page | Sending codes/updates |
| `FB_APP_SECRET` | Meta app → Settings → Basic → App Secret | Webhook signature verify |
| `FB_VERIFY_TOKEN` | You invent this string; paste same value in the webhook config | Webhook GET handshake |
| `REWARD_CODE_SECRET` | You invent a long random string | Hashing reward codes |
| `NEXT_PUBLIC_FB_PAGE_ID` | Your Facebook Page numeric ID | m.me deep-link target |

After setting/changing any of these, **redeploy** (Vercel doesn't apply env changes to a
running deployment).

## 2. Meta Developer console

1. App → **Messenger → Settings**.
2. **Access Tokens**: add your Page, generate the token → put in `FB_PAGE_ACCESS_TOKEN`.
3. **Webhooks → Add Callback URL**:
   - Callback URL: `https://clear-flow-nine.vercel.app/api/messenger-webhook`
     (still the pre-rename host — the Vercel project is now `anchor-drops` but
     that alias did not move. If you ever point production at an `anchor-drops`
     host, this callback URL must be re-entered here or notifications stop.)
   - Verify Token: the exact value you put in `FB_VERIFY_TOKEN`
   - Click Verify and Save (this hits the GET handshake).
4. **Subscription Fields** — subscribe to: `messages`, `messaging_postbacks`,
   `messaging_referrals`. (`messaging_referrals` is what makes the confirmation-page
   deep-link auto-bind.)
5. **Subscribe your Page** to the app under the webhook section.
6. Set the **Get Started** button (Messenger Profile) so first-time users get the intro.

## 3. End-to-end test

1. Place a real order on the site.
2. On the confirmation page, tap **Get updates & unlock rewards on Messenger**.
3. In Messenger you should get: `Got it — your order is linked. Current status: …`.
   - If not: check the webhook is subscribed to `messaging_referrals` and the Page
     token is valid.
4. Once you have ≥10 delivered gallons on that phone, go to the order page, request the
   free refill, tap send-code — the code should arrive in Messenger within seconds.
5. Enter the code at checkout → discount applies immediately.

## 4. Troubleshooting

- **No code arrives, UI shows "apply on delivery"**: the phone has no linked PSID (step 2/3
  never completed), or `FB_PAGE_ACCESS_TOKEN` is unset/expired. The order page now shows a
  tip to link Messenger from the confirmation page.
- **Webhook verify fails (403)**: `FB_VERIFY_TOKEN` mismatch between Vercel and Meta.
- **Webhook 500 "not configured"**: `FB_APP_SECRET` unset.
- **Codes never validate**: `REWARD_CODE_SECRET` missing or changed after codes were issued.
