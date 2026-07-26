# CRM — Customer Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRM "Customers" tab to the admin panel with customer profiles, notes/tags, and contact logging — all derived from existing order data.

**Architecture:** Virtual customers aggregated at query time from `orders.phone_normalized`. Two new tables (`customer_notes`, `contact_log`) for admin-authored data. New API routes under `/api/customers/`. Admin panel gets a tab system switching between Orders and Customers views.

**Tech Stack:** Next.js 16 (Pages Router), Neon Postgres (`@neondatabase/serverless`), React 19, Tailwind CSS 4, Zod, uuid

## Global Constraints

- All new API endpoints require `verifyAdmin(req)` from `lib/auth.js`
- All new API endpoints use `rateLimit()` from `lib/rate-limit.js`
- All user input validated with Zod schemas
- UI uses existing Clay component library (ClayCard, ClayButton, ClayIcon)
- Server-side pagination with `page`/`limit`/`offset` query params
- IDs generated with `uuidv4().slice(0,8).toUpperCase()`
- Timestamps stored as ISO strings via `new Date().toISOString()`
- Phone identity key is always `phone_normalized` (digits only)
- The Neon `sql` tagged template does NOT support `sql.unsafe()` — use Neon's tagged template fragments for dynamic ORDER BY

---

### Task 1: Database Schema — New Tables

**Files:**
- Modify: `lib/db.js` (add table creation + indexes inside `initDb()`)

**Interfaces:**
- Consumes: existing `initDb()` pattern
- Produces: `customer_notes` and `contact_log` tables available for all subsequent tasks

- [ ] **Step 1: Add table creation blocks to `initDb()`**

After the existing index creation blocks (after the `idx_orders_created_at` index), add inside the same try/catch migration pattern:

