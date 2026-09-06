import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const BodySchema = z.object({ content: z.string().min(1).max(2000), tags: z.string().max(500).optional().default('') });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid note' });

  const { data, error } = await getSupabase().from('customer_notes').insert({
    branch_id: DEFAULT_BRANCH_ID,
    phone_normalized: normalizePhone(req.query.phone),
    content: parsed.data.content,
    tags: parsed.data.tags,
  }).select().single();
  if (error) {
    console.error('Note insert failed:', error);
    return res.status(500).json({ error: 'Failed to add note' });
  }
  return res.status(201).json(data);
}
