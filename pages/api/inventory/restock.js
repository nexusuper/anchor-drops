import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
// Any inventory row, including supply items added at runtime; adjust_inventory
// raises for an unknown SKU.
const RestockSchema = z.object({ product_id: z.string().regex(/^[a-z0-9_]{1,64}$/), quantity: z.coerce.number().int().min(1).max(100000) });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = RestockSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid restock data' });

  try {
    const { data: updated, error } = await getSupabase().rpc('adjust_inventory', {
      p_branch_id: DEFAULT_BRANCH_ID, p_product_id: parsed.data.product_id, p_delta: parsed.data.quantity, p_type: 'restock', p_reason: '',
    });
    if (error) throw error;
    return res.status(200).json({ success: true, current_stock: updated.current_stock });
  } catch (err) {
    console.error('Restock failed:', err);
    return res.status(500).json({ error: 'Failed to restock' });
  }
}
