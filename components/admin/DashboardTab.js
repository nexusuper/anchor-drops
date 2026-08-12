import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-client';

export default function DashboardTab({ savedPassword }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      apiFetch('/api/dashboard', { password: savedPassword })
        .then((d) => { if (!cancelled) setDashboard(d); })
        .catch((e) => console.error('Failed to fetch dashboard:', e))
        .finally(() => { if (!cancelled) setLoading(false); });
    });
    return () => { cancelled = true; };
  }, [savedPassword]);

  return (
    <div className="space-y-6">
      {loading && !dashboard && (
        <p className="text-clay-ink/60 text-sm">Loading dashboard…</p>
      )}
      {dashboard && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Revenue (This Month)', value: '₱' + dashboard.kpis.revenueThisMonth.toLocaleString() },
              { label: 'Expenses (This Month)', value: '₱' + (dashboard.kpis.expensesThisMonth ?? 0).toLocaleString(), tone: 'text-rose-600' },
              {
                label: 'Net Profit (This Month)',
                value: '₱' + (dashboard.kpis.netThisMonth ?? 0).toLocaleString(),
                tone: (dashboard.kpis.netThisMonth ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600',
              },
              { label: 'Orders (This Month)', value: dashboard.kpis.ordersThisMonth },
              { label: 'Active Customers (30d)', value: dashboard.kpis.activeCustomers30d },
              { label: 'Avg Order Value', value: '₱' + dashboard.kpis.avgOrderValue.toLocaleString() },
            ].map((k) => (
              <div key={k.label} className="clay-raised rounded-2xl p-4">
                <p className="text-xs text-clay-ink/60 font-medium">{k.label}</p>
                <p className={'text-2xl font-bold mt-1 ' + (k.tone || 'text-sky-700')}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="clay-raised rounded-2xl p-4">
            <p className="text-sm font-semibold text-clay-ink mb-3">Revenue — last 30 days</p>
            {(() => {
              const max = Math.max(1, ...dashboard.revenueSeries.map((d) => d.revenue));
              return (
                <div className="flex items-end gap-[2px] h-32">
                  {dashboard.revenueSeries.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ₱${d.revenue.toLocaleString()} (${d.orders} orders)`}
                      className="flex-1 bg-sky-400 hover:bg-sky-500 rounded-t transition-colors"
                      style={{ height: `${Math.max(2, (d.revenue / max) * 100)}%` }}
                    />
                  ))}
                </div>
              );
            })()}
            <div className="flex justify-between text-[10px] text-clay-ink/50 mt-1">
              <span>{dashboard.revenueSeries[0]?.date}</span>
              <span>{dashboard.revenueSeries[dashboard.revenueSeries.length - 1]?.date}</span>
            </div>
          </div>

          <div className="clay-raised rounded-2xl p-4">
            <p className="text-sm font-semibold text-clay-ink mb-3">Orders by status</p>
            {(() => {
              const max = Math.max(1, ...dashboard.statusBreakdown.map((s) => s.count));
              return (
                <div className="space-y-2">
                  {dashboard.statusBreakdown.map((s) => (
                    <div key={s.status} className="flex items-center gap-2">
                      <span className="w-32 text-xs capitalize text-clay-ink/70">{s.status.replace(/_/g, ' ')}</span>
                      <div className="flex-1 bg-clay-inset rounded-full h-4 overflow-hidden">
                        <div className="bg-sky-400 h-full rounded-full" style={{ width: `${(s.count / max) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right text-xs font-semibold text-clay-ink">{s.count}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="clay-raised rounded-2xl p-4">
              <p className="text-sm font-semibold text-clay-ink mb-3">Top barangays</p>
              <ul className="space-y-1.5">
                {dashboard.topBarangays.map((b) => (
                  <li key={b.barangay} className="flex justify-between text-sm">
                    <span className="text-clay-ink/80">{b.barangay}</span>
                    <span className="font-semibold text-sky-700">{b.count}</span>
                  </li>
                ))}
                {dashboard.topBarangays.length === 0 && <li className="text-xs text-clay-ink/50">No data</li>}
              </ul>
            </div>
            <div className="clay-raised rounded-2xl p-4">
              <p className="text-sm font-semibold text-clay-ink mb-3">Top customers</p>
              <ul className="space-y-1.5">
                {dashboard.topCustomers.map((c) => (
                  <li key={c.phone_display} className="flex justify-between text-sm">
                    <span className="text-clay-ink/80 truncate mr-2">{c.customer_name}</span>
                    <span className="font-semibold text-sky-700 whitespace-nowrap">₱{c.total_spent.toLocaleString()}</span>
                  </li>
                ))}
                {dashboard.topCustomers.length === 0 && <li className="text-xs text-clay-ink/50">No data</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
