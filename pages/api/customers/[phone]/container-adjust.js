import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const BodySchema = z.object({
  delta: z.coerce.number().int().min(-100).max(100),
  reason: z.string().max(200).optional().default(''),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await adminRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid adjustment' });

  const supabase = getSupabase();
  const phone = normalizePhone(req.query.phone);
  const { data: customer } = await supabase.from('customers').select('id').eq('phone_normalized', phone).single();
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const { error } = await supabase.from('container_ledger').insert({
    branch_id: DEFAULT_BRANCH_ID,
    customer_id: customer.id,
    phone_normalized: phone,
    delta: parsed.data.delta,
    kind: 'adjustment',
    note: parsed.data.reason,
  });
  if (error) {
    console.error('Container adjust insert failed:', error);
    return res.status(500).json({ error: 'Failed to adjust' });
  }
  return res.status(201).json({ success: true });
}
