import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { computeRewards, normalizePhone, maxRedeemable } from '@/lib/loyalty';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isPhoneBlocked } from '@/lib/order-guard';
import { loadBlocklistSafe } from '@/lib/blocklist';
import { z } from 'zod';

export const config = { api: { bodyParser: { sizeLimit: '24kb' } } };
const posRate = rateLimit({ windowMs: 60_000, max: 20 });

const POSLineSchema = z.object({
  id: z.string().uuid(),
  product_type: z.string().min(1).max(50),
  quantity: z.coerce.number().int().min(1).max(50),
  need_container: z.boolean().or(z.literal(0)).or(z.literal(1)).optional().default(false),
  container_quantity: z.coerce.number().int().min(0).max(50).optional().default(0),
});

const POSOrderSchema = z.object({
  sale_id: z.string().uuid(),
  expected_subtotal: z.number().nonnegative(),
  expected_delivery_fee: z.number().nonnegative(),
  expected_voucher_discount: z.number().nonnegative(),
  expected_prices: z.array(z.object({
    sku: z.string().min(1).max(50),
    refill_price: z.number().nonnegative(),
    container_price: z.number().nonnegative(),
  })).min(1).max(20),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  customer_name: z.string().min(1).max(200),
  phone: z.string().min(7).max(20),
  fulfillment_type: z.enum(['pickup', 'delivery']),
  address: z.string().max(500).optional().default(''),
  barangay: z.string().max(200).optional().default(''),
  delivery_slot: z.enum(['am', 'pm']).optional().nullable(),
  delivery_date: z.string().max(20).optional().nullable(),
  lines: z.array(POSLineSchema).min(1).max(20),
  payment_method: z.enum(['cod', 'gcash', 'paymaya']),
  cash_tendered: z.coerce.number().min(0).optional().nullable(),
  gcash_number: z.string().max(20).optional().nullable(),
  reference_number: z.string().max(100).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  redeem_vouchers: z.coerce.number().int().min(0).max(50).optional().default(0),
}).superRefine((data, ctx) => {
  if (data.fulfillment_type === 'delivery') {
    if (!data.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Address required for delivery' });
    if (!data.barangay) ctx.addIssue({ code: 'custom', path: ['barangay'], message: 'Barangay required for delivery' });
  }
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await posRate(req, res))) return;
  if (!await verifyAdminWithLockout(req, res)) return;
  if (req.body?.lines?.length > 20 || req.body?.expected_prices?.length > 20) {
    return res.status(400).json({ error: 'Choose between 1 and 20 order lines.' });
  }

  const parsed = POSOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid POS sale data', details: parsed.error.flatten() });
  }
  const {
    customer_name, phone, fulfillment_type,
    address, barangay, delivery_slot, delivery_date,
    lines, payment_method, cash_tendered,
    gcash_number, reference_number, notes,
    redeem_vouchers, sale_id, expected_subtotal, expected_delivery_fee, expected_voucher_discount, expected_prices, lat, lng,
  } = parsed.data;

  const supabase = getSupabase();

  const isPickup = fulfillment_type === 'pickup';
  const transaction_id = 'TX-' + sale_id;
  const ids = lines.map(({ id }) => id);
  const catalogLines = lines.map((line) => ({
    sku: line.product_type,
    quantity: line.quantity,
    container_quantity: line.need_container ? line.container_quantity : 0,
  }));
  const { data: previous, error: previousError } = await supabase.from('orders')
    .select('id,product_type,voucher_count').eq('transaction_id', transaction_id).eq('branch_id', DEFAULT_BRANCH_ID);
  if (previousError) return res.status(503).json({ error: 'Could not verify sale status. Please try again.' });
  if (previous.length && (previous.length !== ids.length || !ids.every((id) => previous.some((order) => order.id === id)))) {
    return res.status(409).json({ error: 'Sale ID already in use.' });
  }
  const { data: quote, error: quoteError } = previous.length ? {} : await supabase.rpc('quote_catalog_order', {
    p_lines: catalogLines, p_fulfillment: fulfillment_type, p_lat: lat ?? null, p_lng: lng ?? null,
  });
  if (quoteError) {
    if (quoteError.code === '22023') return res.status(400).json({ error: quoteError.message });
    return res.status(503).json({ error: 'Could not load current prices. Please try again.' });
  }
  const pricesChanged = quote && (quote.lines.length !== expected_prices.length || quote.lines.some((line, index) => {
    const expected = expected_prices[index];
    return line.sku !== expected.sku || line.refill_price !== expected.refill_price || line.container_price !== expected.container_price;
  }));
  if (quote && (pricesChanged || quote.subtotal !== expected_subtotal || quote.delivery_fee !== expected_delivery_fee)) {
    return res.status(409).json({ error: 'Prices changed. Review the updated total and confirm again.', quote });
  }
  const resolvedLines = catalogLines.map((line, index) => {
    const product = quote?.lines[index];
    return {
      ...line, id: ids[index],
      kind: product?.kind,
      refill_subtotal: Number(product?.refill_price ?? 0) * line.quantity,
    };
  });
  const refillLines = resolvedLines.filter((line) => line.kind === 'refill');
  const totalQuantity = refillLines.reduce((sum, line) => sum + line.quantity, 0);
  const totalRefillSubtotal = refillLines.reduce((sum, line) => sum + line.refill_subtotal, 0);

  // Staff-keyed, so say why. Pickups are exempt: no rider trip to waste.
  if (!previous.length && !isPickup && isPhoneBlocked(phone, await loadBlocklistSafe(supabase))) {
    return res.status(403).json({ error: 'This number is on the blocklist. Delivery refused.' });
  }

  const normPhone = normalizePhone(phone);
  // supabase-js resolves with { data: null, error } rather than throwing, so the
  // error has to be read explicitly or a failed lookup reads as "no vouchers".
  let available = 0;
  const { data: prior, error: priorErr } = await supabase
    .from('orders')
    .select('status, container_size, quantity, voucher_count')
    .eq('phone_normalized', normPhone);
  if (priorErr) console.error('POS reward balance lookup failed:', priorErr);
  else available = computeRewards(prior || []).available;
  // Redeeming against an unknown balance silently drops the customer's
  // vouchers, so refuse. Sales with no redemption are unaffected.
  if (!previous.length && priorErr && redeem_vouchers > 0) {
    return res.status(503).json({ error: 'Could not verify the rewards balance. Please try again.' });
  }

  const maxAllowedVouchers = maxRedeemable({ available, quantity: totalQuantity, refillSubtotal: totalRefillSubtotal });
  let remainingVouchers = Math.min(redeem_vouchers, maxAllowedVouchers);
  const pricedLines = resolvedLines.map((line) => {
    const voucher_count = previous.length ? previous.find((order) => order.id === line.id).voucher_count
      : line.kind === 'refill' ? Math.min(remainingVouchers, line.quantity) : 0;
    remainingVouchers -= voucher_count;
    return { id: line.id, sku: line.sku, quantity: line.quantity, container_quantity: line.container_quantity, voucher_count };
  });

  const ct = payment_method === 'cod' ? cash_tendered ?? null : null;
  const { data: committed, error: saleError } = await supabase.rpc('create_catalog_pos', {
      p_sale: {
        transaction_id, branch_id: DEFAULT_BRANCH_ID, customer_name, phone, fulfillment: fulfillment_type,
        address, barangay, delivery_date: delivery_date || null, delivery_time: delivery_slot || null,
        lat: isPickup ? null : lat ?? null, lng: isPickup ? null : lng ?? null,
        payment_method: payment_method === 'paymaya' ? 'gcash' : payment_method,
        gcash_number: gcash_number || null, reference_number: reference_number || null, notes: notes || null,
        cash_tendered: ct, expected_voucher_discount, expected_prices,
      },
      p_lines: pricedLines,
      p_expected_subtotal: expected_subtotal,
      p_expected_delivery_fee: expected_delivery_fee,
    });
  if (saleError) {
    if (saleError.code === 'PT409') return res.status(409).json({ error: 'Prices or rewards changed. Review the total and confirm again.' });
    if (saleError.code === '22023') return res.status(400).json({ error: saleError.message });
    console.error('POS sale failed:', saleError.code);
    return res.status(500).json({ error: 'Failed to complete sale' });
  }
  const cartDeliveryFee = committed.reduce((sum, order) => sum + Number(order.delivery_fee ?? 0), 0);
  const voucherDiscountTotal = committed.reduce((sum, order) => sum + Number(order.voucher_discount ?? 0), 0);
  const appliedVouchers = committed.reduce((sum, order) => sum + order.voucher_count, 0);
  const totalAmount = committed.reduce((sum, order) => sum + Number(order.total_amount), 0);
  const cartSubtotal = totalAmount - cartDeliveryFee + voucherDiscountTotal;
  const changeDue = ct == null ? null : Math.max(0, ct - totalAmount);

  return res.status(201).json({
    transaction_id,
    created_at: committed[0]?.created_at,
    fulfillment_type,
    customer_name,
    phone,
    address: isPickup ? '' : address,
    barangay: isPickup ? '' : barangay,
    lines: committed.map((order) => {
      const containerSubtotal = Number(order.catalog_container_price) * order.container_quantity;
      return {
        order_id: order.id,
        product_type: order.product_type,
        product_name: order.catalog_product_name ?? order.product_type,
        quantity: order.quantity,
        refill_subtotal: Number(order.total_amount) - Number(order.delivery_fee ?? 0) + Number(order.voucher_discount ?? 0) - containerSubtotal,
        need_container: order.need_container,
        container_quantity: order.container_quantity,
        container_subtotal: containerSubtotal,
        voucher_count: order.voucher_count,
        voucher_discount: order.voucher_discount,
        line_total: order.total_amount,
        status: order.status,
      };
    }),
    delivery_fee: cartDeliveryFee,
    subtotal: cartSubtotal,
    voucher_count_total: appliedVouchers,
    voucher_discount_total: voucherDiscountTotal,
    total_amount: totalAmount,
    payment_method,
    cash_tendered: ct,
    change_due: changeDue,
    loyalty_available_after: Math.max(0, available - (previous.length ? 0 : appliedVouchers)),
  });
}
