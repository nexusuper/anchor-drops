import { getSupabase } from '@/lib/supabaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Cache-Control', 'no-store');

  try {
    const supabase = getSupabase();
    const [{ data: settingRow, error: settingErr }, { data: products, error: productsErr }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'ordering_enabled').maybeSingle(),
      supabase.from('products').select('sku,name,description,size,refill_price,container_price,tag,is_pickup,kind')
        .eq('is_active', true).eq('sold_out', false).or('tag.is.null,tag.neq.supply').order('sort_order'),
    ]);
    if (settingErr) throw settingErr;
    if (productsErr) throw productsErr;
    // Absent row = ordering enabled (don't need a migration just to ship the default open state).
    const enabled = settingRow ? settingRow.value === true : true;
    const catalog = products.map((p) => ({
      id: p.sku,
      name: p.name,
      description: p.description,
      size: p.size,
      refill: Number(p.refill_price),
      container: Number(p.container_price),
      tag: p.tag,
      kind: p.kind,
      fulfillment: p.is_pickup ? 'pickup' : 'delivery',
    }));
    return res.status(200).json({
      enabled,
      activeSkus: catalog.filter((p) => p.kind !== 'info').map((p) => p.id),
      products: catalog,
    });
  } catch (err) {
    console.error('Ordering status check failed:', err);
    return res.status(503).json({ error: 'Current prices are temporarily unavailable.' });
  }
}
