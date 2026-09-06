import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const MILESTONE = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

  try {
    const supabase = getSupabase();
    const [ordersRes, redemptionsRes] = await Promise.all([
      supabase.from('orders').select('id, created_at, customer_name, product_type, quantity, total_amount, status, sale_channel')
        .eq('phone_normalized', phone).order('created_at', { ascending: false }),
      supabase.from('loyalty_milestone_redemptions').select('*')
        .eq('phone_normalized', phone).order('milestone_number', { ascending: false }),
    ]);
    if (ordersRes.error) throw ordersRes.error;
    if (redemptionsRes.error) throw redemptionsRes.error;

    const orders = ordersRes.data || [];
    if (orders.length === 0) return res.status(404).json({ error: 'Customer not found' });

    const totalOrders = orders.length;
    const earned = Math.floor(totalOrders / MILESTONE);
    const redemptions = redemptionsRes.data || [];

    return res.status(200).json({
      phone_normalized: phone,
      customer_name: orders[0].customer_name,
      total_orders: totalOrders,
      vouchers_earned: earned,
      vouchers_redeemed: redemptions.length,
      vouchers_unredeemed: Math.max(0, earned - redemptions.length),
      orders,
      redemptions,
    });
  } catch (err) {
    console.error('Loyalty detail query failed:', err);
    return res.status(500).json({ error: 'Failed to load loyalty detail' });
  }
}
