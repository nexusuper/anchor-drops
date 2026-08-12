import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { computeRewards, normalizePhone, maxRedeemable, VOUCHER_VALUE } from '@/lib/loyalty';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS_BY_ID, deliveryFee } from '@/lib/products';
import { recordContainerMove } from '@/lib/containers';
import { z } from 'zod';
import crypto from 'node:crypto';

const posRate = rateLimit({ windowMs: 60_000, max: 20 });

const POSLineSchema = z.object({
  product_type: z.string().min(1).max(50),
  quantity: z.coerce.number().int().min(1).max(50),
  need_container: z.boolean().or(z.literal(0)).or(z.literal(1)).optional().default(false),
  container_quantity: z.coerce.number().int().min(0).max(50).optional().default(0),
});

const POSOrderSchema = z.object({
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
  if (!posRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = POSOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid POS sale data', details: parsed.error.flatten() });
  }
  const {
    customer_name, phone, fulfillment_type,
    address, barangay, delivery_slot, delivery_date,
    lines, payment_method, cash_tendered,
    gcash_number, reference_number, notes,
    redeem_vouchers,
  } = parsed.data;

  const supabase = getSupabase();

  const resolvedLines = [];
  for (const line of lines) {
    const product = PRODUCTS_BY_ID[line.product_type];
    if (!product) {
      return res.status(400).json({ error: `Unknown product: ${line.product_type}` });
    }
    const refill_subtotal = product.refill * line.quantity;
    const container_subtotal = line.need_container ? product.container * (line.container_quantity || 0) : 0;
    resolvedLines.push({
      product_type: line.product_type,
      product_name: product.name,
      container_size: product.size,
      quantity: line.quantity,
      need_container: !!line.need_container,
      container_quantity: line.container_quantity || 0,
      refill_subtotal,
      container_subtotal,
      line_base: refill_subtotal + container_subtotal,
    });
  }

  const isPickup = fulfillment_type === 'pickup';
  const totalQuantity = resolvedLines.reduce((sum, l) => sum + l.quantity, 0);
  const totalRefillSubtotal = resolvedLines.reduce((sum, l) => sum + l.refill_subtotal, 0);
  const cartDeliveryFee = isPickup ? 0 : deliveryFee(totalQuantity);

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
  if (priorErr && redeem_vouchers > 0) {
    return res.status(503).json({ error: 'Could not verify the rewards balance. Please try again.' });
  }

  const maxAllowedVouchers = maxRedeemable({ available, quantity: totalQuantity, refillSubtotal: totalRefillSubtotal });
  const appliedVouchers = Math.min(redeem_vouchers, maxAllowedVouchers);

  let remainingVouchers = appliedVouchers;
  for (const line of resolvedLines) {
    const take = Math.min(remainingVouchers, line.quantity);
    line.voucher_count = take;
    line.voucher_discount = take * VOUCHER_VALUE;
    remainingVouchers -= take;
  }

  const voucherDiscountTotal = resolvedLines.reduce((sum, l) => sum + l.voucher_discount, 0);
  const cartSubtotal = resolvedLines.reduce((sum, l) => sum + l.line_base, 0);
  const totalAmount = Math.max(0, cartSubtotal + cartDeliveryFee - voucherDiscountTotal);
  const changeDue = payment_method === 'cod' && cash_tendered != null
    ? Math.max(0, cash_tendered - totalAmount)
    : null;

  resolvedLines[0].delivery_fee = cartDeliveryFee;
  for (let i = 1; i < resolvedLines.length; i++) resolvedLines[i].delivery_fee = 0;
  for (const line of resolvedLines) {
    line.line_total = Math.max(0, line.line_base + line.delivery_fee - line.voucher_discount);
  }

  const status = isPickup ? 'delivered' : 'pending';
  const transaction_id = 'TX-' + crypto.randomUUID().slice(0, 8).toUpperCase();
  const pickupAddress = address || 'Counter Pickup';
  const pickupBarangay = barangay || 'N/A';
  const ct = payment_method === 'cod' && cash_tendered != null ? cash_tendered : null;

  const createdOrders = [];
  for (const line of resolvedLines) {
    const { data: order, error } = await supabase.rpc('create_order', {
      p_client_order_id: crypto.randomUUID(),
      p_branch_id: DEFAULT_BRANCH_ID,
      p_customer_name: customer_name,
      p_phone: phone,
      p_address: isPickup ? pickupAddress : address,
      p_barangay: isPickup ? pickupBarangay : barangay,
      p_address_label: 'Home',
      p_product_type: line.product_type,
      p_container_size: line.container_size,
      p_quantity: line.quantity,
      p_need_container: line.need_container,
      p_container_quantity: line.container_quantity,
      p_payment_method: payment_method === 'paymaya' ? 'gcash' : payment_method,
      p_gcash_number: gcash_number || null,
      p_reference_number: reference_number || null,
      p_payment_screenshot_path: null,
      p_notes: notes || null,
      p_total_amount: 0,
      p_sale_channel: 'pos',
      p_cash_tendered: ct,
      p_voucher_count: line.voucher_count,
      p_reward_requested: 0,
      // Validated above but previously never forwarded, so every POS delivery
      // landed with a null window and only showed on the route sheet via its
      // delivery_date.is.null fallback.
      p_delivery_date: isPickup ? null : (delivery_date || null),
      p_delivery_time: isPickup ? null : (delivery_slot || null),
      // The fee is a cart-wide amount already apportioned onto line 0 above. The
      // RPC would otherwise re-derive it from this line's own quantity, charging
      // a counter pickup a fee it waived and a multi-line sale one fee per line.
      p_delivery_fee: line.delivery_fee,
      // POS counter-sale has no pin UI.
      p_lat: null,
      p_lng: null,
    });
    if (error) {
      console.error('POS sale insert failed:', error);
      // ponytail: individual RPC calls can't share one client-side SQL
      // transaction, so roll back by hand -- delete the lines already
      // committed this loop so a failed multi-line sale doesn't leave a
      // partial sale behind.
      const createdIds = createdOrders.map((o) => o.id).filter(Boolean);
      if (createdIds.length) {
        const { error: cleanupErr } = await supabase.from('orders').delete().in('id', createdIds);
        if (cleanupErr) console.error('POS partial-sale cleanup failed:', cleanupErr);
      }
      return res.status(500).json({ error: 'Failed to complete sale' });
    }
    await supabase.from('orders').update({ status, transaction_id }).eq('id', order.id);
    line.order_id = order.id;
    createdOrders.push(order);
  }

  // Counter pickups are created already-delivered, so they never pass through
  // the PATCH-to-delivered hook in orders/[id].js that records the rest. POS
  // *deliveries* land as 'pending' and are recorded there, not here.
  if (isPickup) {
    for (const line of resolvedLines) {
      if (line.need_container) {
        await recordContainerMove(supabase, {
          phone,
          orderId: line.order_id,
          delta: line.container_quantity,
          kind: 'delivery_out',
          note: `POS sale ${transaction_id}`,
        });
      }
      try {
        const { error: invErr } = await supabase.rpc('adjust_inventory', {
          p_branch_id: DEFAULT_BRANCH_ID,
          p_product_id: line.product_type,
          p_delta: -line.quantity,
          p_type: 'sale',
          p_reason: `POS sale ${line.order_id}`,
        });
        if (invErr) console.error('POS inventory deduct failed for', line.product_type, invErr);
      } catch (invErr) {
        console.error('POS inventory deduct failed for', line.product_type, invErr);
      }
    }
  }

  return res.status(201).json({
    transaction_id,
    created_at: createdOrders[0]?.created_at,
    fulfillment_type,
    customer_name,
    phone,
    lines: resolvedLines.map((l) => ({
      order_id: l.order_id,
      product_type: l.product_type,
      product_name: l.product_name,
      quantity: l.quantity,
      refill_subtotal: l.refill_subtotal,
      need_container: l.need_container,
      container_quantity: l.container_quantity,
      container_subtotal: l.container_subtotal,
      voucher_count: l.voucher_count,
      voucher_discount: l.voucher_discount,
      line_total: l.line_total,
      status,
    })),
    delivery_fee: cartDeliveryFee,
    subtotal: cartSubtotal,
    voucher_count_total: appliedVouchers,
    voucher_discount_total: voucherDiscountTotal,
    total_amount: totalAmount,
    payment_method,
    cash_tendered: ct,
    change_due: changeDue,
    loyalty_available_after: Math.max(0, available - appliedVouchers),
  });
}
