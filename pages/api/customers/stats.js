import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeSegment } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const { data: rows, error } = await getSupabase().from('customer_stats').select('*');
    if (error) throw error;

    const today = new Date();
    const monthPrefix = today.toISOString().slice(0, 7);
    const totalCustomers = rows.length;
    const activeThisMonth = rows.filter((r) => (r.last_order || '').slice(0, 7) === monthPrefix).length;
    const newThisMonth = rows.filter((r) => (r.first_order || '').slice(0, 7) === monthPrefix).length;
    const topSpenderRow = [...rows].sort((a, b) => Number(b.total_spent) - Number(a.total_spent))[0] || null;
    const topSpender = topSpenderRow
      ? { name: topSpenderRow.customer_name, phone: topSpenderRow.phone_normalized, total_spent: topSpenderRow.total_spent }
      : null;

    const segmentCounts = {};
    for (const r of rows) {
      const seg = computeSegment({ total_orders: Number(r.total_orders), total_spent: Number(r.total_spent), last_order: r.last_order });
      segmentCounts[seg] = (segmentCounts[seg] || 0) + 1;
    }

    return res.status(200).json({ totalCustomers, activeThisMonth, newThisMonth, topSpender, segmentCounts });
  } catch (err) {
    console.error('Customer stats query failed:', err);
    return res.status(500).json({ error: 'Failed to load stats' });
  }
}
