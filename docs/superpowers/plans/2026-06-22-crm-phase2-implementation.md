# CRM Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customer segmentation, tag management, CSV export, and Messenger quick-send to the existing CRM admin panel.

**Architecture:** All four features build on the existing virtual-customer model (no new tables). Segments are computed at query time using a shared isomorphic function. Tags use existing `customer_notes.tags` storage. Export is a no-pagination variant of the customer list API. Messaging reuses `lib/facebook.js`.

**Tech Stack:** Next.js 16 (Pages Router), Neon Postgres (`@neondatabase/serverless`), React 19, Tailwind CSS 4, Zod, uuid

## Global Constraints

- All API endpoints require `verifyAdmin(req)` from `lib/auth.js`
- All API endpoints use `rateLimit()` from `lib/rate-limit.js`
- All user input validated with Zod schemas
- UI uses existing Clay component library (ClayCard, ClayButton, ClayIcon)
- IDs generated with `uuidv4().slice(0,8).toUpperCase()`
- Timestamps stored as ISO strings via `new Date().toISOString()`
- Phone identity key is always `phone_normalized` (digits only)
- The Neon `sql` tagged template does NOT support `sql.unsafe()` — use tagged template fragments for dynamic ORDER BY
- Currency is Philippine Pesos (PHP)

---

### Task 1: Segment Computation Library

**Files:**
- Create: `lib/segments.js`

**Interfaces:**
- Consumes: nothing (pure function)
- Produces: `computeSegment({ total_orders, total_spent, last_order })` returns one of `'new' | 'regular' | 'vip' | 'at-risk' | 'churned'`. Also exports `SEGMENT_DEFS` array with `{ value, label, color }` for UI rendering, and `SEGMENT_VALUES` set for validation.

- [ ] **Step 1: Create `lib/segments.js`**

```js
// Isomorphic customer segmentation — safe for both server and client.
export const SEGMENT_DEFS = [
  { value: 'new', label: 'New', color: 'bg-blue-100 text-blue-700' },
  { value: 'regular', label: 'Regular', color: 'bg-green-100 text-green-700' },
  { value: 'vip', label: 'VIP', color: 'bg-purple-100 text-purple-700' },
  { value: 'at-risk', label: 'At Risk', color: 'bg-orange-100 text-orange-700' },
  { value: 'churned', label: 'Churned', color: 'bg-red-100 text-red-700' },
];

export const SEGMENT_VALUES = new Set(SEGMENT_DEFS.map((s) => s.value));

export function computeSegment({ total_orders, total_spent, last_order }) {
  const daysSinceLast = (Date.now() - new Date(last_order).getTime()) / 86_400_000;
  if (total_orders >= 2 && daysSinceLast >= 30 && daysSinceLast < 60) return 'at-risk';
  if (daysSinceLast >= 60) return 'churned';
  if (total_orders >= 5 || total_spent >= 1500) return 'vip';
  if (total_orders >= 2) return 'regular';
  return 'new';
}
```

- [ ] **Step 2: Verify dev server starts without errors**

Run: `npm run dev` — load any page.
Expected: No errors. The file is not imported yet but should have no syntax issues.

- [ ] **Step 3: Commit**

```bash
git add lib/segments.js
git commit -m "feat(crm): add customer segmentation computation library"
```

---

### Task 2: Add Segments to Customer APIs

**Files:**
- Modify: `pages/api/customers/index.js`
- Modify: `pages/api/customers/stats.js`
- Modify: `pages/api/customers/[phone].js`

**Interfaces:**
- Consumes: `computeSegment()` and `SEGMENT_VALUES` from `lib/segments.js`
- Produces:
  - `GET /api/customers` — each row gains `segment` string field. New query param `segment` filters results.
  - `GET /api/customers/stats` — response gains `segmentCounts: { new, regular, vip, 'at-risk', churned }`.
  - `GET /api/customers/[phone]` — response gains `segment` string field.

- [ ] **Step 1: Modify `pages/api/customers/index.js` — add segment computation and filtering**

Add import at top:
```js
import { computeSegment, SEGMENT_VALUES } from '@/lib/segments';
```

After `const sortParam = ...` (line 30), add segment filter parsing:
```js
const segmentFilter = (req.query.segment || '').trim();
const hasSegment = segmentFilter.length > 0 && SEGMENT_VALUES.has(segmentFilter);
```

Replace the final return block (lines 151-157) with:

