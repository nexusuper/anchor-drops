import { DEFAULT_BRANCH_ID } from './constants.js';
import { normalizePhone } from './loyalty.js';

// Single write path into container_ledger. Sign convention (0001_schema.sql):
//   delta > 0 => customer now holds MORE of our containers (delivery_out)
//   delta < 0 => customer returned containers (pickup_return)
//
// ponytail: fire-and-forget — a failed ledger row must never fail the delivery
// or pickup it is recording. Errors are logged; the balance is repairable with
// the manual adjustment that already exists.
export async function recordContainerMove(supabase, { phone, customerId, orderId, delta, kind, note }) {
  const d = Number(delta) || 0;
  if (!d) return;

  const phone_normalized = normalizePhone(phone || '');
  let customer_id = customerId || null;
  if (!customer_id && phone_normalized) {
    const { data } = await supabase.from('customers').select('id').eq('phone_normalized', phone_normalized).single();
    customer_id = data?.id || null;
  }

  const { error } = await supabase.from('container_ledger').insert({
    branch_id: DEFAULT_BRANCH_ID,
    customer_id,
    phone_normalized: phone_normalized || null,
    order_id: orderId || null,
    delta: d,
    kind,
    note: note || null,
  });
  if (error) console.error('Container ledger insert failed:', error);
}
