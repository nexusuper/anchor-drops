// Plain data-layer functions mirroring anchor-drops-system/src/api/reports.ts
// (sales/delivery/inventory/customer/production report builders). No TanStack
// Query here — pages/admin/ops/reports.js calls these from useState/useEffect.
// RLS scopes every read for admin/staff; `branchId` is an extra filter the
// owner's branch picker supplies, same convention as the app.

// Business is PHT (UTC+8, fixed, no DST) — same convention as the app.
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000;

function phtDateToUtcStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - PHT_OFFSET_MS);
}

function rangeToUtcBounds(range) {
  const fromISO = phtDateToUtcStart(range.from).toISOString();
  const toISO = new Date(phtDateToUtcStart(range.to).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { fromISO, toISO };
}

function toPhtDateStr(iso) {
  return new Date(new Date(iso).getTime() + PHT_OFFSET_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Sales report — orders count/total by day and by status.
// ---------------------------------------------------------------------------

export async function fetchSalesReport(supabase, dateRange, branchId) {
  const { fromISO, toISO } = rangeToUtcBounds(dateRange);
  let q = supabase
    .from('orders')
    .select('status, total_amount, created_at')
    .is('archived_at', null)
    .gte('created_at', fromISO)
    .lt('created_at', toISO);
  if (branchId) q = q.eq('branch_id', branchId);
  const { data, error } = await q;
  if (error) throw error;

  const byDayMap = new Map();
  const byStatusMap = new Map();
  let totalCount = 0;
  let totalAmount = 0;
  for (const row of data ?? []) {
    const amount = row.total_amount ?? 0;
    totalCount += 1;
    totalAmount += amount;

    const day = toPhtDateStr(row.created_at);
    const dayEntry = byDayMap.get(day) ?? { count: 0, total: 0 };
    dayEntry.count += 1;
    dayEntry.total += amount;
    byDayMap.set(day, dayEntry);

    const statusEntry = byStatusMap.get(row.status) ?? { count: 0, total: 0 };
    statusEntry.count += 1;
    statusEntry.total += amount;
    byStatusMap.set(row.status, statusEntry);
  }

  return {
    byDay: [...byDayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    byStatus: [...byStatusMap.entries()].map(([status, v]) => ({ status, ...v })),
    totalCount,
    totalAmount,
  };
}

// ---------------------------------------------------------------------------
// Delivery report — completed deliveries by driver, count + avg time from
// order creation to delivery.
// ---------------------------------------------------------------------------

export async function fetchDeliveryReport(supabase, dateRange, branchId) {
  const { fromISO, toISO } = rangeToUtcBounds(dateRange);
  let podQuery = supabase
    .from('proof_of_delivery')
    .select('order_id, driver_id, delivered_at')
    .gte('delivered_at', fromISO)
    .lt('delivered_at', toISO);
  if (branchId) podQuery = podQuery.eq('branch_id', branchId);
  const { data: pod, error: podError } = await podQuery;
  if (podError) throw podError;

  const orderIds = [...new Set((pod ?? []).map((p) => p.order_id))];
  const orderCreatedAt = new Map();
  if (orderIds.length > 0) {
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, created_at')
      .in('id', orderIds);
    if (ordersError) throw ordersError;
    for (const o of orders ?? []) orderCreatedAt.set(o.id, o.created_at);
  }

  const driverIds = [...new Set((pod ?? []).map((p) => p.driver_id))];
  const driverNames = new Map();
  if (driverIds.length > 0) {
    // Best-effort — RLS may not return every driver's profile to every
    // caller; fall back to the raw id below when a name is missing.
    const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
    for (const p of profiles ?? []) if (p.full_name) driverNames.set(p.id, p.full_name);
  }

  const byDriverMap = new Map();
  for (const row of pod ?? []) {
    const entry = byDriverMap.get(row.driver_id) ?? { hoursSum: 0, hoursCount: 0, count: 0 };
    entry.count += 1;
    const createdAt = orderCreatedAt.get(row.order_id);
    if (createdAt) {
      const hours = (new Date(row.delivered_at).getTime() - new Date(createdAt).getTime()) / 3_600_000;
      entry.hoursSum += hours;
      entry.hoursCount += 1;
    }
    byDriverMap.set(row.driver_id, entry);
  }

  return {
    byDriver: [...byDriverMap.entries()].map(([driverId, v]) => ({
      driverId,
      driverName: driverNames.get(driverId) ?? driverId,
      count: v.count,
      avgHours: v.hoursCount > 0 ? v.hoursSum / v.hoursCount : null,
    })),
    totalCount: pod?.length ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Inventory report — current stock levels + recent movement summary
// (inventory_log over the trailing 30 days, grouped by product + type).
// ---------------------------------------------------------------------------

const MOVEMENT_LOOKBACK_DAYS = 30;

export async function fetchInventoryReport(supabase, branchId) {
  let stockQuery = supabase.from('inventory').select('product_id, current_stock, low_stock_threshold');
  if (branchId) stockQuery = stockQuery.eq('branch_id', branchId);
  const { data: stock, error: stockError } = await stockQuery;
  if (stockError) throw stockError;

  const sinceISO = new Date(Date.now() - MOVEMENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let logQuery = supabase.from('inventory_log').select('product_id, type, delta').gte('created_at', sinceISO);
  if (branchId) logQuery = logQuery.eq('branch_id', branchId);
  const { data: logs, error: logError } = await logQuery;
  if (logError) throw logError;

  const movementMap = new Map();
  for (const row of logs ?? []) {
    const key = `${row.product_id}::${row.type}`;
    movementMap.set(key, (movementMap.get(key) ?? 0) + row.delta);
  }

  return {
    stock: (stock ?? []).map((s) => ({
      productId: s.product_id,
      currentStock: s.current_stock,
      lowStockThreshold: s.low_stock_threshold,
    })),
    recentMovement: [...movementMap.entries()].map(([key, totalDelta]) => {
      const [productId, type] = key.split('::');
      return { productId, type, totalDelta };
    }),
  };
}

// ---------------------------------------------------------------------------
// Customer report — top customers by order count/total, new customers in
// range.
// ---------------------------------------------------------------------------

const TOP_CUSTOMERS_LIMIT = 20;

export async function fetchCustomerReport(supabase, dateRange, branchId) {
  const { fromISO, toISO } = rangeToUtcBounds(dateRange);

  let ordersQuery = supabase
    .from('orders')
    .select('customer_id, customer_name, total_amount')
    .is('archived_at', null)
    .gte('created_at', fromISO)
    .lt('created_at', toISO)
    .not('customer_id', 'is', null);
  if (branchId) ordersQuery = ordersQuery.eq('branch_id', branchId);
  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;

  const byCustomer = new Map();
  for (const row of orders ?? []) {
    const id = row.customer_id;
    const entry = byCustomer.get(id) ?? { name: row.customer_name, orderCount: 0, total: 0 };
    entry.orderCount += 1;
    entry.total += row.total_amount ?? 0;
    byCustomer.set(id, entry);
  }
  const topCustomers = [...byCustomer.entries()]
    .map(([customerId, v]) => ({ customerId, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_CUSTOMERS_LIMIT);

  let newCustomersQuery = supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', fromISO)
    .lt('created_at', toISO);
  if (branchId) newCustomersQuery = newCustomersQuery.eq('branch_id', branchId);
  const { count, error: newCustomersError } = await newCustomersQuery;
  if (newCustomersError) throw newCustomersError;

  return { topCustomers, newCustomersCount: count ?? 0 };
}

// ---------------------------------------------------------------------------
// Production report — volume totals + quality test pass rate.
// ---------------------------------------------------------------------------

export async function fetchProductionReport(supabase, dateRange, branchId) {
  const { fromISO, toISO } = rangeToUtcBounds(dateRange);

  let prodQuery = supabase
    .from('production_logs')
    .select('volume_liters')
    .gte('produced_at', fromISO)
    .lt('produced_at', toISO);
  if (branchId) prodQuery = prodQuery.eq('branch_id', branchId);
  const { data: prodLogs, error: prodError } = await prodQuery;
  if (prodError) throw prodError;

  let qualityQuery = supabase
    .from('quality_tests')
    .select('passed')
    .gte('tested_at', fromISO)
    .lt('tested_at', toISO);
  if (branchId) qualityQuery = qualityQuery.eq('branch_id', branchId);
  const { data: qualityTests, error: qualityError } = await qualityQuery;
  if (qualityError) throw qualityError;

  const totalVolumeLiters = (prodLogs ?? []).reduce((sum, r) => sum + (r.volume_liters ?? 0), 0);
  const qualityTotal = qualityTests?.length ?? 0;
  const qualityPassed = (qualityTests ?? []).filter((t) => t.passed).length;

  return {
    totalVolumeLiters,
    batchCount: prodLogs?.length ?? 0,
    qualityTotal,
    qualityPassed,
    passRate: qualityTotal > 0 ? qualityPassed / qualityTotal : null,
  };
}
