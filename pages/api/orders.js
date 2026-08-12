import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import crypto from 'node:crypto';
import { computeRewards, normalizePhone } from '@/lib/loyalty';
import { hashCode, CODE_MAX_ATTEMPTS } from '@/lib/reward-codes';
import { verifyAdminWithLockout, timingSafeEqual } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { PRODUCTS_BY_ID } from '@/lib/products';
import { validateSchedule, manilaToday } from '@/lib/scheduling';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });
const orderRate = rateLimit({ windowMs: 60_000, max: 10 });

const OrderSchema = z.object({
  customer_name: z.string().min(1).max(200),
  phone: z.string().min(7).max(20),
  address: z.string().min(1).max(500),
  barangay: z.string().min(1).max(200),
  product_type: z.string().min(1).max(50),
  container_size: z.string().min(1).max(20),
  quantity: z.coerce.number().int().min(1).max(50),
  need_container: z.boolean().or(z.literal(0)).or(z.literal(1)).optional().default(false),
  container_quantity: z.coerce.number().int().min(0).max(50).optional().default(0),
  payment_method: z.enum(['cod', 'gcash', 'bank_transfer']),
  gcash_number: z.string().max(20).optional().nullable(),
  reference_number: z.string().max(100).optional().nullable(),
  // The form posts '' when no file is attached (all COD orders), so the empty
  // string has to parse — '' is a string, so .optional() alone never engages.
  payment_screenshot: z
    .union([z.literal(''), z.string().startsWith('data:image/').max(2_000_000)])
    .optional()
    .nullable(),
  notes: z.string().max(1000).optional().nullable(),
  total_amount: z.coerce.number().min(0),
  reward_requested: z.coerce.number().int().min(0).max(50).optional().default(0),
  reward_code: z.string().max(10).optional().nullable(),
  has_empty_containers: z.boolean().or(z.literal(0)).or(z.literal(1)).optional().default(false),
  pickupDate: z.string().max(10).optional().nullable(),
  pickupTime: z.string().max(5).optional().nullable(),
  deliveryDate: z.string().max(10).min(1),
  deliveryTime: z.string().max(5).min(1),
  // Client-generated idempotency key. create_order dedupes on it, so a retry
  // after a network timeout returns the original order instead of a duplicate.
  client_order_id: z.string().uuid().optional().nullable(),
  lat: z.coerce.number().gte(-90).lte(90).nullish(),
  lng: z.coerce.number().gte(-180).lte(180).nullish(),
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!adminRate(req, res)) return;
    if (!await verifyAdminWithLockout(req, res)) return;
    try {
      const supabase = getSupabase();
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;
      const statusFilter = req.query.status || '';
      const search = (req.query.search || '').trim();
      const sortParam = req.query.sort || 'date_desc';

      const validStatuses = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
      const hasStatus = validStatuses.includes(statusFilter);

      const sortMap = {
        date_desc: ['created_at', false], date_asc: ['created_at', true],
        total_desc: ['total_amount', false], total_asc: ['total_amount', true],
        name_asc: ['customer_name', true], name_desc: ['customer_name', false],
        status_asc: ['status', true],
      };
      const [sortCol, sortAsc] = sortMap[sortParam] || sortMap.date_desc;

      let query = supabase.from('orders').select('*', { count: 'exact' });
      if (hasStatus) query = query.eq('status', statusFilter);
      // PostgREST splits or() on commas, so an unquoted search for "Smith, John"
      // would break the filter apart mid-value and 500. Quote each value and
      // escape any quote/backslash inside it.
      if (search) {
        const q = search.replace(/["\\]/g, '\\$&');
        query = query.or(`customer_name.ilike."%${q}%",phone.ilike."%${q}%"`);
      }
      query = query.order(sortCol, { ascending: sortAsc }).range(offset, offset + limit - 1);

      const [{ data: rows, count: total, error }, { data: statusRows }] = await Promise.all([
        query,
        supabase.from('orders').select('status'),
      ]);
      if (error) throw error;

      const statusCounts = {};
      for (const r of statusRows || []) statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;

      // payment_screenshot_path is a bare Storage path, not a servable URL —
      // resolve to a short-lived signed URL before sending to the client.
      const paths = [...new Set((rows || []).map((o) => o.payment_screenshot_path).filter(Boolean))];
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from('payment-screenshots').createSignedUrls(paths, 3600);
        const urlByPath = new Map((signed || []).filter((s) => !s.error).map((s) => [s.path, s.signedUrl]));
        for (const o of rows || []) {
          if (o.payment_screenshot_path) o.payment_screenshot_path = urlByPath.get(o.payment_screenshot_path) || null;
        }
      }

      return res.status(200).json({
        orders: rows,
        total: total ?? 0,
        page,
        totalPages: Math.ceil((total ?? 0) / limit) || 1,
        statusCounts,
      });
    } catch (err) {
      console.error('Order list query failed:', err);
      return res.status(500).json({ error: 'Failed to load orders' });
    }
  }

  if (req.method === 'POST') {
    if (!orderRate(req, res)) return;

    const parsed = OrderSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error('Order validation failed:', JSON.stringify(parsed.error.issues));
      return res.status(400).json({ error: 'Invalid order data' });
    }
    const {
      customer_name, phone, address, barangay,
      product_type, quantity,
      need_container, container_quantity,
      payment_method, gcash_number, reference_number, payment_screenshot,
      notes, reward_requested, reward_code,
      has_empty_containers, pickupDate, pickupTime, deliveryDate, deliveryTime,
      client_order_id, lat, lng,
    } = parsed.data;

    const product = PRODUCTS_BY_ID[product_type];
    if (!product) {
      return res.status(400).json({ error: 'Unknown product' });
    }

    const hasEmptyContainers = !!has_empty_containers;
    const today = manilaToday();
    const scheduleCheck = validateSchedule({
      hasEmptyContainers, pickupDate, pickupTime, deliveryDate, deliveryTime, today,
    });
    if (!scheduleCheck.ok) {
      return res.status(400).json({ error: scheduleCheck.error });
    }

    const containerSize = product.size;
    // Everything below can throw (missing/invalid Supabase env, network, storage).
    // Without this boundary an uncaught throw returns Next's HTML 500 page, which
    // the client parses as JSON and surfaces as "Unexpected token '<'". Return
    // JSON so the customer sees a real message and the cause lands in logs.
    try {
    const supabase = getSupabase();
    const normPhone = normalizePhone(phone);

    // supabase-js resolves with { data: null, error } rather than throwing, so
    // the error has to be read explicitly or a failed lookup silently reads as
    // "no vouchers earned".
    let available = 0;
    const { data: prior, error: priorErr } = await supabase
      .from('orders')
      .select('status, container_size, quantity, voucher_count')
      .eq('phone_normalized', normPhone);
    if (priorErr) console.error('Reward balance lookup failed:', priorErr);
    else available = computeRewards(prior || []).available;

    const requested = Math.max(0, Math.min(reward_requested || 0, quantity));
    // Redeeming against an unknown balance marks the customer's code used but
    // applies no discount, so refuse instead. Non-redeeming orders are
    // unaffected by a failed lookup and still go through.
    if (priorErr && requested > 0) {
      return res.status(503).json({ error: 'Could not verify your rewards balance. Please try again.' });
    }

    let voucher_count = 0;
    let reward_requested_store = 0;
    if (requested > 0 && reward_code) {
      try {
        const { data: codeRows } = await supabase
          .from('reward_codes')
          .select('id, code_hash, expires_at, used, attempts')
          .eq('phone', normPhone)
          .eq('used', false)
          .order('created_at', { ascending: false })
          .limit(1);
        const row = codeRows?.[0];
        const nowIso = new Date().toISOString();
        if (row && row.expires_at > nowIso && row.attempts < CODE_MAX_ATTEMPTS) {
          if (timingSafeEqual(row.code_hash, hashCode(normPhone, String(reward_code)))) {
            const { data: claimed } = await supabase
              .from('reward_codes')
              .update({ used: true })
              .eq('id', row.id)
              .eq('used', false)
              .select('id');
            if (claimed && claimed.length > 0) {
              voucher_count = Math.min(requested, available);
            } else {
              reward_requested_store = requested;
            }
          } else {
            await supabase.from('reward_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);
            reward_requested_store = requested;
          }
        } else {
          if (row && row.attempts >= CODE_MAX_ATTEMPTS) {
            await supabase.from('reward_codes').update({ used: true }).eq('id', row.id);
          }
          reward_requested_store = requested;
        }
      } catch (e) {
        reward_requested_store = requested;
      }
    } else if (requested > 0) {
      reward_requested_store = requested;
    }

    const id = client_order_id || crypto.randomUUID();

    let screenshotSaved = true;
    let screenshotPath = null;
    if (payment_screenshot) {
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(payment_screenshot);
      if (match) {
        const [, contentType, base64] = match;
        const ext = contentType === 'image/png' ? 'png' : 'jpg';
        screenshotPath = `${id}/payment.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('payment-screenshots')
          .upload(screenshotPath, Buffer.from(base64, 'base64'), { contentType, upsert: true });
        if (uploadErr) {
          console.error('Screenshot upload failed:', uploadErr);
          screenshotPath = null;
          screenshotSaved = false;
        }
      } else {
        screenshotSaved = false;
      }
    }

    const { data: order, error: rpcErr } = await supabase.rpc('create_order', {
      p_client_order_id: id,
      p_branch_id: DEFAULT_BRANCH_ID,
      p_customer_name: customer_name,
      p_phone: phone,
      p_address: address,
      p_barangay: barangay,
      p_address_label: 'Home',
      p_product_type: product_type,
      p_container_size: containerSize,
      p_quantity: quantity,
      p_need_container: !!need_container,
      p_container_quantity: container_quantity || 0,
      p_payment_method: payment_method,
      p_gcash_number: gcash_number || null,
      p_reference_number: reference_number || null,
      p_payment_screenshot_path: screenshotPath,
      p_notes: notes || null,
      p_total_amount: 0,
      p_sale_channel: 'online',
      p_cash_tendered: null,
      p_voucher_count: voucher_count,
      p_reward_requested: reward_requested_store,
      p_delivery_date: deliveryDate,
      p_delivery_time: deliveryTime,
      // Persist the pickup window on the order itself, not just the
      // container_pickups ops queue -- /api/orders/[id] derives
      // has_empty_containers from orders.pickup_date, which was always null.
      p_pickup_date: hasEmptyContainers ? pickupDate : null,
      p_pickup_time: hasEmptyContainers ? pickupTime : null,
      p_lat: lat ?? null,
      p_lng: lng ?? null,
    });

    if (rpcErr) {
      console.error('Order insert failed:', rpcErr);
      return res.status(500).json({ error: 'Failed to place order' });
    }

    if (hasEmptyContainers) {
      const { error: pickupErr } = await supabase.from('container_pickups').insert({
        branch_id: DEFAULT_BRANCH_ID,
        order_id: order.id,
        customer_name, phone, address, barangay,
        container_qty: quantity,
        pickup_date: pickupDate, pickup_time: pickupTime,
        delivery_date: deliveryDate, delivery_time: deliveryTime,
        status: 'scheduled', notes: '',
      });
      if (pickupErr) console.error('Container pickup insert failed:', pickupErr);
    }

    return res.status(201).json({
      id: order.id, order_number: order.order_number, created_at: order.created_at,
      screenshot_saved: screenshotSaved,
    });
    } catch (err) {
      console.error('Order POST failed:', err);
      return res.status(500).json({ error: 'Failed to place order. Please try again.' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
