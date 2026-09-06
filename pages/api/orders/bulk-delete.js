import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 10 });
const BodySchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  const { error, count } = await getSupabase()
    .from('orders')
    .delete({ count: 'exact' })
    .in('id', parsed.data.ids)
    .in('status', ['delivered', 'cancelled']);
  if (error) {
    console.error('Bulk delete failed:', error);
    return res.status(500).json({ error: 'Failed to delete orders' });
  }
  return res.status(200).json({ deleted: count ?? 0 });
}
