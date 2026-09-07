import { getSupabase } from '@/lib/supabaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const [{ data: settingRow, error: settingErr }, { data: products, error: productsErr }] = await Promise.all([
      supabase.from('app_settings').select('value').eq('key', 'ordering_enabled').maybeSingle(),
      supabase.from('products').select('sku').eq('is_active', true).eq('sold_out', false),
    ]);
    if (settingErr) throw settingErr;
    if (productsErr) throw productsErr;
    // Absent row = ordering enabled (don't need a migration just to ship the default open state).
    const enabled = settingRow ? settingRow.value === true : true;
    return res.status(200).json({ enabled, activeSkus: (products || []).map((p) => p.sku) });
  } catch (err) {
    console.error('Ordering status check failed:', err);
    // Fail open — a settings-read hiccup should not silently close the storefront.
    return res.status(200).json({ enabled: true, activeSkus: null });
  }
}
