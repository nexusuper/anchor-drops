import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { rateLimit } from '@/lib/rate-limit';
import { timingSafeEqual } from '@/lib/auth';
import { PRODUCTS_BY_ID } from '@/lib/products';
import { matchBarangay } from '@/lib/service-area';
import {
  isValidPhonePH, isPlausibleAddress,
  strikeVerdict, phoneVariants, ORDER_REFUSED_MESSAGE, NEW_PHONE_MAX_ORDERS, NEW_PHONE_WINDOW_MS,
} from '@/lib/order-guard';
import { z } from 'zod';

const checkRate = rateLimit({ windowMs: 60_000, max: 10 });

const FbOrderSchema = z.object({
  customer_name: z.string().max(200).optional(),
  name: z.string().max(200).optional(),
  full_name: z.string().max(200).optional(),
  phone: z.string().max(30).optional(),
  contact_number: z.string().max(30).optional(),
  contact: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  delivery_address: z.string().max(500).optional(),
  qty: z.union([z.string(), z.number()]).optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  gallons: z.union([z.string(), z.number()]).optional(),
  messenger_id: z.string().max(100).optional(),
  messenger_psid: z.string().max(100).optional(),
  psid: z.string().max(100).optional(),
  barangay: z.string().max(200).optional(),
  product_type: z.string().max(50).optional(),
  notes: z.string().max(1000).optional(),
  delivery_slot: z.enum(['am', 'pm']).optional(),
});

function parseGallons(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await checkRate(req, res))) return;

  const secret = process.env.FB_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Webhook not configured' });
  }
  if (!timingSafeEqual(req.headers['x-webhook-secret'], secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const parsed = FbOrderSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request data' });
  }
  const b = parsed.data;
  const customer_name = b.customer_name || b.name || b.full_name || 'Messenger Customer';
  const phone = b.phone || b.contact_number || b.contact || '';
  const address = b.address || b.delivery_address || '';
  const gallons = parseGallons(b.qty ?? b.quantity ?? b.gallons);
  const messenger_psid = b.messenger_id || b.messenger_psid || b.psid || null;
  // Unlike the public form, an unrecognised barangay is NOT rejected here:
  // chat intake frequently arrives without one, and the route already carries a
  // "resolve this manually" sentinel for that case. A barangay that does match
  // is canonicalised so the delivery route groups it with the web orders.
  const barangay = matchBarangay(b.barangay) || 'TBD (via Messenger)';
  const productKey = PRODUCTS_BY_ID[b.product_type] ? b.product_type : 'slim5';

  if (!phone || !address || !gallons) {
    return res.status(400).json({ error: 'Missing required fields: need phone, address, and quantity' });
  }

  // Same junk filter as the public order form (lib/order-guard.js). The webhook
  // secret proves the request came from ManyChat, not that a human on the other
  // end typed a real phone number or address into the chat flow.
  if (!isValidPhonePH(phone)) {
    return res.status(400).json({ error: 'Please send a valid Philippine mobile number (09XXXXXXXXX).' });
  }
  if (!isPlausibleAddress(address)) {
    return res.status(400).json({ error: 'Please send a complete delivery address.' });
  }

  const product = PRODUCTS_BY_ID[productKey];
  const perContainer = product.size === '3-Gal' ? 3 : 5;
  const quantity = Math.max(1, Math.round(gallons / perContainer));
  const notes =
    `Ordered via Facebook Messenger (${gallons} gal requested)` +
    (b.notes ? ` — ${b.notes}` : '');

  const supabase = getSupabase();
  // Every stored spelling of this number — see phoneVariants() for why a single
  // key is not enough.
  const phoneKeys = phoneVariants(phone);

  // Strike policy. Messenger orders are always COD, so a phone at
  // STRIKES_PREPAY_ONLY is refused here and has to pay through the web form —
  // which is the point: this is the channel ghost orders arrive on.
  const { count: strikes, error: strikeErr } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('phone_normalized', phoneKeys)
    .eq('no_show', true);
  if (strikeErr) {
    // Fail open, same as the public route: a lookup outage must not stop real orders.
    console.error('FB order no-show strike lookup failed:', strikeErr);
  } else {
    const verdict = strikeVerdict(strikes || 0, 'cod');
    if (!verdict.ok) return res.status(403).json({ error: verdict.error });
  }

  // Per-phone throttle for numbers that have never completed an order.
  const { data: history, error: historyErr } = await supabase
    .from('orders')
    .select('status, created_at')
    .in('phone_normalized', phoneKeys)
    .order('created_at', { ascending: false })
    .limit(20);
  if (!historyErr && history && history.length > 0 && !history.some((o) => o.status === 'delivered')) {
    const since = Date.now() - NEW_PHONE_WINDOW_MS;
    const recent = history.filter((o) => new Date(o.created_at).getTime() >= since).length;
    if (recent >= NEW_PHONE_MAX_ORDERS) {
      // Same status and message as the strike rejection above — see ORDER_REFUSED_MESSAGE.
      return res.status(403).json({ error: ORDER_REFUSED_MESSAGE });
    }
  }

  const { data: order, error } = await supabase.rpc('create_order', {
    p_client_order_id: crypto.randomUUID(),
    p_branch_id: DEFAULT_BRANCH_ID,
    p_customer_name: customer_name,
    p_phone: phone,
    p_address: address,
    p_barangay: barangay,
    p_address_label: 'Home',
    p_product_type: productKey,
    p_container_size: product.size,
    p_quantity: quantity,
    p_need_container: false,
    p_container_quantity: 0,
    p_payment_method: 'cod',
    p_gcash_number: null,
    p_reference_number: null,
    p_payment_screenshot_path: null,
    p_notes: notes,
    p_total_amount: 0,
    p_sale_channel: 'online',
    p_cash_tendered: null,
    p_voucher_count: 0,
    p_reward_requested: 0,
    // No pin source from Messenger/ManyChat intake.
    p_lat: null,
    p_lng: null,
  });

  if (error) {
    console.error('FB order insert failed:', error);
    return res.status(500).json({ error: 'Failed to place order' });
  }

  if (messenger_psid) {
    await supabase.from('orders').update({ messenger_psid }).eq('id', order.id);
    await supabase.from('customers').update({ messenger_psid }).eq('id', order.customer_id);
  }
  if (b.delivery_slot) {
    await supabase.from('orders').update({ delivery_time: b.delivery_slot }).eq('id', order.id);
  }

  return res
    .status(201)
    .json({ id: order.id, created_at: order.created_at, quantity, container_size: product.size, total_amount: order.total_amount });
}