```js
await sql`
  CREATE TABLE IF NOT EXISTS customer_notes (
    id TEXT PRIMARY KEY,
    phone_normalized TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_customer_notes_phone ON customer_notes (phone_normalized)`;

await sql`
  CREATE TABLE IF NOT EXISTS contact_log (
    id TEXT PRIMARY KEY,
    phone_normalized TEXT NOT NULL,
    channel TEXT NOT NULL,
    direction TEXT NOT NULL,
    summary TEXT NOT NULL,
    order_id TEXT,
    created_at TEXT NOT NULL
  )
`;
await sql`CREATE INDEX IF NOT EXISTS idx_contact_log_phone ON contact_log (phone_normalized)`;
await sql`CREATE INDEX IF NOT EXISTS idx_contact_log_created ON contact_log (created_at DESC)`;
```

- [ ] **Step 2: Verify the dev server starts without SQL errors**

Run: `npm run dev` — hit any page to trigger `initDb()`.
Expected: No SQL errors in console. Tables created.

- [ ] **Step 3: Commit**

```bash
git add lib/db.js
git commit -m "feat(crm): add customer_notes and contact_log tables"
```

---

### Task 2: Customer List API

**Files:**
- Create: `pages/api/customers/index.js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()` from existing libs
- Produces: `GET /api/customers` returns `{ customers, total, page, totalPages }` where each customer has `{ phone_normalized, customer_name, total_orders, total_spent, first_order, last_order, has_messenger, tags }`

- [ ] **Step 1: Create the customer list endpoint**

Create `pages/api/customers/index.js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();
    const tagFilter = (req.query.tag || '').trim();
    const sortParam = req.query.sort || 'last_order_desc';

    const hasSearch = search.length > 0;
    const searchPattern = `%${search}%`;
    const hasTag = tagFilter.length > 0;
    const tagPattern = `%${tagFilter}%`;

    // Neon tagged templates build ORDER BY with sql`` fragments
    const sortMap = {
      last_order_desc: sql`last_order DESC`,
      last_order_asc: sql`last_order ASC`,
      total_spent_desc: sql`total_spent DESC`,
      total_spent_asc: sql`total_spent ASC`,
      total_orders_desc: sql`total_orders DESC`,
      name_asc: sql`customer_name ASC`,
    };
    const orderBy = sortMap[sortParam] || sql`last_order DESC`;

    let rows, countResult;

    if (hasSearch && hasTag) {
      countResult = await sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT o.phone_normalized
          FROM orders o
          LEFT JOIN customer_notes cn ON cn.phone_normalized = o.phone_normalized
          WHERE (o.customer_name ILIKE ${searchPattern} OR o.phone ILIKE ${searchPattern})
            AND cn.tags ILIKE ${tagPattern}
          GROUP BY o.phone_normalized
        ) sub
      `;
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE(MAX(cn.tags), '') AS tags
        FROM orders o
        LEFT JOIN customer_notes cn ON cn.phone_normalized = o.phone_normalized
        WHERE (o.customer_name ILIKE ${searchPattern} OR o.phone ILIKE ${searchPattern})
          AND cn.tags ILIKE ${tagPattern}
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (hasSearch) {
      countResult = await sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT phone_normalized FROM orders
          WHERE customer_name ILIKE ${searchPattern} OR phone ILIKE ${searchPattern}
          GROUP BY phone_normalized
        ) sub
      `;
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT cn.tags FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized LIMIT 1), '') AS tags
        FROM orders o
        WHERE o.customer_name ILIKE ${searchPattern} OR o.phone ILIKE ${searchPattern}
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (hasTag) {
      countResult = await sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT o.phone_normalized
          FROM orders o
          INNER JOIN customer_notes cn ON cn.phone_normalized = o.phone_normalized
          WHERE cn.tags ILIKE ${tagPattern}
          GROUP BY o.phone_normalized
        ) sub
      `;
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE(MAX(cn.tags), '') AS tags
        FROM orders o
        INNER JOIN customer_notes cn ON cn.phone_normalized = o.phone_normalized
        WHERE cn.tags ILIKE ${tagPattern}
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      countResult = await sql`
        SELECT COUNT(*)::int AS total FROM (
          SELECT phone_normalized FROM orders GROUP BY phone_normalized
        ) sub
      `;
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT cn.tags FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized LIMIT 1), '') AS tags
        FROM orders o
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    const total = countResult[0]?.total ?? 0;
    return res.status(200).json({
      customers: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    console.error('Customer list query failed:', err);
    return res.status(500).json({ error: 'Failed to load customers' });
  }
}
```

- [ ] **Step 2: Verify endpoint responds**

```bash
curl -H "password: $ADMIN_PASSWORD" "http://localhost:3000/api/customers"
```
Expected: `{ customers: [...], total, page, totalPages }`

- [ ] **Step 3: Commit**

```bash
git add pages/api/customers/index.js
git commit -m "feat(crm): add customer list API with search, filter, sort, pagination"
```

---

### Task 3: Customer Stats API

**Files:**
- Create: `pages/api/customers/stats.js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`
- Produces: `GET /api/customers/stats` returns `{ totalCustomers, activeThisMonth, newThisMonth, topSpender }`

- [ ] **Step 1: Create the stats endpoint**

Create `pages/api/customers/stats.js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

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
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [totalRes, activeRes, newRes, topRes] = await Promise.all([
      sql`SELECT COUNT(DISTINCT phone_normalized)::int AS count FROM orders`,
      sql`SELECT COUNT(DISTINCT phone_normalized)::int AS count FROM orders WHERE created_at >= ${monthStart}`,
      sql`
        SELECT COUNT(*)::int AS count FROM (
          SELECT phone_normalized, MIN(created_at) AS first_order
          FROM orders GROUP BY phone_normalized
          HAVING MIN(created_at) >= ${monthStart}
        ) sub
      `,
      sql`
        SELECT phone_normalized, MAX(customer_name) AS name, SUM(total_amount)::real AS total_spent
        FROM orders
        GROUP BY phone_normalized
        ORDER BY total_spent DESC
        LIMIT 1
      `,
    ]);

    const top = topRes[0] || null;
    return res.status(200).json({
      totalCustomers: totalRes[0]?.count ?? 0,
      activeThisMonth: activeRes[0]?.count ?? 0,
      newThisMonth: newRes[0]?.count ?? 0,
      topSpender: top ? { name: top.name, phone: top.phone_normalized, total_spent: top.total_spent } : null,
    });
  } catch (err) {
    console.error('Customer stats query failed:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/customers/stats.js
git commit -m "feat(crm): add customer dashboard stats API"
```

---

### Task 4: Customer Detail API

**Files:**
- Create: `pages/api/customers/[phone].js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`, `computeRewards()` and `normalizePhone()` from `lib/loyalty.js`
- Produces: `GET /api/customers/[phone]` returns `{ customer_name, phone_normalized, phone_display, total_orders, total_spent, first_order, last_order, has_messenger, loyalty, orders, notes, contactLog }`

- [ ] **Step 1: Create the customer detail endpoint**

Create `pages/api/customers/[phone].js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeRewards, normalizePhone } from '@/lib/loyalty';

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

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  try {
    const [orders, notes, contactLog] = await Promise.all([
      sql`SELECT * FROM orders WHERE phone_normalized = ${phone} ORDER BY created_at DESC`,
      sql`SELECT * FROM customer_notes WHERE phone_normalized = ${phone} ORDER BY updated_at DESC`,
      sql`SELECT * FROM contact_log WHERE phone_normalized = ${phone} ORDER BY created_at DESC LIMIT 50`,
    ]);

    if (orders.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const latest = orders[0];
    const totalSpent = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const hasMessenger = orders.some((o) => o.messenger_psid);
    const loyalty = computeRewards(orders);

    return res.status(200).json({
      customer_name: latest.customer_name,
      phone_normalized: phone,
      phone_display: latest.phone,
      total_orders: orders.length,
      total_spent: Math.round(totalSpent * 100) / 100,
      first_order: orders[orders.length - 1].created_at,
      last_order: latest.created_at,
      has_messenger: hasMessenger,
      loyalty,
      orders,
      notes,
      contactLog,
    });
  } catch (err) {
    console.error('Customer detail query failed:', err);
    return res.status(500).json({ error: 'Failed to load customer' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/customers/[phone].js
git commit -m "feat(crm): add customer detail API with orders, notes, contact log"
```

---

### Task 5: Customer Notes API

**Files:**
- Create: `pages/api/customers/[phone]/notes/index.js`
- Create: `pages/api/customers/[phone]/notes/[id].js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`, `normalizePhone()`, `uuid`, `zod`
- Produces: `POST .../notes` creates a note, `DELETE .../notes/[id]` deletes a note

- [ ] **Step 1: Create notes POST endpoint**

Create `pages/api/customers/[phone]/notes/index.js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

const NoteSchema = z.object({
  content: z.string().min(1).max(2000),
  tags: z.string().max(500).optional().default(''),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const parsed = NoteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid note data' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const id = uuidv4().slice(0, 8).toUpperCase();
    const now = new Date().toISOString();
    const { content, tags } = parsed.data;

    await sql`
      INSERT INTO customer_notes (id, phone_normalized, content, tags, created_at, updated_at)
      VALUES (${id}, ${phone}, ${content}, ${tags}, ${now}, ${now})
    `;

    return res.status(201).json({ id, content, tags, created_at: now, updated_at: now });
  } catch (err) {
    console.error('Note insert failed:', err);
    return res.status(500).json({ error: 'Failed to save note' });
  }
}
```

- [ ] **Step 2: Create notes DELETE endpoint**

Create `pages/api/customers/[phone]/notes/[id].js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = normalizePhone(req.query.phone);
  const { id } = req.query;
  if (phone.length < 7 || !id) {
    return res.status(400).json({ error: 'Invalid parameters' });
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
      DELETE FROM customer_notes WHERE id = ${id} AND phone_normalized = ${phone} RETURNING id
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Note delete failed:', err);
    return res.status(500).json({ error: 'Failed to delete note' });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/customers/[phone]/notes/index.js pages/api/customers/[phone]/notes/[id].js
git commit -m "feat(crm): add customer notes create and delete API"
```

---

### Task 6: Contact Log API + Auto-Logging in Notify Endpoints

**Files:**
- Create: `pages/api/customers/[phone]/contact-log.js`
- Modify: `pages/api/notify.js` (add contact_log insert)
- Modify: `pages/api/messenger-notify.js` (add contact_log insert)

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`, `normalizePhone()`, `uuid`, `zod`
- Produces: `POST .../contact-log` creates a manual entry. Notify endpoints auto-log to `contact_log`.

- [ ] **Step 1: Create manual contact log endpoint**

Create `pages/api/customers/[phone]/contact-log.js`:

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

const LogSchema = z.object({
  channel: z.enum(['sms', 'messenger', 'manual', 'call', 'in-person']),
  direction: z.enum(['outbound', 'inbound']),
  summary: z.string().min(1).max(2000),
  order_id: z.string().max(20).optional().nullable(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!adminRate(req, res)) return;
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid log entry data' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const id = uuidv4().slice(0, 8).toUpperCase();
    const now = new Date().toISOString();
    const { channel, direction, summary, order_id } = parsed.data;

    await sql`
      INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
      VALUES (${id}, ${phone}, ${channel}, ${direction}, ${summary}, ${order_id || null}, ${now})
    `;

    return res.status(201).json({ id, created_at: now });
  } catch (err) {
    console.error('Contact log insert failed:', err);
    return res.status(500).json({ error: 'Failed to save contact log' });
  }
}
```

- [ ] **Step 2: Add auto-logging to `pages/api/notify.js`**

Add two imports at the top:
```js
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '@/lib/loyalty';
```

Replace the `return res.status(200).json({ phone, message });` line (line 39) with:

```js
    const normPhone = normalizePhone(order.phone);
    try {
      await sql`
        INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
        VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${normPhone}, 'sms', 'outbound', ${message}, ${orderId}, ${new Date().toISOString()})
      `;
    } catch (logErr) {
      console.error('Contact log insert failed:', logErr);
    }

    return res.status(200).json({ phone, message });
```

- [ ] **Step 3: Add auto-logging to `pages/api/messenger-notify.js`**

Add two imports at the top:
```js
import { v4 as uuidv4 } from 'uuid';
import { normalizePhone } from '@/lib/loyalty';
```

After `await sendMessengerMessage(order.messenger_psid, messageText);` (line 53), add before the return:

```js
    const normPhone = normalizePhone(order.phone);
    try {
      await sql`
        INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
        VALUES (${uuidv4().slice(0, 8).toUpperCase()}, ${normPhone}, 'messenger', 'outbound', ${messageText}, ${orderId}, ${new Date().toISOString()})
      `;
    } catch (logErr) {
      console.error('Contact log insert failed:', logErr);
    }
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/customers/[phone]/contact-log.js pages/api/notify.js pages/api/messenger-notify.js
git commit -m "feat(crm): add contact log API and auto-log notifications"
```

---

### Task 7: Add CRM Icons to ClayIcon

**Files:**
- Modify: `components/ui/ClayIcon.js` (add icon paths to PATHS object)

**Interfaces:**
- Produces: New icon names: `users`, `user`, `tag`, `note`, `star`, `arrow-left`

- [ ] **Step 1: Add icons to PATHS object**

Add these entries inside the `PATHS` object in `components/ui/ClayIcon.js`, after the existing `cancel` entry:

```js
users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
user: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></>,
tag: <><path d="M12 2l9 4.5v6L12 22l-9-9.5v-6z" /><circle cx="12" cy="10" r="1.5" /></>,
note: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h4" /></>,
star: <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />,
'arrow-left': <><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></>,
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/ClayIcon.js
git commit -m "feat(crm): add user, tag, note, star icons"
```

---

### Task 8: Admin Panel — Tab System + Customer List View

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: `GET /api/customers` (Task 2), `GET /api/customers/stats` (Task 3), `GET /api/customers/[phone]` (Task 4), ClayIcon `users` icon (Task 7)
- Produces: Admin panel with Orders/Customers tabs. Customer list tab shows dashboard stats, searchable/sortable table, pagination. Clicking a row loads customer detail.

- [ ] **Step 1: Add CRM state variables**

After the existing state declarations (after line 110 `const [statusCounts, setStatusCounts] = useState({});`), add:

```js
const [activeTab, setActiveTab] = useState('orders');
const [customers, setCustomers] = useState([]);
const [custPage, setCustPage] = useState(1);
const [custTotalPages, setCustTotalPages] = useState(1);
const [custTotal, setCustTotal] = useState(0);
const [custSearch, setCustSearch] = useState('');
const [custSort, setCustSort] = useState('last_order_desc');
const [custStats, setCustStats] = useState(null);
const [selectedCustomer, setSelectedCustomer] = useState(null);
const [custLoading, setCustLoading] = useState(false);
const [newNote, setNewNote] = useState('');
const [newTags, setNewTags] = useState('');
const [savingNote, setSavingNote] = useState(false);
const [newLogSummary, setNewLogSummary] = useState('');
const [newLogChannel, setNewLogChannel] = useState('manual');
const [savingLog, setSavingLog] = useState(false);
```

- [ ] **Step 2: Add CRM fetch functions**

After the existing `handleSearchChange` function, add:

```js
async function fetchCustomers(p, overrides) {
  setCustLoading(true);
  const s = overrides?.search ?? custSearch;
  const sort = overrides?.sort ?? custSort;
  const target = p || custPage;
  const params = new URLSearchParams({ page: target, limit: 50, sort });
  if (s) params.set('search', s);
  try {
    const res = await fetch(`/api/customers?${params}`, { headers: { password: savedPassword } });
    if (res.ok) {
      const data = await res.json();
      setCustomers(data.customers);
      setCustTotal(data.total);
      setCustTotalPages(data.totalPages);
      setCustPage(data.page);
    }
  } catch (e) {
    console.error('Failed to fetch customers:', e);
  }
  setCustLoading(false);
}

async function fetchCustStats() {
  try {
    const res = await fetch('/api/customers/stats', { headers: { password: savedPassword } });
    if (res.ok) setCustStats(await res.json());
  } catch (e) {
    console.error('Failed to fetch customer stats:', e);
  }
}

async function fetchCustomerDetail(phone) {
  try {
    const res = await fetch(`/api/customers/${phone}`, { headers: { password: savedPassword } });
    if (res.ok) setSelectedCustomer(await res.json());
  } catch (e) {
    console.error('Failed to fetch customer detail:', e);
  }
}

async function saveNote() {
  if (!newNote.trim() || !selectedCustomer) return;
  setSavingNote(true);
  try {
    await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ content: newNote, tags: newTags }),
    });
    setNewNote('');
    setNewTags('');
    await fetchCustomerDetail(selectedCustomer.phone_normalized);
    fetchCustomers();
  } catch (e) {
    console.error('Failed to save note:', e);
  }
  setSavingNote(false);
}

async function deleteNote(noteId) {
  if (!selectedCustomer) return;
  try {
    await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes/${noteId}`, {
      method: 'DELETE',
      headers: { password: savedPassword },
    });
    await fetchCustomerDetail(selectedCustomer.phone_normalized);
    fetchCustomers();
  } catch (e) {
    console.error('Failed to delete note:', e);
  }
}

async function saveContactLog() {
  if (!newLogSummary.trim() || !selectedCustomer) return;
  setSavingLog(true);
  try {
    await fetch(`/api/customers/${selectedCustomer.phone_normalized}/contact-log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ channel: newLogChannel, direction: 'outbound', summary: newLogSummary }),
    });
    setNewLogSummary('');
    await fetchCustomerDetail(selectedCustomer.phone_normalized);
  } catch (e) {
    console.error('Failed to save contact log:', e);
  }
  setSavingLog(false);
}

