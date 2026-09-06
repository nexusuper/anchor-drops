import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS_BY_ID } from '@/lib/products';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const PRODUCT_IDS = Object.keys(PRODUCTS_BY_ID);
const AdjustSchema = z.object({
  product_id: z.enum(PRODUCT_IDS),
  delta: z.coerce.number().int().min(-10000).max(10000),
  reason: z.string().max(200).optional().default(''),
  threshold: z.coerce.number().int().min(0).max(10000).optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = AdjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid adjustment data' });
  const { product_id, delta, reason, threshold } = parsed.data;
  if (delta === 0 && threshold === undefined) return res.status(400).json({ error: 'Nothing to adjust' });

  const supabase = getSupabase();
  try {
    if (delta !== 0) {
      const { data: updated, error } = await supabase.rpc('adjust_inventory', {
        p_branch_id: DEFAULT_BRANCH_ID, p_product_id: product_id, p_delta: delta, p_type: 'adjustment', p_reason: reason,
      });
      if (error) throw error;
      if (threshold !== undefined) {
        await supabase.from('inventory').update({ low_stock_threshold: threshold }).eq('branch_id', DEFAULT_BRANCH_ID).eq('product_id', product_id);
      }
      return res.status(200).json({ success: true, current_stock: updated.current_stock });
    }

    const { data: updated, error } = await supabase
      .from('inventory').update({ low_stock_threshold: threshold })
      .eq('branch_id', DEFAULT_BRANCH_ID).eq('product_id', product_id)
      .select('current_stock').single();
    if (error) throw error;
    return res.status(200).json({ success: true, current_stock: updated.current_stock });
  } catch (err) {
    console.error('Adjust failed:', err);
    return res.status(500).json({ error: 'Failed to adjust' });
  }
}
