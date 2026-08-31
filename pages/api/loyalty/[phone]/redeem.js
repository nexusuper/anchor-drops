import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!adminRate(req, res)) return;
  const staffName = await verifyAdminWithLockout(req, res);
  if (!staffName) return;

  const phone = normalizePhone(req.query.phone);
  if (phone.length < 7) return res.status(400).json({ error: 'Invalid phone number' });

  try {
    // redeem_loyalty_milestone is the sole source of truth for the double-redeem
    // guard (pg_advisory_xact_lock + unique constraint) — see
    // 0037_loyalty_milestone_redemptions.sql. Never pre-check availability here
    // and skip the RPC; that would reopen the race this exists to close.
    const { data, error } = await getSupabase().rpc('redeem_loyalty_milestone', {
      p_phone_normalized: phone,
      p_redeemed_by: staffName,
    });
    if (error) {
      // P0001 is the RPC's deliberate "nothing to redeem" / race-lost signal.
      if (error.code === 'P0001' || /no unredeemed voucher/i.test(error.message || '')) {
        return res.status(409).json({ error: 'No unredeemed voucher available for this customer' });
      }
      throw error;
    }
    const result = Array.isArray(data) ? data[0] : data;
    return res.status(200).json({
      success: true,
      milestone_number: result.milestone_number,
      unredeemed_remaining: result.unredeemed_remaining,
    });
  } catch (err) {
    console.error('Loyalty redeem failed:', err);
    return res.status(500).json({ error: 'Failed to redeem voucher' });
  }
}