const custSearchTimer = useRef(null);
function handleCustSearchChange(val) {
  setCustSearch(val);
  clearTimeout(custSearchTimer.current);
  custSearchTimer.current = setTimeout(() => { setCustPage(1); fetchCustomers(1, { search: val }); }, 400);
}
```

- [ ] **Step 3: Add useEffect to auto-fetch customers on tab switch**

```js
useEffect(() => {
  if (activeTab === 'customers' && authed && customers.length === 0) {
    fetchCustomers(1);
    fetchCustStats();
  }
}, [activeTab, authed]);
```

- [ ] **Step 4: Replace the header with a tabbed version**

Replace the header div (the gradient bar with "Anchor Drops — Admin") with a version that includes tabs. The header should show the active tab context and include tab buttons for Orders and Customers.

- [ ] **Step 5: Wrap existing orders content in a conditional**

Wrap the Stats grid, Search+Sort bar, all modals, Orders table, and Pagination inside `{activeTab === 'orders' && (<>...</>)}`.

- [ ] **Step 6: Add the Customers tab content block**

After the orders conditional, add `{activeTab === 'customers' && (<>...</>)}` containing:
- Dashboard stats row (4 cards: Total Customers, Active This Month, New This Month, Top Spender)
- Search input + sort dropdown
- Customer table with columns: Customer, Phone, Orders, Total Spent, Last Order, Tags
- Clickable rows that call `fetchCustomerDetail(phone)`
- Pagination controls

- [ ] **Step 7: Add the Customer Detail slide-out panel**

Inside the customers conditional, add the slide-out panel that renders when `selectedCustomer` is set. Panel contains:
- Header with back button, customer name, Messenger badge
- Stats cards (Total Orders, Total Spent, Avg Order, Free Refills)
- Loyalty progress bar
- Customer info (phone, first/last order, messenger status)
- Notes section with add/delete
- Contact log timeline with manual entry form
- Order history table

- [ ] **Step 8: Verify in browser**

Run `npm run dev`, navigate to `/admin`, login.
- Orders tab should work exactly as before
- Customers tab shows stats + customer list
- Click a customer to open slide-out detail panel
- Add a note, verify it appears
- Log a contact interaction, verify it appears

- [ ] **Step 9: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(crm): add Customers tab with list, detail panel, notes, contact log UI"
```
