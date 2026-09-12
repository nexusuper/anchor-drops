import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PatchSchema = z.object({
  open_override_dates: z.array(z.string().regex(DATE_RE)),
});

export default async function handler(req, res) {
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'open_override_dates').maybeSingle();
    if (error) return res.status(500).json({ error: 'Failed to load settings' });
    return res.status(200).json({ open_override_dates: Array.isArray(data?.value) ? data.value : [] });
  }

  if (req.method === 'PATCH') {
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ key: 'open_override_dates', value: parsed.data.open_override_dates }, { onConflict: 'key' })
      .select('key');
    if (error) return res.status(500).json({ error: 'Failed to save settings' });
    if (!data || data.length === 0) return res.status(500).json({ error: 'Setting was not saved' });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
