import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeSegment, SEGMENT_VALUES } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 3 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const supabase = getSupabase();
    const search = (req.query.search || '').trim();
    const tagFilter = (req.query.tag || '').trim();
    const sortParam = req.query.sort || 'last_order_desc';
    const segmentFilter = (req.query.segment || '').trim();
    const hasSegment = segmentFilter.length > 0 && SEGMENT_VALUES.has(segmentFilter);

    const sortMap = {
      last_order_desc: ['last_order', false], last_order_asc: ['last_order', true],
      total_spent_desc: ['total_spent', false], total_spent_asc: ['total_spent', true],
      total_orders_desc: ['total_orders', false], total_orders_asc: ['total_orders', true],
      name_asc: ['customer_name', true], name_desc: ['customer_name', false],
    };
    const [sortCol, sortAsc] = sortMap[sortParam] || sortMap.last_order_desc;

    let query = supabase.from('customer_stats').select('*').limit(10000);
    if (search) query = query.ilike('customer_name', `%${search}%`);
    if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`);
    query = query.order(sortCol, { ascending: sortAsc });

    const { data: rows, error } = await query;
    if (error) throw error;

    const addSegment = (r) => ({ ...r, segment: computeSegment({ total_orders: Number(r.total_orders), total_spent: Number(r.total_spent), last_order: r.last_order }) });
    let customers = rows.map(addSegment);
    if (hasSegment) customers = customers.filter((c) => c.segment === segmentFilter);

    return res.status(200).json({ customers });
  } catch (err) {
    console.error('Customer export query failed:', err);
    return res.status(500).json({ error: 'Failed to export customers' });
  }
}
