import { getSupabase } from '@/lib/supabaseAdmin';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

// Public, unauthenticated endpoint — every visitor's browser calls this.
// Generous but capped: a real visitor fires a handful of these per page,
// never hundreds.
const publicRate = rateLimit({ windowMs: 60_000, max: 120 });

const TrackSchema = z.object({
  session_id: z.string().min(1).max(64),
  event_type: z.enum(['pageview', 'click']),
  path: z.string().min(1).max(300),
  label: z.string().max(200).optional().nullable(),
  referrer: z.string().max(300).optional().nullable(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await publicRate(req, res))) return;

  const parsed = TrackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid event' });

  try {
    const supabase = getSupabase();
    const { session_id, event_type, path, label, referrer } = parsed.data;
    const { error } = await supabase.from('site_events').insert({
      session_id, event_type, path, label: label || null, referrer: referrer || null,
    });
    if (error) throw error;
    return res.status(204).end();
  } catch (err) {
    // Never let a broken tracker surface to the visitor or spam logs at scale.
    console.error('Track insert failed:', err);
    return res.status(204).end();
  }
}