```js
    const total = countResult[0]?.total ?? 0;
    const withSegments = rows.map((r) => ({
      ...r,
      segment: computeSegment({
        total_orders: Number(r.total_orders),
        total_spent: Number(r.total_spent),
        last_order: r.last_order,
      }),
    }));
    const filtered = hasSegment ? withSegments.filter((r) => r.segment === segmentFilter) : withSegments;
    return res.status(200).json({
      customers: filtered,
      total: hasSegment ? filtered.length : total,
      page,
      totalPages: hasSegment ? 1 : Math.ceil(total / limit) || 1,
    });
```

- [ ] **Step 2: Modify `pages/api/customers/stats.js` — add segment counts**

Add import at top:
```js
import { computeSegment } from '@/lib/segments';
```

After `const top = topRes[0] || null;` (line 47), add:

```js
    const allCusts = await sql`
      SELECT
        COUNT(*)::int AS total_orders,
        SUM(total_amount)::real AS total_spent,
        MAX(created_at) AS last_order
      FROM orders
      GROUP BY phone_normalized
    `;
    const segmentCounts = { new: 0, regular: 0, vip: 0, 'at-risk': 0, churned: 0 };
    for (const c of allCusts) {
      const seg = computeSegment({
        total_orders: Number(c.total_orders),
        total_spent: Number(c.total_spent),
        last_order: c.last_order,
      });
      segmentCounts[seg]++;
    }
```

Add `segmentCounts` to the response object alongside the existing fields.

- [ ] **Step 3: Modify `pages/api/customers/[phone].js` — add segment to detail**

Add import at top:
```js
import { computeSegment } from '@/lib/segments';
```

Before the return statement (line 46), compute the segment:
```js
    const segment = computeSegment({
      total_orders: orders.length,
      total_spent: Math.round(totalSpent * 100) / 100,
      last_order: latest.created_at,
    });
```

Add `segment` to the response object alongside the existing fields.

- [ ] **Step 4: Verify all three endpoints return segment data**

Run `npm run dev`, then test:
- `GET /api/customers` — each customer should have a `segment` field
- `GET /api/customers/stats` — response should include `segmentCounts`
- `GET /api/customers/<phone>` — response should include `segment`

- [ ] **Step 5: Commit**

```bash
git add pages/api/customers/index.js pages/api/customers/stats.js pages/api/customers/[phone].js
git commit -m "feat(crm): add segment computation to customer list, stats, and detail APIs"
```

---

### Task 3: Tags API Endpoint

**Files:**
- Create: `pages/api/customers/tags.js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`
- Produces: `GET /api/customers/tags` returns `{ tags: string[] }` — all unique tags across all customer notes, sorted alphabetically.

