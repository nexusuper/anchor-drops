import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeSegment, SEGMENT_VALUES } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const supabase = getSupabase();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
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

    let query = supabase.from('customer_stats').select('*', { count: 'exact' });
    if (search) query = query.ilike('customer_name', `%${search}%`);
    if (tagFilter) query = query.ilike('tags', `%${tagFilter}%`);
    query = query.order(sortCol, { ascending: sortAsc });

    const addSegment = (r) => ({ ...r, segment: computeSegment({ total_orders: Number(r.total_orders), total_spent: Number(r.total_spent), last_order: r.last_order }) });

    if (hasSegment) {
      const { data: allRows, error } = await query;
      if (error) throw error;
      const filtered = allRows.map(addSegment).filter((r) => r.segment === segmentFilter);
      return res.status(200).json({
        customers: filtered.slice(offset, offset + limit),
        total: filtered.length,
        page,
        totalPages: Math.ceil(filtered.length / limit) || 1,
      });
    }

    const { data: rows, count: total, error } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    return res.status(200).json({
      customers: rows.map(addSegment),
      total: total ?? 0,
      page,
      totalPages: Math.ceil((total ?? 0) / limit) || 1,
    });
  } catch (err) {
    console.error('Customer list query failed:', err);
    return res.status(500).json({ error: 'Failed to load customers' });
  }
}
