import { getSupabase } from '@/lib/supabaseAdmin';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { generateCode, hashCode, CODE_TTL_MINUTES } from '@/lib/reward-codes';
import { sendMessengerMessage } from '@/lib/facebook';
import { rateLimit } from '@/lib/rate-limit';

const checkRate = rateLimit({ windowMs: 60_000, max: 5 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!checkRate(req, res)) return;

  const supabase = getSupabase();
  const phone = normalizePhone(req.body?.phone);
  if (phone.length < 7) return res.status(200).json({ sent: false });

  try {
    const { data: rows } = await supabase
      .from('orders').select('status, container_size, quantity, voucher_count, messenger_psid').eq('phone_normalized', phone);
    const { available } = computeRewards(rows || []);
    if (available < 1) return res.status(200).json({ sent: false });

    const linked = (rows || []).find((r) => r.messenger_psid);
    if (!linked) return res.status(200).json({ sent: false, reason: 'not_linked' });

    const code = generateCode();
    const expires_at = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

    const { data: inserted, error } = await supabase.from('reward_codes').insert({
      phone, code_hash: hashCode(phone, code), expires_at, used: false, attempts: 0,
    }).select('id').single();
    if (error) throw error;

    try {
      await sendMessengerMessage(linked.messenger_psid, `Your Anchor Drops reward code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. Enter it at checkout to use your free refill.`);
      return res.status(200).json({ sent: true });
    } catch (e) {
      await supabase.from('reward_codes').delete().eq('id', inserted.id);
      return res.status(200).json({ sent: false });
    }
  } catch (err) {
    return res.status(200).json({ sent: false });
  }
}
