import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const ToggleSchema = z.object({ sku: z.string().min(1), is_active: z.boolean() });

export default async function handler(req, res) {
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('products').select('*').order('sort_order');
    if (error) return res.status(500).json({ error: 'Failed to load products' });
    return res.status(200).json({ products: data || [] });
  }

  if (req.method === 'PATCH') {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { sku, is_active } = parsed.data;
    const { data, error } = await supabase.from('products').update({ is_active }).eq('sku', sku).select('sku');
    if (error) return res.status(500).json({ error: 'Failed to update product' });
    if (!data || data.length === 0) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
