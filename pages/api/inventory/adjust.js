import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
// Any inventory row, including supply items added at runtime — so a SKU pattern,
// not the static PRODUCTS list. The row lookup below rejects unknown SKUs.
const AdjustSchema = z.object({
  product_id: z.string().regex(/^[a-z0-9_]{1,64}$/),
  delta: z.coerce.number().int().min(-100000).max(100000).optional().default(0),
  set_stock: z.coerce.number().int().min(0).max(100000).optional(),
  reason: z.string().max(200).optional().default(''),
  threshold: z.coerce.number().int().min(0).max(100000).optional(),
  name: z.string().trim().min(1).max(60).optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = AdjustSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid adjustment data' });
  const { product_id, set_stock, reason, threshold, name } = parsed.data;
  let { delta } = parsed.data;

  const supabase = getSupabase();
  try {
    const { data: row, error: rowErr } = await supabase
      .from('inventory').select('current_stock')
      .eq('branch_id', DEFAULT_BRANCH_ID).eq('product_id', product_id).maybeSingle();
    if (rowErr) throw rowErr;
    if (!row) return res.status(404).json({ error: 'Stock item not found' });

    // ponytail: set_stock is read-then-adjust, so a sale landing in between is
    // overwritten by the typed count. Fine for a manual physical count.
    if (set_stock !== undefined) delta = set_stock - row.current_stock;
    if (delta === 0 && threshold === undefined && name === undefined) {
      return res.status(400).json({ error: 'Nothing to change' });
    }

    let current = row.current_stock;
    if (delta !== 0) {
      const { data: updated, error } = await supabase.rpc('adjust_inventory', {
        p_branch_id: DEFAULT_BRANCH_ID, p_product_id: product_id, p_delta: delta, p_type: 'adjustment',
        p_reason: reason || (set_stock !== undefined ? 'Stock count set' : ''),
      });
      if (error) {
        if (String(error.message || '').includes('chk_inventory_stock_nonneg')) {
          return res.status(400).json({ error: 'Stock cannot go below 0' });
        }
        throw error;
      }
      current = updated.current_stock;
    }
    if (threshold !== undefined) {
      const { error } = await supabase.from('inventory').update({ low_stock_threshold: threshold })
        .eq('branch_id', DEFAULT_BRANCH_ID).eq('product_id', product_id);
      if (error) throw error;
    }
    if (name !== undefined) {
      // Inventory names live on products.name (shared with the staff app's POS and
      // reports). The website's order form keeps its own names in lib/products.js.
      const { error } = await supabase.from('products').update({ name }).eq('sku', product_id);
      if (error) throw error;
    }
    return res.status(200).json({ success: true, current_stock: current });
  } catch (err) {
    console.error('Adjust failed:', err);
    return res.status(500).json({ error: 'Failed to adjust' });
  }
}
