import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { computeRewards, normalizePhone, VOUCHER_VALUE } from '@/lib/loyalty';

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

  const { data: history } = await supabase
    .from('orders').select('status, container_size, quantity, voucher_count').eq('phone_normalized', normalizePhone(order.phone));
  const { available } = computeRewards(history || []);

  const applied = Math.min(order.reward_requested, available, order.quantity);
  const voucher_count = order.voucher_count + applied;
  const voucher_discount = order.voucher_discount + applied * VOUCHER_VALUE;
  const total_amount = Math.max(0, Number(order.total_amount) - applied * VOUCHER_VALUE);

  // Guard against two admins (or a double click) applying a reward on the same
  // order concurrently: both would read the same stale `reward_requested` and
  // `available` and could double-credit. The eq('reward_requested', ...) makes
  // the write a no-op for whichever request loses the race — .select() then
  // comes back empty and we report the conflict instead of a false success.
  const { data: updated, error } = await supabase
    .from('orders')
    .update({ voucher_count, voucher_discount, total_amount, reward_requested: 0 })
    .eq('id', id)
    .eq('reward_requested', order.reward_requested)
    .select('id');
  if (error) {
    console.error('Apply reward failed:', error);
    return res.status(500).json({ error: 'Failed to apply reward' });
  }
  if (!updated?.length) {
    return res.status(409).json({ error: 'Reward already applied by another request — refresh and check.' });
  }

  return res.status(200).json({ success: true, applied, voucher_count, voucher_discount, total_amount });
}
