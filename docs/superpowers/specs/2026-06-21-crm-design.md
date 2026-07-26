# CRM — Customer Profiles for Anchor Drops

**Date:** 2026-06-21
**Status:** Approved

## Problem

Customer identity is scattered across order rows keyed by phone number. There is no way to view a customer's full history, add notes/tags, or track interactions in one place. The admin must manually search orders by phone to piece together a customer picture.

## Solution

Add a CRM "Customers" tab inside the existing admin panel. Customer identity is derived at query time from `phone_normalized` on the `orders` table (virtual customers — no new customers table). Two new lightweight tables store admin notes and contact interaction logs.

## Data Model

### Existing (unchanged)
- `orders` table — customer identity derived from `phone_normalized`

### New Tables

```sql
CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  phone_normalized TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_notes_phone ON customer_notes (phone_normalized);

CREATE TABLE IF NOT EXISTS contact_log (
  id TEXT PRIMARY KEY,
  phone_normalized TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  summary TEXT NOT NULL,
  order_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_log_phone ON contact_log (phone_normalized);
CREATE INDEX IF NOT EXISTS idx_contact_log_created ON contact_log (created_at DESC);
```

### Virtual Customer Profile Query

Aggregated per `phone_normalized`:
- `customer_name`: from most recent order
- `total_orders`: COUNT(*)
- `total_spent`: SUM(total_amount)
- `first_order`: MIN(created_at)
- `last_order`: MAX(created_at)
- `delivered_gallons`: loyalty computation from delivered orders
- `loyalty_status`: computed from `computeRewards()`
- `messenger_linked`: any order has `messenger_psid IS NOT NULL`

## API Endpoints

All endpoints require admin auth (`verifyAdmin` + password header).

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/customers` | Paginated customer list with aggregated stats, search, filter by tag, sort |
| GET | `/api/customers/stats` | Dashboard summary: total customers, active this month, new this month, top spender |
| GET | `/api/customers/[phone]` | Single customer profile: stats + order history + notes + contact log |
| POST | `/api/customers/[phone]/notes` | Add or update a customer note + tags |
| DELETE | `/api/customers/[phone]/notes/[id]` | Delete a note |
| POST | `/api/customers/[phone]/contact-log` | Add manual contact log entry |

### Modified Existing Endpoints
- `POST /api/notify` — also writes to `contact_log` (channel: 'sms', direction: 'outbound')
- `POST /api/messenger-notify` — also writes to `contact_log` (channel: 'messenger', direction: 'outbound')

## Admin Panel UI

### Tab System
Add tabs to admin panel header: **Orders** | **Customers**

### Customer List View
- **Stats row:** Total Customers | Active This Month | New This Month | Top Spender
- **Search bar:** by name or phone
- **Filter:** by tag
- **Sortable table columns:** Name, Phone, Total Orders, Total Spent, Last Order, Tags
- Server-side pagination (50 per page, same pattern as orders)

### Customer Detail View (slide-out panel)
- **Header:** Name, phone, tags (editable inline), Messenger linked badge
- **Stats cards:** Total orders, total spent, avg order value, loyalty progress bar (gallons toward next free refill)
- **Order history:** Table of all orders for this customer
- **Notes:** Add/edit/delete admin notes with timestamps
- **Contact log:** Timeline of interactions (auto-logged + manual), newest first
- **Quick actions:** Add note, add tag, log manual contact

## Patterns & Conventions
- Auth: `verifyAdmin()` from `lib/auth.js`
- Rate limiting: `rateLimit()` from `lib/rate-limit.js`
- Validation: Zod schemas
- DB: `initDb()` from `lib/db.js` with migration pattern
- UI: Clay component library (ClayCard, ClayButton, ClayIcon)
- Pagination: Server-side with page/limit/offset params

## Out of Scope
- Automated retention campaigns / drip messaging
- Lead/pipeline management
- Customer self-service portal
- Email integration
