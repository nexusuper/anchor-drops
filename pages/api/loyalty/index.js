import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const MILESTONE = 10;

// Order-count loyalty tally, separate from the gallon-based checkout voucher
// system in lib/loyalty.js — see 0037_loyalty_milestone_redemptions.sql.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const search = String(req.query.search || '').trim().toLowerCase();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;

  try {
    const supabase = getSupabase();
    const [statsRes, redemptionsRes] = await Promise.all([
      supabase.from('customer_stats').select('phone_normalized, customer_name, total_orders, total_spent'),
      supabase.from('loyalty_milestone_redemptions').select('phone_normalized'),
    ]);
    if (statsRes.error) throw statsRes.error;
    if (redemptionsRes.error) throw redemptionsRes.error;

    const redeemedByPhone = {};
    for (const r of redemptionsRes.data || []) {
      redeemedByPhone[r.phone_normalized] = (redeemedByPhone[r.phone_normalized] || 0) + 1;
    }

    let rows = (statsRes.data || []).map((c) => {
      const totalOrders = Number(c.total_orders) || 0;
      const earned = Math.floor(totalOrders / MILESTONE);
      const redeemed = redeemedByPhone[c.phone_normalized] || 0;
      const remainder = totalOrders % MILESTONE;
      return {
        phone_normalized: c.phone_normalized,
        customer_name: c.customer_name,
        total_orders: totalOrders,
        total_spent: Number(c.total_spent) || 0,
        orders_until_next_voucher: totalOrders === 0 ? MILESTONE : (remainder === 0 ? MILESTONE : MILESTONE - remainder),
        vouchers_earned: earned,
        vouchers_redeemed: redeemed,
        vouchers_unredeemed: Math.max(0, earned - redeemed),
      };
    });

    if (search) {
      rows = rows.filter((c) =>
        (c.customer_name || '').toLowerCase().includes(search) || (c.phone_normalized || '').includes(search)
      );
    }
    rows.sort((a, b) => b.vouchers_unredeemed - a.vouchers_unredeemed || b.total_orders - a.total_orders);

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = rows.slice((page - 1) * limit, page * limit);

    return res.status(200).json({ customers: paged, total, page, totalPages });
  } catch (err) {
    console.error('Loyalty list query failed:', err);
    return res.status(500).json({ error: 'Failed to load loyalty data' });
  }
}
