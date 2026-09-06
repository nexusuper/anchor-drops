import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const { error } = await getSupabase()
    .from('customer_notes')
    .delete()
    .eq('id', req.query.id)
    .eq('phone_normalized', normalizePhone(req.query.phone));
  if (error) {
    console.error('Note delete failed:', error);
    return res.status(500).json({ error: 'Failed to delete note' });
  }
  return res.status(200).json({ success: true });
}
