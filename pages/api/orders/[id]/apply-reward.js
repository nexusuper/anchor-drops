import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const { id } = req.query;
  const supabase = getSupabase();

  const { data: order } = await supabase.from('orders').select('*').eq('id', id).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.reward_requested) return res.status(400).json({ error: 'No pending reward request on this order' });

  const { data, error } = await supabase.rpc('apply_order_reward', { p_order_id: id, p_voucher_count: null });
  if (error) {
    console.error('Apply reward failed:', error);
    return res.status(error.code === 'P0001' || error.code === 'P0002' ? 409 : 500)
      .json({ error: 'Reward could not be applied. Refresh the order and try again.' });
  }
  if (!data?.[0]) return res.status(500).json({ error: 'Failed to apply reward' });

  return res.status(200).json({ success: true, ...data[0] });
}
