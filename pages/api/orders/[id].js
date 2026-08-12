import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminSoftLockout, verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { normalizePhone } from '@/lib/loyalty';
import { buildStatusMessage, NOTIFIABLE_STATUSES } from '@/lib/notifications';
import { sendMessengerMessage } from '@/lib/facebook';
import { recordContainerMove } from '@/lib/containers';
import { z } from 'zod';

const PatchSchema = z.object({
  status: z.enum(['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled']).optional(),
  payment_verified: z.boolean().optional(),
});

// Customer self-cancel: the only non-admin mutation. Phone-gated exactly like
// the read path — same trust level, and narrowed to pending orders only.
const CancelSchema = z.object({
  status: z.literal('cancelled'),
  phone: z.string().min(7).max(20),
});

const readRate = rateLimit({ windowMs: 60_000, max: 30 });
const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

// delivery_slot only ever held the legacy 'am'/'pm' values the ManyChat intake
// writes; structured orders store 'HH:MM' in delivery_time. Echoing the raw
// time back as a slot as well made the confirmation page render the delivery
// window twice.
const legacySlot = (t) => (t === 'am' || t === 'pm' ? t : null);

export default async function handler(req, res) {
  const supabase = getSupabase();
  const { id } = req.query;

  if (req.method === 'GET') {
    if (!readRate(req, res)) return;

    // ADW = current prefix, CFW = pre-rename Clear Flow orders. Both still
    // resolve; historic order numbers were left in place on the rebrand.
    const isOrderNumber = /^(ADW|CFW)-[A-Z]+-\d{6}-[A-Z0-9]{4}-\d+$/i.test(id);
    const { data: order, error } = await supabase.from('orders')
      .select('*').eq(isOrderNumber ? 'order_number' : 'id', isOrderNumber ? id.toUpperCase() : id).single();
    if (error || !order) return res.status(404).json({ error: 'Order not found' });

    if (!await verifyAdminSoftLockout(req)) {
      const phone = normalizePhone(req.query.phone);
      const orderPhone = normalizePhone(order.phone);
      if (!phone || phone !== orderPhone) {
        return res.status(200).json({
          id: order.id, order_number: order.order_number, status: order.status, created_at: order.created_at,
          product_type: order.product_type, container_size: order.container_size,
          quantity: order.quantity, total_amount: order.total_amount,
          customer_name: (order.customer_name || '').trim().split(/\s+/)[0] || order.customer_name,
          voucher_count: order.voucher_count, voucher_discount: order.voucher_discount,
          reward_requested: order.reward_requested,
          delivery_slot: legacySlot(order.delivery_time), delivery_date: order.delivery_date,
          has_empty_containers: !!order.pickup_date,
          pickup_date: order.pickup_date, pickup_time: order.pickup_time,
          delivery_time: order.delivery_time,
        });
      }
      return res.status(200).json({
        id: order.id, order_number: order.order_number, status: order.status, created_at: order.created_at,
        product_type: order.product_type, container_size: order.container_size,
        quantity: order.quantity, total_amount: order.total_amount,
        customer_name: order.customer_name, phone: order.phone, address: order.address, barangay: order.barangay,
        notes: order.notes, payment_method: order.payment_method,
        need_container: order.need_container, container_quantity: order.container_quantity,
        voucher_count: order.voucher_count, voucher_discount: order.voucher_discount,
        reward_requested: order.reward_requested,
        delivery_slot: legacySlot(order.delivery_time), delivery_date: order.delivery_date,
        has_empty_containers: !!order.pickup_date,
        pickup_date: order.pickup_date, pickup_time: order.pickup_time,
        delivery_time: order.delivery_time,
        payment_verified: order.payment_verified,
      });
    }

    return res.status(200).json(order);
  }

  if (req.method === 'PATCH') {
    if (!adminRate(req, res)) return;

    // Customer self-cancel, before the admin gate. Requires the order's own
    // phone number and only ever moves a pending order to cancelled — it can
    // neither read the order back nor touch any other field.
    const cancelParsed = CancelSchema.safeParse(req.body);
    if (cancelParsed.success && !req.headers['password']) {
      const { data: order } = await supabase.from('orders')
        .select('id, phone, status').eq('id', id).single();
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (normalizePhone(cancelParsed.data.phone) !== normalizePhone(order.phone)) {
        return res.status(403).json({ error: 'That phone number does not match this order' });
      }
      if (order.status !== 'pending') {
        return res.status(400).json({ error: 'Only a pending order can be cancelled. Please call us instead.' });
      }
      await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id).eq('status', 'pending');
      return res.status(200).json({ success: true });
    }

    if (!await verifyAdminWithLockout(req, res)) return;

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update data' });
    const { status, payment_verified } = parsed.data;
    if (status === undefined && payment_verified === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    if (payment_verified !== undefined) {
      const { data: exists } = await supabase.from('orders').select('id').eq('id', id).single();
      if (!exists) return res.status(404).json({ error: 'Order not found' });
      await supabase.from('orders').update({ payment_verified }).eq('id', id);
      if (status === undefined) return res.status(200).json({ success: true });
    }

    if (status !== undefined) {
      const { data: order } = await supabase.from('orders').select('*').eq('id', id).single();
      if (!order) return res.status(404).json({ error: 'Order not found' });

      await supabase.from('orders').update({ status }).eq('id', id);

      if (NOTIFIABLE_STATUSES.includes(status) && order.messenger_psid) {
        try {
          const text = buildStatusMessage(order, status, 'messenger');
          await sendMessengerMessage(order.messenger_psid, text);
          await supabase.from('contact_log').insert({
            branch_id: DEFAULT_BRANCH_ID,
            phone_normalized: normalizePhone(order.phone),
            channel: 'messenger', direction: 'outbound', summary: text, order_id: id,
          });
        } catch (notifyErr) {
          console.error('Auto Messenger notify failed:', notifyErr);
          // A PSID that exists but whose send fails (FB's 24h window closes
          // routinely) has to raise the same "tell them manually" flag as no
          // PSID at all, or the failure is invisible to the owner.
          await supabase.from('orders').update({ sms_pending: true }).eq('id', id);
        }
      } else if (NOTIFIABLE_STATUSES.includes(status)) {
        // Notifiable status change but no linked Messenger PSID — flag for staff
        // to send the SMS reminder manually (AdminPanel shows the pending badge).
        await supabase.from('orders').update({ sms_pending: true }).eq('id', id);
      }

      // A delivered order cancelled afterwards (admin PATCH allows any
      // transition; the customer self-cancel above is pending-only) must undo
      // its own delivery_out — the customer is not holding those containers.
      // 'adjustment', not 'pickup_return': no pickup happened. Guarded on the
      // pre-update status, so cancelling twice reverses once.
      if (status === 'cancelled' && order.status === 'delivered' && order.need_container) {
        await recordContainerMove(supabase, {
          phone: order.phone,
          customerId: order.customer_id,
          orderId: order.id,
          delta: -(Number(order.container_quantity) || 0),
          kind: 'adjustment',
          note: `order ${order.order_number || order.id} cancelled after delivery`,
        });
      }

      // ponytail: guard on the pre-update status, not a new column — old schema's
      // inventory_deducted flag has no equivalent here, but "was it already
      // delivered" is the same idempotency check with one fewer table.
      if (status === 'delivered' && order.status !== 'delivered') {
        // Containers handed over on this delivery. Same guard as the inventory
        // deduct, so it is idempotent for the same reason.
        if (order.need_container) {
          await recordContainerMove(supabase, {
            phone: order.phone,
            customerId: order.customer_id,
            orderId: order.id,
            delta: Number(order.container_quantity) || 0,
            kind: 'delivery_out',
            note: `order ${order.order_number || order.id} delivered`,
          });
        }
        try {
          const { error: invErr } = await supabase.rpc('adjust_inventory', {
            p_branch_id: DEFAULT_BRANCH_ID,
            p_product_id: order.product_type,
            p_delta: -(Number(order.quantity) || 0),
            p_type: 'sale',
            p_reason: `order ${id} delivered`,
          });
          if (invErr && !String(invErr.message || '').includes('chk_inventory_stock_nonneg')) {
            console.error('Inventory auto-deduct failed:', invErr);
          }
        } catch (invErr) {
          console.error('Inventory auto-deduct failed:', invErr);
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Nothing to update' });
  }

  if (req.method === 'DELETE') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;
    const { data: order } = await supabase.from('orders').select('status').eq('id', id).single();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!['delivered', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: 'Only delivered or cancelled orders can be deleted' });
    }
    await supabase.from('orders').delete().eq('id', id);
    return res.status(200).json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
