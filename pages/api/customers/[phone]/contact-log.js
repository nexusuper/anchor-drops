import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const BodySchema = z.object({
  channel: z.string().min(1).max(30),
  direction: z.enum(['inbound', 'outbound']),
  summary: z.string().min(1).max(2000),
  order_id: z.string().uuid().optional().nullable(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid contact log entry' });

  const phone = normalizePhone(req.query.phone);
  const { error } = await getSupabase().from('contact_log').insert({
    branch_id: DEFAULT_BRANCH_ID,
    phone_normalized: phone,
    ...parsed.data,
  });
  if (error) {
    console.error('Contact log insert failed:', error);
    return res.status(500).json({ error: 'Failed to log contact' });
  }
  return res.status(201).json({ success: true });
}
