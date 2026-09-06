import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 10 });
// phone_normalized is digits-only; keep the bound loose but sane.
const BodySchema = z.object({
  phones: z.array(z.string().regex(/^\d{7,20}$/)).min(1).max(200),
});

// Destructive: removes each customer AND their orders. Two FKs to customers are
// NO ACTION (orders, container_ledger) so they must be cleared first; the rest
// (addresses, notes, contact_log) cascade. Order children (payments, POD,
// pickups) cascade when their order is deleted.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { phones } = parsed.data;

  const supabase = getSupabase();
  try {
    // Resolve customer ids (needed for the container_ledger FK, which has no phone column).
    const { data: custs, error: lookupErr } = await supabase
      .from('customers').select('id').in('phone_normalized', phones);
    if (lookupErr) throw lookupErr;
    const ids = (custs || []).map((c) => c.id);

    // 1. Orders (by phone, catches orders whose customer_id link is missing) — children cascade.
    const { count: ordersDeleted, error: ordErr } = await supabase
      .from('orders').delete({ count: 'exact' }).in('phone_normalized', phones);
    if (ordErr) throw ordErr;

    // 2. container_ledger (NO ACTION FK to customers) — clear before the customer.
    if (ids.length) {
      const { error: ledgerErr } = await supabase
        .from('container_ledger').delete().in('customer_id', ids);
      if (ledgerErr) throw ledgerErr;
    }

    // 3. The customers themselves — addresses/notes/contact_log cascade.
    const { count: customersDeleted, error: custErr } = await supabase
      .from('customers').delete({ count: 'exact' }).in('phone_normalized', phones);
    if (custErr) throw custErr;

    return res.status(200).json({
      deletedCustomers: customersDeleted ?? 0,
      deletedOrders: ordersDeleted ?? 0,
    });
  } catch (err) {
    console.error('Customer bulk delete failed:', err);
    return res.status(500).json({ error: 'Failed to delete customers' });
  }
}
