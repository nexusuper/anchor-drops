import { randomUUID } from 'crypto';
import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

// A new stock type (caps, seals, stickers…) is a products row tagged 'supply':
// inventory.product_id must reference products.sku, and the staff app creates
// supplies the same way (anchor-drops-system src/api/inventory.ts). Inactive and
// zero-priced, so it is never sold on the site or POS.
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  starting_stock: z.coerce.number().int().min(0).max(100000).default(0),
  threshold: z.coerce.number().int().min(0).max(100000).default(10),
});

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();

  if (req.method === 'POST') {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid stock item' });
    const { name, starting_stock, threshold } = parsed.data;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'item';
    const sku = `supply_${slug}_${randomUUID().slice(0, 6)}`;
    try {
      const { error: prodErr } = await supabase.from('products').insert({
        sku, name, size: 'Supply', tag: 'supply', refill_price: 0, container_price: 0, is_active: false, sort_order: 100,
      });
      if (prodErr) throw prodErr;
      const { error: invErr } = await supabase.from('inventory').insert({
        branch_id: DEFAULT_BRANCH_ID, product_id: sku, current_stock: 0, low_stock_threshold: threshold,
      });
      if (invErr) {
        await supabase.from('products').delete().eq('sku', sku);
        throw invErr;
      }
      if (starting_stock > 0) {
        // Through the RPC so the starting count lands in inventory_log.
        const { error } = await supabase.rpc('adjust_inventory', {
          p_branch_id: DEFAULT_BRANCH_ID, p_product_id: sku, p_delta: starting_stock, p_type: 'restock', p_reason: 'Starting stock',
        });
        if (error) throw error;
      }
      return res.status(201).json({ success: true, product_id: sku });
    } catch (err) {
      console.error('Create stock item failed:', err);
      return res.status(500).json({ error: 'Failed to add stock item' });
    }
  }

  try {
    const [{ data: rows, error }, { data: products, error: prodErr }, { data: log, error: logErr }] = await Promise.all([
      supabase.from('inventory').select('product_id, current_stock, low_stock_threshold').eq('branch_id', DEFAULT_BRANCH_ID),
      supabase.from('products').select('sku, name, tag, stock_sku, sort_order'),
      supabase.from('inventory_log').select('*').eq('branch_id', DEFAULT_BRANCH_ID).order('created_at', { ascending: false }).limit(20),
    ]);
    if (error) throw error;
    if (prodErr) throw prodErr;
    if (logErr) throw logErr;

    const bySku = Object.fromEntries((products || []).map((p) => [p.sku, p]));
    const items = (rows || []).map((r) => {
      const p = bySku[r.product_id];
      const stock = Number(r.current_stock) || 0;
      const threshold = Number(r.low_stock_threshold) || 0;
      return {
        product_id: r.product_id,
        name: p?.name || r.product_id,
        is_supply: p?.tag === 'supply',
        // Other SKUs that sell out of this same stock (products.stock_sku).
        shared_with: (products || []).filter((o) => o.stock_sku === r.product_id).map((o) => o.name),
        sort: p?.sort_order ?? 1000,
        current_stock: stock,
        low_stock_threshold: threshold,
        low_stock: stock <= threshold,
      };
    }).sort((a, b) => a.is_supply - b.is_supply || a.sort - b.sort || a.name.localeCompare(b.name));
    const low_stock_count = items.filter((i) => i.low_stock).length;

    return res.status(200).json({
      items,
      low_stock_count,
      log: (log || []).map((l) => ({ ...l, product_name: bySku[l.product_id]?.name || l.product_id })),
    });
  } catch (err) {
    console.error('Inventory query failed:', err);
    return res.status(500).json({ error: 'Failed to load inventory' });
  }
}