- [ ] **Step 1: Create `pages/api/customers/tags.js`**

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
    const rows = await sql`
      SELECT DISTINCT trim(unnest(string_to_array(tags, ','))) AS tag
      FROM customer_notes
      WHERE tags IS NOT NULL AND tags != ''
      ORDER BY tag
    `;
    return res.status(200).json({ tags: rows.map((r) => r.tag).filter(Boolean) });
  } catch (err) {
    console.error('Tags query failed:', err);
    return res.status(500).json({ error: 'Failed to load tags' });
  }
}
```

- [ ] **Step 2: Verify the endpoint responds**

Run: `npm run dev`, then test `GET /api/customers/tags` with the admin password header.
Expected: `{ tags: [] }` (empty if no notes with tags exist yet), or a list of tag strings.

- [ ] **Step 3: Commit**

```bash
git add pages/api/customers/tags.js
git commit -m "feat(crm): add tags list API endpoint"
```

---

### Task 4: Customer Export API Endpoint

**Files:**
- Create: `pages/api/customers/export.js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`, `computeSegment()` from `lib/segments.js`
- Produces: `GET /api/customers/export` returns `{ customers: [...] }` — all matching customers (no pagination), each with `segment` field. Accepts query params: `search`, `tag`, `segment`, `sort`.

- [ ] **Step 1: Create `pages/api/customers/export.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeSegment, SEGMENT_VALUES } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 10 });

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
    const search = (req.query.search || '').trim();
    const tagFilter = (req.query.tag || '').trim();
    const segmentFilter = (req.query.segment || '').trim();
    const sortParam = req.query.sort || 'last_order_desc';

    const hasSearch = search.length > 0;
    const searchPattern = `%${search}%`;
    const hasTag = tagFilter.length > 0;
    const tagPattern = `%${tagFilter}%`;
    const hasSegment = segmentFilter.length > 0 && SEGMENT_VALUES.has(segmentFilter);

    const sortMap = {
      last_order_desc: sql`last_order DESC`,
      last_order_asc: sql`last_order ASC`,
      total_spent_desc: sql`total_spent DESC`,
      total_spent_asc: sql`total_spent ASC`,
      total_orders_desc: sql`total_orders DESC`,
      total_orders_asc: sql`total_orders ASC`,
      name_asc: sql`customer_name ASC`,
      name_desc: sql`customer_name DESC`,
    };
    const orderBy = sortMap[sortParam] || sql`last_order DESC`;

    let rows;
    if (hasSearch && hasTag) {
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT string_agg(DISTINCT cn.tags, ',') FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized), '') AS tags
        FROM orders o
        WHERE (o.customer_name ILIKE ${searchPattern} OR o.phone ILIKE ${searchPattern})
          AND EXISTS (SELECT 1 FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized AND cn.tags ILIKE ${tagPattern})
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT 10000
      `;
    } else if (hasSearch) {
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT string_agg(DISTINCT cn.tags, ',') FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized), '') AS tags
        FROM orders o
        WHERE o.customer_name ILIKE ${searchPattern} OR o.phone ILIKE ${searchPattern}
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT 10000
      `;
    } else if (hasTag) {
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT string_agg(DISTINCT cn.tags, ',') FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized), '') AS tags
        FROM orders o
        WHERE EXISTS (SELECT 1 FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized AND cn.tags ILIKE ${tagPattern})
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT 10000
      `;
    } else {
      rows = await sql`
        SELECT
          o.phone_normalized,
          MAX(o.customer_name) AS customer_name,
          COUNT(*)::int AS total_orders,
          SUM(o.total_amount)::real AS total_spent,
          MIN(o.created_at) AS first_order,
          MAX(o.created_at) AS last_order,
          BOOL_OR(o.messenger_psid IS NOT NULL) AS has_messenger,
          COALESCE((SELECT string_agg(DISTINCT cn.tags, ',') FROM customer_notes cn WHERE cn.phone_normalized = o.phone_normalized), '') AS tags
        FROM orders o
        GROUP BY o.phone_normalized
        ORDER BY ${orderBy}
        LIMIT 10000
      `;
    }

    let customers = rows.map((r) => ({
      ...r,
      segment: computeSegment({
        total_orders: Number(r.total_orders),
        total_spent: Number(r.total_spent),
        last_order: r.last_order,
      }),
    }));

    if (hasSegment) {
      customers = customers.filter((c) => c.segment === segmentFilter);
    }

    return res.status(200).json({ customers });
  } catch (err) {
    console.error('Customer export query failed:', err);
    return res.status(500).json({ error: 'Failed to export customers' });
  }
}
```

- [ ] **Step 2: Verify the endpoint responds**

Run: `npm run dev`, test `GET /api/customers/export` with the admin password header.
Expected: `{ customers: [...] }` with all customers, each having a `segment` field.

- [ ] **Step 3: Commit**

```bash
git add pages/api/customers/export.js
git commit -m "feat(crm): add customer export API endpoint"
```

---

### Task 5: Messenger Quick-Send API Endpoint

**Files:**
- Create: `pages/api/customers/[phone]/message.js`

**Interfaces:**
- Consumes: `initDb()`, `verifyAdmin()`, `rateLimit()`, `normalizePhone()` from `lib/loyalty.js`, `sendMessengerMessage()` from `lib/facebook.js`, `uuid`, `zod`
- Produces: `POST /api/customers/[phone]/message` — sends a Messenger message and auto-logs to `contact_log`. Request body: `{ message: string }`. Response: `{ success: true }`.

- [ ] **Step 1: Create `pages/api/customers/[phone]/message.js`**

```js
import { initDb } from '@/lib/db';
import { verifyAdmin } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { sendMessengerMessage } from '@/lib/facebook';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 15 });

const MessageSchema = z.object({
  message: z.string().min(1).max(2000),
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

  const parsed = MessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid message data' });
  }

  let sql;
  try {
    sql = await initDb();
  } catch (err) {
    console.error('DB init failed:', err);
    return res.status(500).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const orders = await sql`
      SELECT messenger_psid FROM orders
      WHERE phone_normalized = ${phone} AND messenger_psid IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (orders.length === 0 || !orders[0].messenger_psid) {
      return res.status(400).json({ error: 'Customer has no Messenger linked' });
    }

    const psid = orders[0].messenger_psid;
    await sendMessengerMessage(psid, parsed.data.message);

    const id = uuidv4().slice(0, 8).toUpperCase();
    const now = new Date().toISOString();
    await sql`
      INSERT INTO contact_log (id, phone_normalized, channel, direction, summary, order_id, created_at)
      VALUES (${id}, ${phone}, 'messenger', 'outbound', ${parsed.data.message}, ${null}, ${now})
    `;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Messenger send failed:', err);
    return res.status(500).json({ error: err.message || 'Failed to send message' });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/api/customers/[phone]/message.js
