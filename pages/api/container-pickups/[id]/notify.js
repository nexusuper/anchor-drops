import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { sendMessengerMessage } from '@/lib/facebook';
import { normalizePhone } from '@/lib/loyalty';
import { buildPickupStatusMessage } from '@/lib/notifications';
import { z } from 'zod';

const BodySchema = z.object({ status: z.enum(['scheduled', 'picked_up', 'delivered']), channel: z.enum(['sms', 'messenger']) });
const checkRate = rateLimit({ windowMs: 60_000, max: 20 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await checkRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { status, channel } = parsed.data;

  try {
    const supabase = getSupabase();
    const { id } = req.query;
    const { data: pickup } = await supabase.from('container_pickups').select('*').eq('id', id).single();
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });

    const message = buildPickupStatusMessage(pickup, status, channel);
    if (!message) return res.status(400).json({ error: 'No message template for this status' });

    if (channel === 'messenger') {
      if (!pickup.messenger_psid) {
        return res.status(400).json({ error: 'No Messenger linked', message: 'Customer has not linked their Messenger account. Use SMS instead.' });
      }
      await sendMessengerMessage(pickup.messenger_psid, message);
    }

    try {
      await supabase.from('contact_log').insert({
        branch_id: DEFAULT_BRANCH_ID,
        phone_normalized: normalizePhone(pickup.phone),
        channel, direction: 'outbound', summary: message, order_id: pickup.order_id,
      });
    } catch (logErr) {
      console.error('Pickup notify contact_log insert failed:', logErr);
    }

    return res.status(200).json({ success: true, phone: pickup.phone, message });
  } catch (err) {
    console.error('Pickup notify error:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
}
