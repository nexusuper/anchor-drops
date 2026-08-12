import { getSupabase } from '@/lib/supabaseAdmin';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { recordContainerMove } from '@/lib/containers';
import { z } from 'zod';

const PatchSchema = z.object({ status: z.enum(['scheduled', 'picked_up', 'delivered', 'cancelled']) });
const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  const supabase = getSupabase();
  const { id } = req.query;

  if (req.method === 'PATCH') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;
    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update data' });

    const { data: exists } = await supabase
      .from('container_pickups').select('id, status, phone, container_qty, order_id').eq('id', id).single();
    if (!exists) return res.status(404).json({ error: 'Pickup not found' });

    await supabase.from('container_pickups').update({ status: parsed.data.status }).eq('id', id);

    // Containers physically came back to us. Guarded on the pre-update status so
    // re-saving 'picked_up' doesn't credit the customer twice.
    if (parsed.data.status === 'picked_up' && exists.status !== 'picked_up') {
      await recordContainerMove(supabase, {
        phone: exists.phone,
        orderId: exists.order_id,
        delta: -(Number(exists.container_qty) || 0),
        kind: 'pickup_return',
        note: `pickup ${id}`,
      });
    }
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;
    const { data: pickup } = await supabase.from('container_pickups').select('status').eq('id', id).single();
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });
    if (!['delivered', 'cancelled'].includes(pickup.status)) {
      return res.status(400).json({ error: 'Only delivered or cancelled pickups can be deleted' });
    }
    await supabase.from('container_pickups').delete().eq('id', id);
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