git commit -m "feat(crm): add Messenger quick-send API endpoint"
```

---

### Task 6: Add New Icons to ClayIcon

**Files:**
- Modify: `components/ui/ClayIcon.js`

**Interfaces:**
- Produces: New icon names: `download`, `send`, `plus`, `x-circle`

- [ ] **Step 1: Add icons to the PATHS object**

After the existing `'arrow-left'` entry in `components/ui/ClayIcon.js`, add:

```js
download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>,
send: <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></>,
plus: <path d="M12 5v14M5 12h14" />,
'x-circle': <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
```

- [ ] **Step 2: Commit**

```bash
git add components/ui/ClayIcon.js
git commit -m "feat(crm): add download, send, plus, x-circle icons"
```

---

### Task 7: Admin Panel UI — Segmentation, Tags, Export, Messaging

**Files:**
- Modify: `components/AdminPanel.js`

**Interfaces:**
- Consumes: All APIs from Tasks 2-5, `SEGMENT_DEFS` from `lib/segments.js`, new icons from Task 6

This is the largest task. It modifies the AdminPanel to add:
1. Segment filter row + badges in list and detail
2. Tag autocomplete + inline tag chips + tag filter dropdown
3. CSV export button in toolbar
4. Messenger quick-send in detail panel

- [ ] **Step 1: Add imports and new state variables**

Add import at the top of `components/AdminPanel.js`:
```js
import { SEGMENT_DEFS } from '@/lib/segments';
```

After the existing CRM state variables (after `const [savingLog, setSavingLog] = useState(false);` line 127), add:

```js
const [custSegment, setCustSegment] = useState('');
const [allTags, setAllTags] = useState([]);
const [custTagFilter, setCustTagFilter] = useState('');
const [exporting, setExporting] = useState(false);
const [quickMessage, setQuickMessage] = useState('');
const [sendingMessage, setSendingMessage] = useState(false);
const [messageResult, setMessageResult] = useState(null);
const [showTagInput, setShowTagInput] = useState(false);
const [tagInputValue, setTagInputValue] = useState('');
```

- [ ] **Step 2: Add tag fetching, export, messaging, and tag management functions**

After the `handleCustSearchChange` function, add:

```js
async function fetchAllTags() {
  try {
    const res = await fetch('/api/customers/tags', { headers: { password: savedPassword } });
    if (res.ok) {
      const data = await res.json();
      setAllTags(data.tags || []);
    }
  } catch (e) {
    console.error('Failed to fetch tags:', e);
  }
}

