import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const DeleteSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

export default async function handler(req, res) {
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const { data: rows, count: total, error } = await supabase
      .from('orders')
      .select('id, customer_name, phone, created_at, payment_screenshot_path, reference_number, payment_verified, payment_method', { count: 'exact' })
      .not('payment_screenshot_path', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      console.error('Screenshots query failed:', error);
      return res.status(500).json({ error: 'Failed to load screenshots' });
    }

    // payment_screenshot_path is a bare Storage path, not a servable URL —
    // resolve to a short-lived signed URL before sending to the client.
    const paths = [...new Set((rows || []).map((r) => r.payment_screenshot_path).filter(Boolean))];
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from('payment-screenshots').createSignedUrls(paths, 3600);
      const urlByPath = new Map((signed || []).filter((s) => !s.error).map((s) => [s.path, s.signedUrl]));
      for (const r of rows || []) {
        if (r.payment_screenshot_path) r.payment_screenshot_path = urlByPath.get(r.payment_screenshot_path) || null;
      }
    }

    return res.status(200).json({ items: rows, total: total ?? 0, page, totalPages: Math.ceil((total ?? 0) / limit) || 1 });
  }

  if (req.method === 'DELETE') {
    const parsed = DeleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

    const { data: rows } = await supabase.from('orders').select('id, payment_screenshot_path').in('id', parsed.data.ids);
    const paths = (rows || []).map((r) => r.payment_screenshot_path).filter(Boolean);
    if (paths.length) await supabase.storage.from('payment-screenshots').remove(paths);

    const { error } = await supabase.from('orders').update({ payment_screenshot_path: null }).in('id', parsed.data.ids);
    if (error) {
      console.error('Screenshot bulk-clear failed:', error);
      return res.status(500).json({ error: 'Failed to clear screenshots' });
    }
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
