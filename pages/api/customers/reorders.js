import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeReorderStatus } from '@/lib/reorder';
import { computeSegment } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 60 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const { data: rows, error } = await getSupabase()
      .from('orders')
      .select('phone_normalized, customer_name, phone, total_amount, created_at, messenger_psid')
      .not('phone_normalized', 'is', null)
      .neq('phone_normalized', '')
      .order('phone_normalized', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;

    const groups = new Map();
    for (const o of rows) {
      const key = o.phone_normalized;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }

    const customers = [];
    for (const [phone, list] of groups.entries()) {
      const reorder = computeReorderStatus(list);
      if (!reorder.eligible || reorder.status === 'ok') continue;

      const latest = list.reduce((a, b) =>
        Date.parse(a.created_at) >= Date.parse(b.created_at) ? a : b
      );
      const totalSpent = list.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
      const segment = computeSegment({
        total_orders: list.length,
        total_spent: totalSpent,
        last_order: latest.created_at,
      });
      if (segment === 'churned') continue;

      customers.push({
        phone_normalized: phone,
        phone_display: latest.phone,
        customer_name: latest.customer_name,
        last_order: latest.created_at,
        total_orders: list.length,
        avgIntervalDays: Math.round(reorder.avgIntervalDays * 10) / 10,
        daysSinceLast: Math.round(reorder.daysSinceLast * 10) / 10,
        daysOverdue: Math.round((reorder.daysSinceLast - reorder.avgIntervalDays) * 10) / 10,
        status: reorder.status,
        has_messenger: list.some((o) => o.messenger_psid),
      });
    }

    customers.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return res.status(200).json({ customers, count: customers.length });
  } catch (err) {
    console.error('Reorders query failed:', err);
    return res.status(500).json({ error: 'Failed to load reorder list' });
  }
}