async function exportCSV() {
  setExporting(true);
  try {
    const params = new URLSearchParams({ sort: custSort });
    if (custSearch) params.set('search', custSearch);
    if (custTagFilter) params.set('tag', custTagFilter);
    if (custSegment) params.set('segment', custSegment);
    const res = await fetch(`/api/customers/export?${params}`, { headers: { password: savedPassword } });
    if (!res.ok) throw new Error('Export failed');
    const data = await res.json();
    const headers = ['Name', 'Phone', 'Total Orders', 'Total Spent', 'First Order', 'Last Order', 'Segment', 'Tags'];
    const csvRows = [headers.join(',')];
    for (const c of data.customers) {
      const row = [
        `"${(c.customer_name || '').replace(/"/g, '""')}"`,
        c.phone_normalized,
        c.total_orders,
        c.total_spent,
        c.first_order || '',
        c.last_order || '',
        c.segment || '',
        `"${(c.tags || '').replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `anchor-drops-customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error('Export failed:', e);
  }
  setExporting(false);
}

async function sendQuickMessage() {
  if (!quickMessage.trim() || !selectedCustomer) return;
  setSendingMessage(true);
  setMessageResult(null);
  try {
    const res = await fetch(`/api/customers/${selectedCustomer.phone_normalized}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ message: quickMessage }),
    });
    const data = await res.json();
    if (res.ok) {
      setMessageResult({ success: true });
      setQuickMessage('');
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
    } else {
      setMessageResult({ error: data.error || 'Failed to send' });
    }
  } catch (e) {
    setMessageResult({ error: 'Network error' });
  }
  setSendingMessage(false);
}

async function addTagToCustomer(tag) {
  if (!tag.trim() || !selectedCustomer) return;
  const existingTags = (selectedCustomer.notes || []).flatMap((n) =>
    typeof n.tags === 'string' ? n.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
  );
  if (existingTags.includes(tag.trim())) return;
  try {
    await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ content: `Tag added: ${tag.trim()}`, tags: tag.trim() }),
    });
    setTagInputValue('');
    setShowTagInput(false);
    await fetchCustomerDetail(selectedCustomer.phone_normalized);
    fetchCustomers();
    fetchAllTags();
  } catch (e) {
    console.error('Failed to add tag:', e);
  }
}
```

- [ ] **Step 3: Update the useEffect to fetch tags when switching to customers tab**

Replace the existing customers tab `useEffect`:

```js
useEffect(() => {
  if (activeTab === 'customers' && authed) {
    if (customers.length === 0) fetchCustomers(1);
    fetchCustStats();
    fetchAllTags();
  }
}, [activeTab, authed]);
```

- [ ] **Step 4: Update `fetchCustomers` to pass segment and tag filters**

In the `fetchCustomers` function, after `if (s) params.set('search', s);`, add:

```js
const seg = overrides?.segment ?? custSegment;
if (seg) params.set('segment', seg);
const tag = overrides?.tag ?? custTagFilter;
if (tag) params.set('tag', tag);
```

- [ ] **Step 5: Add segment filter row below the stats dashboard**

After the closing `</div>` of the stats dashboard grid (the `grid-cols-2 md:grid-cols-4` div), add:

```jsx
{/* Segment Filter */}
{custStats?.segmentCounts && (
  <div className="flex flex-wrap gap-2 mb-4">
    <button
      onClick={() => { setCustSegment(''); fetchCustomers(1, { segment: '' }); }}
      className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (!custSegment ? 'bg-sky-600 text-white' : 'clay-raised-sm text-gray-600 hover:bg-sky-50')}
    >
      All ({custStats.totalCustomers})
    </button>
    {SEGMENT_DEFS.map((seg) => (
      <button
        key={seg.value}
        onClick={() => { setCustSegment(seg.value); fetchCustomers(1, { segment: seg.value }); }}
        className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (custSegment === seg.value ? seg.color + ' ring-2 ring-offset-1 ring-sky-400' : seg.color + ' opacity-70 hover:opacity-100')}
      >
        {seg.label} ({custStats.segmentCounts[seg.value] || 0})
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 6: Replace the search toolbar with tag filter + export button**

Replace the existing customer search + sort `<div className="flex flex-col sm:flex-row gap-3 mb-4">` block with:

```jsx
<div className="flex flex-col sm:flex-row gap-3 mb-4">
  <input
    type="text"
    value={custSearch}
    onChange={(e) => handleCustSearchChange(e.target.value)}
    placeholder="Search customers by name or phone..."
    className="clay-input flex-1"
  />
  {allTags.length > 0 && (
    <select
      value={custTagFilter}
      onChange={(e) => { setCustTagFilter(e.target.value); fetchCustomers(1, { tag: e.target.value }); setCustPage(1); }}
      className="clay-input"
    >
      <option value="">All Tags</option>
      {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )}
  <select
    value={custSort}
    onChange={(e) => { setCustSort(e.target.value); fetchCustomers(1, { sort: e.target.value }); setCustPage(1); }}
    className="clay-input"
  >
    <option value="last_order_desc">Last Order: Newest</option>
    <option value="last_order_asc">Last Order: Oldest</option>
    <option value="total_spent_desc">Spent: High to Low</option>
    <option value="total_spent_asc">Spent: Low to High</option>
    <option value="total_orders_desc">Orders: Most</option>
    <option value="total_orders_asc">Orders: Fewest</option>
    <option value="name_asc">Name: A to Z</option>
    <option value="name_desc">Name: Z to A</option>
  </select>
  <button
    onClick={exportCSV}
    disabled={exporting}
    className="clay-btn-white clay-pressable rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
  >
    <ClayIcon name="download" className="w-4 h-4" />
    {exporting ? 'Exporting...' : 'Export CSV'}
  </button>
</div>
```

- [ ] **Step 7: Add segment column to customer table**

In the customer table `<thead>`, after the Tags `<th>`, add:

```jsx
<th className="text-left px-4 py-3 font-semibold text-gray-600">Segment</th>
```

In the `customers.map()` row, after the tags `<td>`, add:

```jsx
<td className="px-4 py-3">
  {c.segment && (() => {
    const def = SEGMENT_DEFS.find((s) => s.value === c.segment);
    return def ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${def.color}`}>{def.label}</span> : null;
  })()}
</td>
```

- [ ] **Step 8: Add segment badge and inline tags to customer detail header**

In the detail panel header, after the phone `<p>` tag and inside the `<div className="flex-1">`, add:

```jsx
<div className="flex flex-wrap items-center gap-1.5 mt-1">
  {selectedCustomer.segment && (() => {
    const def = SEGMENT_DEFS.find((s) => s.value === selectedCustomer.segment);
    return def ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${def.color}`}>{def.label}</span> : null;
  })()}
  {selectedCustomer.notes && selectedCustomer.notes.flatMap((n) =>
    (typeof n.tags === 'string' ? n.tags.split(',').filter(Boolean) : [])
  ).filter((v, i, a) => a.indexOf(v) === i).map((t) => (
    <span key={t} className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">{t.trim()}</span>
  ))}
  {!showTagInput ? (
    <button onClick={() => setShowTagInput(true)} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-full transition-colors">
      <ClayIcon name="plus" className="w-3 h-3 inline" /> Tag
    </button>
  ) : (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={tagInputValue}
        onChange={(e) => setTagInputValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addTagToCustomer(tagInputValue); if (e.key === 'Escape') { setShowTagInput(false); setTagInputValue(''); } }}
        placeholder="Add tag..."
        list="tag-suggestions"
        className="text-xs bg-white/20 border-0 rounded-full px-2 py-0.5 text-white placeholder-white/50 outline-none w-24"
        autoFocus
      />
      <datalist id="tag-suggestions">
        {allTags.map((t) => <option key={t} value={t} />)}
      </datalist>
      <button onClick={() => { setShowTagInput(false); setTagInputValue(''); }} className="text-white/60 hover:text-white">
        <ClayIcon name="close" className="w-3 h-3" />
      </button>
    </div>
  )}
</div>
```

- [ ] **Step 9: Add Messenger quick-send section to detail panel**

After the Contact Log section's closing `</div>`, before the Order History section, add:

```jsx
{/* Messenger Quick-Send */}
{selectedCustomer.has_messenger && (
  <div className="clay-raised-sm rounded-2xl p-4">
    <h3 className="text-sm font-semibold text-gray-700 mb-3">
      <ClayIcon name="send" className="w-4 h-4 inline mr-1" /> Send Messenger Message
    </h3>
    <div className="flex gap-2">
      <input
        type="text"
        value={quickMessage}
        onChange={(e) => setQuickMessage(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !sendingMessage) sendQuickMessage(); }}
        placeholder="Type a message..."
        className="clay-input flex-1 text-sm"
      />
      <button
        onClick={sendQuickMessage}
        disabled={sendingMessage || !quickMessage.trim()}
        className="clay-btn-primary clay-pressable rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
      >
        {sendingMessage ? '...' : 'Send'}
      </button>
    </div>
    {messageResult && (
      <div className={`mt-2 text-xs font-medium ${messageResult.success ? 'text-green-600' : 'text-red-500'}`}>
        {messageResult.success ? 'Message sent!' : messageResult.error}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 10: Reset quick-send and tag state when selecting a new customer**

In the `fetchCustomerDetail` function, after the existing state resets (`setNewLogChannel('manual');`), add:

```js
setQuickMessage('');
setMessageResult(null);
setShowTagInput(false);
setTagInputValue('');
```

- [ ] **Step 11: Verify in browser**

Run `npm run dev`, navigate to `/admin`, login, switch to the Customers tab.
Verify:
- Segment filter row appears below stats, each segment shows count
- Segment badges appear in the customer table and detail panel
- Tag filter dropdown appears in the toolbar (if tags exist)
- Export CSV button downloads a file
- Tag chips appear in detail header with "+" button to add
- Messenger quick-send section appears for customers with Messenger linked

- [ ] **Step 12: Commit**

```bash
git add components/AdminPanel.js
git commit -m "feat(crm): add segmentation, tag management, CSV export, Messenger quick-send UI"
```
