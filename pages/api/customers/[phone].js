import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { computeSegment } from '@/lib/segments';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

  try {
    const supabase = getSupabase();
    const [ordersRes, notesRes, contactLogRes, ledgerRes] = await Promise.all([
      supabase.from('orders').select('*').eq('phone_normalized', phone).order('created_at', { ascending: false }),
      supabase.from('customer_notes').select('*').eq('phone_normalized', phone).order('updated_at', { ascending: false }),
      supabase.from('contact_log').select('*').eq('phone_normalized', phone).order('created_at', { ascending: false }).limit(50),
      supabase.from('container_ledger').select('*').eq('phone_normalized', phone).order('created_at', { ascending: false }),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    const orders = ordersRes.data;
    if (orders.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const latest = orders[0];
    const totalSpent = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);
    const hasMessenger = orders.some((o) => o.messenger_psid);
    const loyalty = computeRewards(orders);
    const segment = computeSegment({ total_orders: orders.length, total_spent: Math.round(totalSpent * 100) / 100, last_order: latest.created_at });

    // The ledger is now the single source: deliveries write 'delivery_out',
    // pickups write 'pickup_return', manual edits write 'adjustment'. The old
    // derive-from-delivered-orders sum was dropped so it can't double-count.
    const ledger = ledgerRes.data || [];
    const containers_out = ledger.reduce((sum, a) => sum + (Number(a.delta) || 0), 0);

    return res.status(200).json({
      customer_name: latest.customer_name,
      phone_normalized: phone,
      phone_display: latest.phone,
      total_orders: orders.length,
      total_spent: Math.round(totalSpent * 100) / 100,
      first_order: orders[orders.length - 1].created_at,
      last_order: latest.created_at,
      has_messenger: hasMessenger,
      segment,
      loyalty,
      containers_out,
      // `reason` is what the drawer renders; the column is `note`.
      containerAdjustments: ledger.map((a) => ({ ...a, reason: a.note })),
      orders,
      notes: notesRes.data || [],
      contactLog: contactLogRes.data || [],
    });
  } catch (err) {
    console.error('Customer detail query failed:', err);
    return res.status(500).json({ error: 'Failed to load customer' });
  }
}
