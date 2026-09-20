import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhonePH } from '@/lib/order-guard';
import { loadBlocklist, saveBlocklist } from '@/lib/blocklist';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const MAX_ENTRIES = 1000;

const BlockSchema = z.object({
  phone: z.string().min(7).max(20),
  reason: z.string().max(200).optional().nullable(),
});

export default async function handler(req, res) {
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();
  try {
    const list = await loadBlocklist(supabase);

    if (req.method === 'GET') return res.status(200).json({ blocked: list });

    const parsed = BlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
    const phone = normalizePhonePH(parsed.data.phone);
    if (phone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

    if (req.method === 'POST') {
      if (list.some((b) => b.phone === phone)) return res.status(200).json({ blocked: list });
      if (list.length >= MAX_ENTRIES) return res.status(400).json({ error: 'Blocklist is full' });
      const next = [...list, { phone, reason: parsed.data.reason || null, at: new Date().toISOString() }];
      await saveBlocklist(supabase, next);
      return res.status(201).json({ blocked: next });
    }

    if (req.method === 'DELETE') {
      const next = list.filter((b) => b.phone !== phone);
      await saveBlocklist(supabase, next);
      return res.status(200).json({ blocked: next });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Blocklist request failed:', err);
    return res.status(500).json({ error: 'Blocklist request failed' });
  }
}
