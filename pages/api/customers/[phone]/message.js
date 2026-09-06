import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { sendMessengerMessage } from '@/lib/facebook';
import { normalizePhone } from '@/lib/loyalty';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 20 });
const BodySchema = z.object({ message: z.string().min(1).max(2000) });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid message' });

  const supabase = getSupabase();
  const phone = normalizePhone(req.query.phone);
  const { data: rows } = await supabase
    .from('orders')
    .select('messenger_psid')
    .eq('phone_normalized', phone)
    .not('messenger_psid', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const psid = rows?.[0]?.messenger_psid;
  if (!psid) return res.status(400).json({ error: 'No Messenger account linked for this customer' });

  try {
    await sendMessengerMessage(psid, parsed.data.message);
  } catch (err) {
    console.error('Message send failed:', err);
    return res.status(500).json({ error: 'Failed to send message' });
  }

  await supabase.from('contact_log').insert({
    branch_id: DEFAULT_BRANCH_ID, phone_normalized: phone,
    channel: 'messenger', direction: 'outbound', summary: parsed.data.message, order_id: null,
  });

  return res.status(200).json({ success: true });
}
