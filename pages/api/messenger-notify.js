import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { buildStatusMessage } from '@/lib/notifications';
import { sendMessengerMessage } from '@/lib/facebook';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const BodySchema = z.object({
  orderId: z.string().uuid(),
  status: z.enum(['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled']),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { orderId, status } = parsed.data;

  const supabase = getSupabase();
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.messenger_psid) return res.status(400).json({ error: 'No Messenger account linked to this order' });

  try {
    const text = buildStatusMessage(order, status, 'messenger');
    await sendMessengerMessage(order.messenger_psid, text);
    await supabase.from('contact_log').insert({
      branch_id: DEFAULT_BRANCH_ID, phone_normalized: normalizePhone(order.phone),
      channel: 'messenger', direction: 'outbound', summary: text, order_id: order.id,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Messenger notify failed:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
