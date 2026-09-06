import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const { data: rows, error } = await getSupabase().from('customer_notes').select('tags');
    if (error) throw error;
    const tagSet = new Set();
    for (const r of rows) {
      for (const t of (r.tags || '').split(',')) {
        const trimmed = t.trim();
        if (trimmed) tagSet.add(trimmed);
      }
    }
    return res.status(200).json({ tags: [...tagSet].sort() });
  } catch (err) {
    console.error('Tags query failed:', err);
    return res.status(500).json({ error: 'Failed to load tags' });
  }
}
