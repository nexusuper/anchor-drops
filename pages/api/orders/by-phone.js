import { getSupabase } from '@/lib/supabaseAdmin';
import { normalizePhone } from '@/lib/loyalty';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const checkRate = rateLimit({ windowMs: 60_000, max: 10 });
const QuerySchema = z.object({
  phone: z.string().min(1).max(20),
  // '1' switches to the reorder payload: the caller is seeding a new order form
  // with their own last order, so it also returns full name + street address.
  reorder: z.literal('1').optional(),
});

// Legacy 'am'/'pm' slot echo — mirror pages/api/orders/[id].js.
const legacySlot = (t) => (t === 'am' || t === 'pm' ? t : null);

// Public "track by phone" lookup. The phone is UNVERIFIED (no OTP / no Order ID),
// so this returns the same minimal, non-doxxing field set as the unmatched-phone
// branch of /api/orders/[id] — first name + status + area, deliberately NO street
// address, so a known or guessed number can't reveal someone's home address.
// Only orders from the last 60 days are returned, and the endpoint is rate-limited.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRate(req, res)) return;

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid phone number' });
  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 7) return res.status(400).json({ error: 'Enter a valid phone number' });

  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
  try {
    const { data: rows, error } = await getSupabase()
      .from('orders')
      .select('id, order_number, status, created_at, product_type, container_size, quantity, total_amount, customer_name, voucher_count, voucher_discount, reward_requested, delivery_date, delivery_time, pickup_date, pickup_time, barangay, address')
      .eq('phone_normalized', phone)
      .gte('created_at', sixtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: 'No recent order found for that number. Try your Order ID instead.' });

    if (parsed.data.reorder === '1') {
      return res.status(200).json({
        id: order.id, order_number: order.order_number, status: order.status, created_at: order.created_at,
        product_type: order.product_type, container_size: order.container_size,
        quantity: order.quantity, total_amount: order.total_amount,
        customer_name: order.customer_name,
        address: order.address, barangay: order.barangay,
        voucher_count: order.voucher_count, voucher_discount: order.voucher_discount,
        reward_requested: order.reward_requested,
        delivery_slot: legacySlot(order.delivery_time), delivery_date: order.delivery_date,
        has_empty_containers: !!order.pickup_date,
        pickup_date: order.pickup_date, pickup_time: order.pickup_time,
        delivery_time: order.delivery_time,
      });
    }

    // Unverified lookup: no schedule and no money. Knowing when someone's
    // delivery lands is knowing when they're home, so those fields are withheld
    // until the caller proves the number is theirs (Order ID or reorder seed).
    return res.status(200).json({
      id: order.id, order_number: order.order_number, status: order.status, created_at: order.created_at,
      product_type: order.product_type, container_size: order.container_size,
      quantity: order.quantity,
      customer_name: (order.customer_name || '').trim().split(/\s+/)[0] || order.customer_name,
      barangay: order.barangay,
      voucher_count: order.voucher_count, voucher_discount: order.voucher_discount,
      reward_requested: order.reward_requested,
      has_empty_containers: !!order.pickup_date,
    });
  } catch (err) {
    console.error('Track-by-phone failed:', err);
    return res.status(500).json({ error: 'Could not look up your order' });
  }
}
