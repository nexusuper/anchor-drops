# CRM Phase 2 — Segmentation, Tags, Export, Messaging

**Date:** 2026-06-22
**Status:** Approved
**Depends on:** CRM Phase 1 (2026-06-21)

## Problem

Phase 1 delivers a customer list and detail panel, but the admin has no way to segment customers by behavior, efficiently manage tags, export data for offline use, or message customers directly from the CRM.

## Solution

Four additions to the existing CRM, all building on the current virtual-customer model (no new tables):

1. **Auto-computed customer segments** derived from order history
2. **Tag management** with autocomplete, inline editing, and list filtering
3. **CSV export** of customer data matching current filters
4. **Messenger quick-send** from the customer detail panel

## Data Model

### No New Tables

All four features use existing tables (`orders`, `customer_notes`, `contact_log`). Segments are computed at query time. Tags continue to live in `customer_notes.tags`.

## 1. Customer Segmentation

### Segment Definitions

| Segment | Criteria | Badge Color | Priority |
|---------|----------|-------------|----------|
| At-risk | 2+ orders, last order 30–60 days ago | Orange | 1 (highest) |
| Churned | Last order >60 days ago | Red | 2 |
| VIP | 5+ orders OR total spent >= ₱1,500 | Purple | 3 |
| Regular | 2+ orders, last order within 30 days | Green | 4 |
| New | Only 1 order | Blue | 5 (lowest) |

Priority determines assignment when multiple criteria match. A VIP who hasn't ordered in 35 days is **At-risk**, not VIP. A churned customer who was also VIP is **Churned**.

### Computation

Segment is computed per-customer using `total_orders`, `total_spent`, and `last_order`:

```js
function computeSegment({ total_orders, total_spent, last_order }) {
  const daysSinceLast = (Date.now() - new Date(last_order).getTime()) / 86_400_000;
  if (total_orders >= 2 && daysSinceLast >= 30 && daysSinceLast < 60) return 'at-risk';
  if (daysSinceLast >= 60) return 'churned';
  if (total_orders >= 5 || total_spent >= 1500) return 'vip';
  if (total_orders >= 2) return 'regular';
  return 'new';
}
```

This function lives in a new shared file `lib/segments.js` (isomorphic — safe for both server and client).

### API Changes

- `GET /api/customers` — each customer row gains a `segment` field, computed server-side. New query param `segment` filters by segment value.
- `GET /api/customers/stats` — gains `segmentCounts: { new, regular, vip, at_risk, churned }`.
- `GET /api/customers/[phone]` — response gains `segment` field.

### UI Changes

- **Segment filter row**: Below the stats dashboard, a row of segment filter buttons (like the order status filters). Each shows count + label. Clicking filters the list.
- **Segment badge**: In the customer list table and detail panel header, a colored badge shows the segment.

## 2. Tag Management

### New API Endpoint

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/customers/tags` | Returns all unique tags across all customer notes, sorted alphabetically |

Response: `{ tags: ["vip", "wholesale", "late-payer", ...] }`

Implementation: `SELECT DISTINCT unnest(string_to_array(tags, ',')) AS tag FROM customer_notes WHERE tags != '' ORDER BY tag`

### UI Changes

- **Tag autocomplete**: The tag input in the note form and the new inline tag editor fetch `GET /api/customers/tags` on focus. As the user types, filter the dropdown. Pressing Enter or clicking adds the tag.
- **Inline tag chips on detail panel**: Below the customer name in the detail header, show current tags as removable chips. Clicking "+" opens a small autocomplete input. Adding/removing a tag calls `POST /api/customers/[phone]/notes` with just the updated tags (content can be empty or a system note like "Tag added: wholesale").
- **Tag filter on list**: A dropdown/pills in the search bar area populated from `GET /api/customers/tags`. Selecting a tag adds `?tag=<value>` to the customer list query (already supported by the existing API).

### Tag Storage Refinement

Tags on `customer_notes.tags` are comma-separated. A customer's "effective tags" are the union of all tags across their notes. The customer list API already aggregates this via `COALESCE(MAX(cn.tags), '')`. The tags endpoint returns distinct individual tags from this field.

## 3. CSV Export

### New API Endpoint

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/customers/export` | Returns all matching customers as JSON (no pagination). Accepts same query params as `/api/customers` plus `segment`. |

The actual CSV conversion happens client-side to avoid adding a CSV library. The endpoint returns the same shape as `/api/customers` but with `limit=10000` and no pagination wrapper.

### UI Changes

- **Export button**: In the customer list toolbar (next to search/sort), a "Export CSV" button.
- On click: fetch `/api/customers/export` with current search/sort/tag/segment filters → convert to CSV in the browser → trigger download as `anchor-drops-customers-YYYY-MM-DD.csv`.
- Columns: Name, Phone, Total Orders, Total Spent, First Order, Last Order, Segment, Tags.

## 4. Messenger Quick-Send

### New API Endpoint

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/customers/[phone]/message` | Send a free-form Messenger message to a customer |

Request body (Zod validated):
```js
{ message: z.string().min(1).max(2000) }
```

Implementation:
1. Look up the customer's `messenger_psid` from their most recent order
2. Call `sendMessengerMessage(psid, message)` from `lib/facebook.js`
3. Auto-log to `contact_log` (channel: 'messenger', direction: 'outbound')
4. Return `{ success: true }` or error

### UI Changes

- **Send Message section** in customer detail panel, below the contact log. Only visible when `has_messenger` is true.
- Text input + Send button. On send, calls the API, shows success/error toast, and refreshes the contact log.

## Patterns & Conventions

Same as Phase 1:
- Auth: `verifyAdmin()` from `lib/auth.js`
- Rate limiting: `rateLimit()` from `lib/rate-limit.js`
- Validation: Zod schemas
- DB: `initDb()` from `lib/db.js`
- UI: Clay component library
- IDs: `uuidv4().slice(0,8).toUpperCase()`

## Out of Scope

- Automated drip messaging / retention campaigns
- Scheduled message sending
- Bulk messaging to segments
- Customer self-service portal
- Email channel integration
