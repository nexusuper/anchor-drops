// Shared read helpers for the ops route screens. Web port of the Expo app's
// src/api/driverRoute.ts + src/api/staffRoute.ts. No offline cache here — the
// web driver flow is online-only (see pages/admin/ops/route/[orderId].js), so
// these read straight from Supabase under the caller's own RLS.

export const PAYMENT_METHODS = ['cod', 'gcash', 'bank_transfer', 'cash'];

// Same physical store as components/admin/RouteTab.js / the app's staffRoute.ts.
const STORE_MAP_ORIGIN = 'Phase 2B, Villa Trinitas, Barangay Bugo, Cagayan de Oro City';
const CITY = 'Cagayan de Oro';

// Business is PHT (UTC+8, no DST). Fixed offset, not the browser's timezone, so
// a misconfigured device can't shift which orders count as "today" — same
// approach as the app's staffRoute.ts.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

export function phtToday() {
  const d = new Date(Date.now() + PHT_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function phtDateLabel() {
  const d = new Date(Date.now() + PHT_OFFSET_MS);
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC', // d is already shifted into PHT
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// delivery_time is stored "HH:MM" 24h (app src/domain/scheduling.ts). Display only.
export function formatTime(time) {
  if (!time) return 'No time set';
  const [hStr, mStr] = String(time).split(':');
  const h = Number(hStr);
  if (Number.isNaN(h)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr ?? '00'} ${period}`;
}

export function peso(n) {
  return `₱${Number(n || 0).toFixed(2)}`;
}

export function stopAddress(o) {
  return [o.address, o.barangay, CITY].filter(Boolean).join(', ');
}

/** Single-stop directions link (origin = the driver's current location). */
export function navigateUrl(o) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stopAddress(o))}&travelmode=driving`;
}

// ponytail: stops stay in barangay/time order — free Google Maps URLs don't
// reorder stops (that's the paid Directions API). Ceiling: ~25+ stops can hit
// URL length limits; fine for a small shop, same ceiling as RouteTab.js.
export function fullRouteUrl(stops) {
  const segments = [STORE_MAP_ORIGIN, ...stops.map(stopAddress)].map((s) => encodeURIComponent(s));
  return `https://www.google.com/maps/dir/${segments.join('/')}`;
}

// Container balance per customer. Returns null (not a partial map) if the lookup
// fails — the route itself is delivery-critical and must not fail with it.
// Uses the customer_container_balance RPC (0015), NOT the container_balances
// view: the view is security_invoker so a driver's SUM under-reports the true
// balance. The RPC is SECURITY DEFINER and pre-aggregates across drivers.
export async function fetchContainerBalances(supabase, customerIds) {
  const ids = [...new Set(customerIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.rpc('customer_container_balance', { p_customer_ids: ids });
  if (error) return null;
  const byCustomer = new Map();
  for (const b of data ?? []) {
    if (!b.customer_id) continue;
    byCustomer.set(b.customer_id, b.balance ?? 0);
  }
  return byCustomer;
}

const STOP_SELECT = '*, customer_addresses(lat,lng), products(name)';
const ON_ROUTE_STATUSES = ['confirmed', 'out_for_delivery'];

function flatten(o, balances) {
  return {
    ...o,
    lat: o.customer_addresses?.lat ?? null,
    lng: o.customer_addresses?.lng ?? null,
    productName: o.products?.name ?? null,
    // A customer with no ledger rows genuinely holds nothing -> 0. Only an
    // unavailable lookup stays null, which the stop screen renders as
    // "not available" rather than a confident wrong number.
    containerBalance: balances && o.customer_id ? (balances.get(o.customer_id) ?? 0) : null,
  };
}

/**
 * Today's assigned stops for the signed-in driver. RLS (orders_sel) already
 * restricts rows to driver_id = auth.uid(); the explicit filter keeps an
 * owner/admin from seeing the whole branch's board on a driver screen.
 */
export async function fetchDriverStops(supabase, driverId) {
  const { data, error } = await supabase
    .from('orders')
    .select(STOP_SELECT)
    .is('archived_at', null)
    .eq('driver_id', driverId)
    .in('status', ON_ROUTE_STATUSES)
    .order('route_position', { ascending: true, nullsFirst: false });
  if (error) throw error;
  const balances = await fetchContainerBalances(supabase, (data ?? []).map((o) => o.customer_id));
  return (data ?? []).map((o) => flatten(o, balances));
}

/** One stop by id, with the same shape as fetchDriverStops rows. */
export async function fetchStop(supabase, orderId) {
  const { data, error } = await supabase
    .from('orders')
    .select(STOP_SELECT)
    .is('archived_at', null)
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const balances = await fetchContainerBalances(supabase, [data.customer_id]);
  return flatten(data, balances);
}

/**
 * Staff view: every confirmed/out-for-delivery order scheduled for today,
 * grouped by barangay. delivery_date is matched OR-null because the app's
 * create_order call passes null for it (staff assign the window later).
 * No manual branch_id filter — RLS scopes it.
 */
export async function fetchStaffRoute(supabase) {
  const today = phtToday();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .is('archived_at', null)
    .in('status', ON_ROUTE_STATUSES)
    .or(`delivery_date.eq.${today},delivery_date.is.null`)
    .order('delivery_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return groupByBarangay(data ?? []);
}

export function groupByBarangay(orders) {
  const map = new Map();
  for (const o of orders) {
    const key = o.barangay || 'Unspecified';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  }
  return [...map.entries()]
    .map(([barangay, stops]) => ({ barangay, stops }))
    .sort((a, b) => a.barangay.localeCompare(b.barangay));
}
