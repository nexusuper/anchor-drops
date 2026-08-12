import { getSupabase } from '@/lib/supabaseAdmin';
import { normalizePhone } from '@/lib/loyalty';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const checkRate = rateLimit({ windowMs: 60_000, max: 10 });
const QuerySchema = z.object({
  phone: z.string().min(1).max(20),
});

// Public "track by phone" lookup. The phone is UNVERIFIED (no OTP / no Order ID),
// so this returns the same minimal, non-doxxing field set as the unmatched-phone
// branch of /api/orders/[id] — first name + status + area, deliberately NO street
// address, so a known or guessed number can't reveal someone's home address.
// Only orders from the last 60 days are returned, and the endpoint is rate-limited.
//
// It also deliberately withholds EVERY handle on the order — no UUID and no
// order_number. The customer self-cancel in /api/orders/[id] is gated on
// (order identifier, phone), so any identifier handed out here would be derivable
// from the phone and both halves of that gate would collapse into the phone
// alone. Returning order_number instead of the UUID does not help: the cancel
// path accepts either, and /api/orders/[order_number]?phone= would hand back the
// UUID anyway. The order number is the customer's proof of ownership, and it
// reaches them by a channel a stranger cannot read — the confirmation page they
// were redirected to, and the Messenger receipt. Do not add it back here.
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
      .select('status, created_at, product_type, container_size, quantity, customer_name, voucher_count, voucher_discount, reward_requested, pickup_date, barangay')
      .eq('phone_normalized', phone)
      .gte('created_at', sixtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const order = rows?.[0];
    if (!order) return res.status(404).json({ error: 'No recent order found for that number. Try your Order ID instead.' });

    // Unverified lookup: no schedule and no money. Knowing when someone's
    // delivery lands is knowing when they're home, so those fields are withheld
    // until the caller proves the number is theirs by quoting the Order ID.
    return res.status(200).json({
      status: order.status, created_at: order.created_at,
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
