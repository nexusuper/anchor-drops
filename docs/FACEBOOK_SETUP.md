# Facebook Integration Setup Guide

This guide walks you through setting up Facebook features for Anchor Drops.

> **For the loyalty/rewards + webhook go-live, follow [`messenger-setup.md`](messenger-setup.md) — it is the authoritative, current checklist.** It also requires `FB_APP_SECRET` (webhook signature verification) and the `messaging_referrals` subscription, both needed for the confirmation-page "link Messenger" deep-link to auto-bind. This general guide below covers the Pixel and chat plugin.

## Features Included

1. **Messenger Chat Plugin** - Live chat widget on your website
2. **Meta Pixel** - Track conversions and page views for FB Ads
3. **Messenger Notifications** - Send order updates via Messenger API

---

## Prerequisites

- Facebook Page for your business
- Facebook Developer Account: https://developers.facebook.com

---

## Step 1: Create a Facebook App

1. Go to [Facebook Developers](https://developers.facebook.com)
2. Click **My Apps** → **Create App**
3. Select **Business** type
4. Enter app name (e.g., "Anchor Drops")
5. Select your Facebook Page

---

## Step 2: Set Up Meta Pixel (Conversion Tracking)

1. Go to [Facebook Events Manager](https://business.facebook.com/events_manager)
2. Click **Connect Data Sources** → **Web** → **Facebook Pixel**
3. Name your pixel and click **Create Pixel**
4. Copy the **Pixel ID** (a 15-16 digit number)
5. Add to your `.env.local`:
   ```
   NEXT_PUBLIC_FB_PIXEL_ID=your-pixel-id-here
   ```

### What Gets Tracked
- **PageView** - Every page load
- **Purchase** - When order confirmation page loads (with total amount)

---

## Step 3: Set Up Messenger Chat Plugin

1. In your Facebook App, go to **Add Product** → **Messenger**
2. Under **Settings**, find your **Page ID**
3. Add to your `.env.local`:
   ```
   NEXT_PUBLIC_FB_PAGE_ID=your-page-id-here
   ```

### Whitelist Your Domain
1. In Messenger Settings, scroll to **Whitelisted Domains**
2. Add your website URL (e.g., `https://anchordrops.ph`)
3. Click **Save**

### Customize Chat Plugin (Optional)
1. Go to your Facebook Page → **Settings** → **Messaging**
2. Scroll to **Add Messenger to your website**
3. Customize greeting, colors, etc.

---

## Step 4: Set Up Messenger API (Automated Notifications)

This allows you to send order status updates directly via Messenger.

### Generate Page Access Token

1. In your Facebook App, go to **Messenger** → **Settings**
2. Under **Access Tokens**, click **Generate Token**
3. Select your Page and grant `pages_messaging` permission
4. Copy the token (keep it secret!)
5. Add to your `.env.local`:
   ```
   FB_PAGE_ACCESS_TOKEN=your-long-access-token-here
   ```

### Set Up Webhook

1. In Messenger Settings, scroll to **Webhooks**
2. Click **Add Callback URL**
3. Enter:
   - **Callback URL**: `https://your-domain.com/api/messenger-webhook`
   - **Verify Token**: Any secret string you choose
4. Add the verify token to `.env.local`:
   ```
   FB_VERIFY_TOKEN=your-secret-verify-token
   ```
5. Click **Verify and Save**
6. Subscribe to these events:
   - `messages`
   - `messaging_postbacks`
   - `messaging_referrals`  ← required, or the confirmation-page "link Messenger" deep-link won't auto-bind the customer's PSID

### Set Up Get Started Button (Optional)

Run this once to set up the welcome message:
```bash
curl -X POST "https://graph.facebook.com/v18.0/me/messenger_profile?access_token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"get_started": {"payload": "GET_STARTED"}}'
```

---

## Step 5: App Review (For Production)

For production use, you need Facebook approval:

1. In your App Dashboard, go to **App Review** → **Permissions and Features**
2. Request these permissions:
   - `pages_messaging` - Send messages from your Page
   - `pages_read_engagement` - Read Page info
3. Submit for review (may take 1-5 business days)

**Note**: During development, the app works for Page admins without review.

---

## How It Works

### Customer Links Their Messenger

1. Customer visits your FB Page and sends a message
2. They send their **Order ID** or **phone number**
3. System links their Messenger ID to their orders
4. Future order updates are sent automatically

### Admin Sends Notifications

1. Admin opens order in Admin Panel
2. If customer has Messenger linked, 💬 button appears
3. Click to send instant notification via Messenger
4. If not linked, use 📱 button for SMS copy-paste

---

## Environment Variables Summary

```env
# Public (exposed to browser)
NEXT_PUBLIC_FB_PIXEL_ID=1234567890123456
NEXT_PUBLIC_FB_PAGE_ID=109876543210987

# Server-only (keep secret!)
FB_PAGE_ACCESS_TOKEN=EAAxxxxxxx...
FB_VERIFY_TOKEN=my-secret-verify-token
```

---

## Troubleshooting

### Chat Plugin Not Showing
- Check domain is whitelisted in Messenger settings
- Verify `NEXT_PUBLIC_FB_PAGE_ID` is correct
- Check browser console for errors

### Pixel Not Tracking
- Use [Facebook Pixel Helper](https://chrome.google.com/webstore/detail/facebook-pixel-helper) Chrome extension
- Check `NEXT_PUBLIC_FB_PIXEL_ID` is set

### Messenger Notifications Failing
- Verify `FB_PAGE_ACCESS_TOKEN` is valid and not expired
- Check customer has actually messaged your Page first
- Ensure app has `pages_messaging` permission

### Webhook Verification Failing
- Ensure webhook URL is HTTPS
- Check `FB_VERIFY_TOKEN` matches exactly
- Verify the endpoint is publicly accessible

---

## Cost

- **Messenger Chat Plugin**: Free
- **Meta Pixel**: Free
- **Messenger API**: Free (within standard rate limits)

You only pay for Facebook Ads if you choose to run them.
