import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const adminRate = rateLimit({ windowMs: 60_000, max: 60 });

function manilaDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();

  try {
    const today = manilaDate();
    const monthPrefix = today.slice(0, 7);
    const days = [];
    for (let i = 29; i >= 0; i--) days.push(manilaDate(new Date(Date.now() - i * 86_400_000)));
    const monthStart = `${monthPrefix}-01`;
    const windowStart = days[0] < monthStart ? days[0] : monthStart;

    const { data: recent, error: recentErr } = await supabase
      .from('orders')
      .select('created_at, total_amount, status, phone_normalized')
      .gte('created_at', windowStart);
    if (recentErr) throw recentErr;

    const monthOrders = recent.filter(
      (o) => manilaDate(new Date(o.created_at)).slice(0, 7) === monthPrefix && o.status !== 'cancelled'
    );
    const revenueThisMonth = monthOrders.reduce((s, o) => s + (Number(o.total_amount) || 0), 0);
    const ordersThisMonth = monthOrders.length;
    const avgOrderValue = ordersThisMonth > 0 ? revenueThisMonth / ordersThisMonth : 0;
    const activeCustomers30d = new Set(recent.map((o) => o.phone_normalized).filter(Boolean)).size;

    const seriesMap = new Map(days.map((d) => [d, { date: d, revenue: 0, orders: 0 }]));
    for (const o of recent) {
      if (o.status === 'cancelled') continue;
      const d = manilaDate(new Date(o.created_at));
      const entry = seriesMap.get(d);
      if (entry) { entry.revenue += Number(o.total_amount) || 0; entry.orders += 1; }
    }
    const revenueSeries = days.map((d) => {
      const e = seriesMap.get(d);
      return { date: d, revenue: Math.round(e.revenue * 100) / 100, orders: e.orders };
    });

    const { data: expenseRows, error: expErr } = await supabase
      .from('expenses').select('amount')
      .eq('branch_id', DEFAULT_BRANCH_ID)
      .gte('spent_at', monthStart);
    if (expErr) throw expErr;
    const expensesThisMonth = (expenseRows || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const netThisMonth = revenueThisMonth - expensesThisMonth;

    const { data: statusRows, error: statusErr } = await supabase.from('orders').select('status');
    if (statusErr) throw statusErr;
    const statusCountMap = {};
    for (const r of statusRows) statusCountMap[r.status] = (statusCountMap[r.status] || 0) + 1;
    const statusBreakdown = Object.entries(statusCountMap)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const { data: barangayRows, error: bErr } = await supabase
      .from('orders').select('barangay').not('barangay', 'is', null).neq('barangay', '');
    if (bErr) throw bErr;
    const barangayCountMap = {};
    for (const r of barangayRows) barangayCountMap[r.barangay] = (barangayCountMap[r.barangay] || 0) + 1;
    const topBarangays = Object.entries(barangayCountMap)
      .map(([barangay, count]) => ({ barangay, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const { data: custRows, error: cErr } = await supabase
      .from('orders')
      .select('phone_normalized, customer_name, phone, total_amount')
      .neq('status', 'cancelled')
      .not('phone_normalized', 'is', null)
      .neq('phone_normalized', '');
    if (cErr) throw cErr;
    const custMap = new Map();
    for (const o of custRows) {
      const key = o.phone_normalized;
      const entry = custMap.get(key) || { customer_name: o.customer_name, phone_display: o.phone, total_spent: 0, total_orders: 0 };
      entry.total_spent += Number(o.total_amount) || 0;
      entry.total_orders += 1;
      entry.customer_name = o.customer_name;
      entry.phone_display = o.phone;
      custMap.set(key, entry);
    }
    const topCustomers = [...custMap.values()]
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 5)
      .map((c) => ({ ...c, total_spent: Math.round(c.total_spent * 100) / 100 }));

    return res.status(200).json({
      kpis: {
        revenueThisMonth: Math.round(revenueThisMonth * 100) / 100,
        ordersThisMonth,
        activeCustomers30d,
        avgOrderValue: Math.round(avgOrderValue * 100) / 100,
        expensesThisMonth: Math.round(expensesThisMonth * 100) / 100,
        netThisMonth: Math.round(netThisMonth * 100) / 100,
      },
      revenueSeries,
      statusBreakdown,
      topBarangays,
      topCustomers,
    });
  } catch (err) {
    console.error('Dashboard query failed:', err);
    return res.status(500).json({ error: 'Failed to load dashboard' });
  }
}
