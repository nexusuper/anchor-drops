import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

function manilaDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  try {
    const today = manilaDate();
    const { data: rows, error } = await getSupabase()
      .from('orders')
      .select('*')
      .in('status', ['confirmed', 'out_for_delivery'])
      .or(`delivery_date.eq.${today},delivery_date.is.null`);
    if (error) throw error;

    // Orders with no delivery_date matched every day's route forever, silently
    // padding today's list. They still need dispatching, so surface them as
    // their own group instead of hiding or repeating them.
    const unscheduled = (rows || []).filter((o) => !o.delivery_date);
    const byBarangay = {};
    for (const o of rows || []) {
      if (!o.delivery_date) continue;
      (byBarangay[o.barangay] ||= []).push(o);
    }
    // ponytail: RouteTab.js consumes `{barangays:[{barangay,count,orders}]}`,
    // not the byBarangay map above -- reshape at the boundary here instead of
    // touching the one existing frontend caller.
    const barangays = Object.entries(byBarangay).map(([barangay, orders]) => {
      orders.sort((a, b) => (a.delivery_time || '').localeCompare(b.delivery_time || ''));
      return { barangay, count: orders.length, orders };
    });
    barangays.sort((a, b) => a.barangay.localeCompare(b.barangay));
    // ponytail: appended as one more "barangay" group so the existing RouteTab
    // shape still works — no admin-side change needed to see them.
    if (unscheduled.length > 0) {
      barangays.push({ barangay: 'Unscheduled (no delivery date)', count: unscheduled.length, orders: unscheduled });
    }

    return res.status(200).json({ barangays, total: (rows || []).length });
  } catch (err) {
    console.error('Route query failed:', err);
    return res.status(500).json({ error: 'Failed to load route' });
  }
}
