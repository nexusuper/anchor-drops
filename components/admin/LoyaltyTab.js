import { useState, useEffect, useRef } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { ORDER_STATUS_BADGE } from '@/lib/order-status';

// Order-count loyalty tracker: 10 orders (any channel, incl. walk-ins) = 1
// voucher. Separate from the gallon-based checkout vouchers shown in the
// Customers tab — see pages/api/loyalty and 0037_loyalty_milestone_redemptions.sql.
export default function LoyaltyTab({ savedPassword, onError }) {
  const [customers, setCustomers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null);
  const [redeeming, setRedeeming] = useState(false);
  const searchTimer = useRef(null);

  async function fetchList(p, overrides) {
    setLoading(true);
    const s = overrides?.search ?? search;
    const target = p || page;
    const params = new URLSearchParams({ page: target });
    if (s) params.set('search', s);
    try {
      const res = await fetch(`/api/loyalty?${params}`, { headers: { password: savedPassword } });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setPage(data.page);
      }
    } catch (e) {
      console.error('Failed to fetch loyalty list:', e);
    }
    setLoading(false);
  }

  async function fetchDetail(phone) {
    try {
      const res = await fetch(`/api/loyalty/${phone}`, { headers: { password: savedPassword } });
      if (res.ok) setDetail(await res.json());
    } catch (e) {
      console.error('Failed to fetch loyalty detail:', e);
    }
  }

  async function redeem(phone) {
    if (!window.confirm('Redeem 1 voucher for this customer? This cannot be undone.')) return;
    setRedeeming(true);
    try {
      const res = await fetch(`/api/loyalty/${phone}/redeem`, {
        method: 'POST',
        headers: { password: savedPassword },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Redeem failed');
      await fetchList(page);
      if (detail?.phone_normalized === phone) await fetchDetail(phone);
    } catch (e) {
      onError?.(e.message || 'Failed to redeem voucher');
    }
    setRedeeming(false);
  }

  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchList(1, { search: val }); }, 400);
  }

  useEffect(() => {
    queueMicrotask(() => fetchList(1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search by name or phone..."
          className="clay-input flex-1"
        />
      </div>

      <div className="clay-raised rounded-3xl overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-clay-muted">Loading...</div>
        ) : customers.length === 0 ? (
          <div className="text-center py-12 text-clay-muted">No customers found</div>
        ) : (
          <>
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
              <span className="text-xs text-clay-muted">Showing {customers.length} of {total} customers (page {page})</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Phone</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Orders</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Total Spent</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Until Next Voucher</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Unredeemed</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted">Redeemed</th>
                    <th className="text-left px-4 py-3 font-semibold text-clay-muted"></th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c, i) => (
                    <tr
                      key={c.phone_normalized}
                      onClick={() => fetchDetail(c.phone_normalized)}
                      className={'cursor-pointer hover:bg-sky-50 transition-colors ' + (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                    >
                      <td className="px-4 py-3 font-medium text-clay-ink">{c.customer_name}</td>
                      <td className="px-4 py-3 text-clay-muted text-xs font-mono">{c.phone_normalized}</td>
                      <td className="px-4 py-3 font-bold text-sky-600">{c.total_orders}</td>
                      <td className="px-4 py-3 font-bold text-sky-600">{'₱'}{c.total_spent}</td>
                      <td className="px-4 py-3 text-clay-muted">{c.orders_until_next_voucher}</td>
                      <td className="px-4 py-3">
                        {c.vouchers_unredeemed > 0 ? (
                          <span className="text-[10px] font-bold bg-emerald-500 text-white rounded-full px-2 py-0.5">{c.vouchers_unredeemed}</span>
                        ) : (
                          <span className="text-clay-muted">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-clay-muted">{c.vouchers_redeemed}</td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => redeem(c.phone_normalized)}
                          disabled={c.vouchers_unredeemed <= 0 || redeeming}
                          className="clay-btn-primary text-xs px-3 py-1.5 rounded-full disabled:opacity-40 whitespace-nowrap"
                        >
                          Redeem
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={() => fetchList(page - 1)} disabled={page <= 1} className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors">← Prev</button>
          <span className="text-sm text-clay-muted px-3">Page {page} of {totalPages}</span>
          <button onClick={() => fetchList(page + 1)} disabled={page >= totalPages} className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors">Next →</button>
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${detail.customer_name} loyalty detail`}>
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-xl bg-clay-bg overflow-y-auto shadow-2xl">
            <div className="sticky top-0 z-10 text-white px-6 py-4" style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setDetail(null)} aria-label="Close loyalty details" className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition-colors">
                  <ClayIcon name="arrow-left" className="w-4 h-4" />
                </button>
                <div className="flex-1">
                  <h2 className="text-lg font-bold">{detail.customer_name}</h2>
                  <p className="text-sky-200 text-sm">{detail.phone_normalized}</p>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="clay-raised-sm rounded-2xl p-3 text-center">
                  <div className="text-xl font-bold text-sky-700">{detail.total_orders}</div>
                  <div className="text-xs text-clay-muted">Total Orders</div>
                </div>
                <div className="clay-raised-sm rounded-2xl p-3 text-center">
                  <div className="text-xl font-bold text-emerald-600">{detail.vouchers_unredeemed}</div>
                  <div className="text-xs text-clay-muted">Unredeemed</div>
                </div>
                <div className="clay-raised-sm rounded-2xl p-3 text-center">
                  <div className="text-xl font-bold text-clay-ink">{detail.vouchers_redeemed}</div>
                  <div className="text-xs text-clay-muted">Redeemed</div>
                </div>
              </div>

              <button
                onClick={() => redeem(detail.phone_normalized)}
                disabled={detail.vouchers_unredeemed <= 0 || redeeming}
                className="w-full clay-btn-primary clay-pressable rounded-full py-2 text-sm font-semibold disabled:opacity-40"
              >
                {redeeming ? 'Redeeming...' : `Redeem Voucher (${detail.vouchers_unredeemed} available)`}
              </button>

              <div className="clay-raised-sm rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-clay-ink mb-3">
                  <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Redemption History
                </h3>
                {detail.redemptions.length > 0 ? (
                  <div className="space-y-2">
                    {detail.redemptions.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-xs clay-inset rounded-lg px-3 py-2">
                        <span className="font-semibold text-clay-ink">Voucher #{r.milestone_number}</span>
                        <span className="text-clay-muted">{r.redeemed_by}</span>
                        <span className="text-clay-muted">{new Date(r.redeemed_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-clay-muted text-center py-2">No redemptions yet</p>
                )}
              </div>

              <div className="clay-raised-sm rounded-2xl p-4">
                <h3 className="text-sm font-semibold text-clay-ink mb-3">
                  <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Order History ({detail.orders.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-gray-100">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-clay-muted text-xs">Date</th>
                        <th className="text-left px-3 py-2 font-semibold text-clay-muted text-xs">Product</th>
                        <th className="text-left px-3 py-2 font-semibold text-clay-muted text-xs">Total</th>
                        <th className="text-left px-3 py-2 font-semibold text-clay-muted text-xs">Channel</th>
                        <th className="text-left px-3 py-2 font-semibold text-clay-muted text-xs">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.orders.map((o) => (
                        <tr key={o.id} className="border-b border-gray-50">
                          <td className="px-3 py-2 text-clay-muted text-xs whitespace-nowrap">
                            {new Date(o.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                          </td>
                          <td className="px-3 py-2 text-clay-ink text-xs">{o.product_type} x{o.quantity}</td>
                          <td className="px-3 py-2 font-bold text-sky-600 text-xs">{'₱'}{o.total_amount}</td>
                          <td className="px-3 py-2 text-xs text-clay-muted">{o.sale_channel || 'web'}</td>
                          <td className="px-3 py-2">
                            <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ' + (ORDER_STATUS_BADGE[o.status] || '')}>{o.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
