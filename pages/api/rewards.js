import { getSupabase } from '@/lib/supabaseAdmin';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const checkRate = rateLimit({ windowMs: 60_000, max: 20 });
const QuerySchema = z.object({ phone: z.string().min(1).max(20) });

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRate(req, res)) return;

  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a valid phone number' });
  const phone = normalizePhone(parsed.data.phone);
  if (phone.length < 7) return res.status(400).json({ error: 'Enter a valid phone number' });

  try {
    const supabase = getSupabase();
    // ponytail: sum container_ledger.delta here, the same way the admin
    // customer-detail route does. The customer_container_balance RPC (0015)
    // keys on customer_id[] and is granted only to `authenticated`, so it is
    // not reachable from this service_role, phone-keyed path.
    const [{ data: rows, error }, { data: ledger, error: ledgerErr }] = await Promise.all([
      supabase.from('orders').select('status, container_size, quantity, voucher_count').eq('phone_normalized', phone),
      supabase.from('container_ledger').select('delta').eq('phone_normalized', phone),
    ]);
    if (error) throw error;
    // The balance is a nice-to-have next to the reward count — a failed lookup
    // omits the line rather than failing the whole rewards check.
    if (ledgerErr) console.error('Container balance lookup failed:', ledgerErr);
    return res.status(200).json({
      ...computeRewards(rows || []),
      containers_out: ledgerErr ? null : (ledger || []).reduce((sum, a) => sum + (Number(a.delta) || 0), 0),
    });
  } catch (err) {
    console.error('Rewards query failed:', err);
    return res.status(500).json({ error: 'Failed to check rewards' });
  }
}
