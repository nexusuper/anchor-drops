import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

export const config = { api: { bodyParser: { sizeLimit: '12kb' } } };
const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const PatchSchema = z.object({
  bottle_delivery_bands: z.array(z.object({
    max_km: z.number().positive().max(200),
    fee: z.number().nonnegative().max(100000),
  })).max(30).refine((bands) => bands.every((band, i) => !i || band.max_km > bands[i - 1].max_km)),
});

export default async function handler(req, res) {
  if (!(await adminRate(req, res))) return;
  const permissions = req.method === 'PATCH' ? { names: ['owner', 'admin'] } : undefined;
  if (!await verifyAdminWithLockout(req, res, permissions)) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'bottle_delivery_bands').maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to load settings' });
    return res.status(200).json({ bottle_delivery_bands: data?.value ?? [] });
  }

  if (req.method === 'PATCH') {
    if (req.body?.bottle_delivery_bands?.length > 30) {
      return res.status(400).json({ error: 'Enter at most 30 delivery bands.' });
    }
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ key: 'bottle_delivery_bands', value: parsed.data.bottle_delivery_bands }, { onConflict: 'key' })
      .select('key');
    if (error) return res.status(500).json({ error: 'Failed to save settings' });
    if (!data || data.length === 0) return res.status(500).json({ error: 'Setting was not saved' });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
