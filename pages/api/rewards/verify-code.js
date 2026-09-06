import { getSupabase } from '@/lib/supabaseAdmin';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { hashCode, CODE_MAX_ATTEMPTS } from '@/lib/reward-codes';
import { timingSafeEqual } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const checkRate = rateLimit({ windowMs: 60_000, max: 10 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await checkRate(req, res))) return;

  const supabase = getSupabase();
  const phone = normalizePhone(req.body?.phone);
  const code = String(req.body?.code || '');
  if (phone.length < 7 || !code) return res.status(200).json({ valid: false });

  try {
    const { data: rows } = await supabase
      .from('reward_codes').select('id, code_hash, expires_at, used, attempts')
      .eq('phone', phone).eq('used', false)
      .order('created_at', { ascending: false }).limit(1);
    const row = rows?.[0];
    const nowIso = new Date().toISOString();
    if (!row || row.expires_at <= nowIso) return res.status(200).json({ valid: false });

    if (row.attempts >= CODE_MAX_ATTEMPTS) {
      await supabase.from('reward_codes').update({ used: true }).eq('id', row.id);
      return res.status(200).json({ valid: false });
    }
    await supabase.from('reward_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);

    if (timingSafeEqual(row.code_hash, hashCode(phone, code))) {
      const { data: orderRows } = await supabase
        .from('orders').select('status, container_size, quantity, voucher_count').eq('phone_normalized', phone);
      const { available } = computeRewards(orderRows || []);
      return res.status(200).json({ valid: true, available });
    }
    return res.status(200).json({ valid: false });
  } catch (err) {
    return res.status(200).json({ valid: false });
  }
}
