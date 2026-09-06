import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const supabase = getSupabase();
    const statusFilter = req.query.status || '';
    const sortParam = req.query.sort || 'pickup_date_asc';
    const validStatuses = ['scheduled', 'picked_up', 'delivered', 'cancelled'];
    const hasStatus = validStatuses.includes(statusFilter);

    const sortMap = {
      pickup_date_asc: ['pickup_date', true], pickup_date_desc: ['pickup_date', false],
      status_asc: ['status', true], name_asc: ['customer_name', true], name_desc: ['customer_name', false],
    };
    const [sortCol, sortAsc] = sortMap[sortParam] || sortMap.pickup_date_asc;

    let query = supabase.from('container_pickups').select('*');
    if (hasStatus) query = query.eq('status', statusFilter);
    query = query.order(sortCol, { ascending: sortAsc });
    if (sortParam === 'pickup_date_asc' || sortParam === 'pickup_date_desc') {
      query = query.order('pickup_time', { ascending: true });
    }

    const [{ data: rows, error }, { data: statusRows }] = await Promise.all([
      query,
      supabase.from('container_pickups').select('status'),
    ]);
    if (error) throw error;

    const statusCounts = {};
    for (const r of statusRows || []) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

    return res.status(200).json({ pickups: rows, total: rows.length, statusCounts });
  } catch (err) {
    console.error('Container pickups list query failed:', err);
    return res.status(500).json({ error: 'Failed to load container pickups' });
  }
}
