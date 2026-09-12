import { useState, useEffect } from 'react';
import ClayIcon from '../ui/ClayIcon';

// Same pattern as RouteTab.js: single-stop Google Maps directions, origin = driver's phone location.
function navUrl(p) {
  const dest = [p.address, p.barangay, 'Cagayan de Oro'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS = {
  scheduled: 'bg-clay-warning-bg text-clay-warning',
  picked_up: 'bg-blue-100 text-blue-700',
  delivered: 'bg-clay-success-bg text-clay-success',
  cancelled: 'bg-clay-danger-bg text-clay-danger',
};

const DELETABLE_STATUSES = ['delivered', 'cancelled'];

const SORT_OPTIONS = [
  { value: 'pickup_date_asc', label: 'Pickup date (soonest first)' },
  { value: 'pickup_date_desc', label: 'Pickup date (latest first)' },
  { value: 'status_asc', label: 'Status' },
  { value: 'name_asc', label: 'Customer A–Z' },
  { value: 'name_desc', label: 'Customer Z–A' },
];

export default function ContainerPickupsPanel({ savedPassword }) {
  const [pickups, setPickups] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('pickup_date_asc');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [notifying, setNotifying] = useState(null);
  const [notifyModal, setNotifyModal] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);

  async function fetchPickups(overrides) {
    setLoading(true);
    const f = overrides?.filter ?? filter;
    const sort = overrides?.sortBy ?? sortBy;
    const params = new URLSearchParams({ sort });
    if (f && f !== 'all') params.set('status', f);
    const res = await fetch(`/api/container-pickups?${params}`, { headers: { password: savedPassword } });
    if (res.ok) {
      const data = await res.json();
      setPickups(data.pickups || []);
    }
    setLoading(false);
  }

  useEffect(() => { queueMicrotask(() => fetchPickups()); }, []);

  useEffect(() => {
    if (!notifyModal && !deleteModal) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') { setNotifyModal(null); setDeleteModal(null); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [notifyModal, deleteModal]);

  async function updateStatus(id, status) {
    setUpdating(id);
    await fetch('/api/container-pickups/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ status }),
    });
    await fetchPickups();
    setUpdating(null);
  }

  async function deletePickup(id) {
    setDeleting(id);
    await fetch('/api/container-pickups/' + id, { method: 'DELETE', headers: { password: savedPassword } });
    await fetchPickups();
    setDeleting(null);
    setDeleteModal(null);
  }

  async function notify(id, status, channel) {
    setNotifying(id + channel);
    const res = await fetch(`/api/container-pickups/${id}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ status, channel }),
    });
    const data = await res.json();
    if (channel === 'sms' && data.message) {
      setNotifyModal(data);
    } else if (data.error) {
      setNotifyModal({ error: data.error, message: data.message });
    }
    setNotifying(null);
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {['all', ...STATUS_OPTIONS.map((s) => s.value)].map((v) => (
          <button
            key={v}
            onClick={() => { setFilter(v); fetchPickups({ filter: v }); }}
            className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (filter === v ? 'bg-sky-500 text-white' : 'clay-raised-sm text-clay-muted hover:bg-sky-50')}
          >
            {v === 'all' ? 'All' : STATUS_OPTIONS.find((s) => s.value === v)?.label}
          </button>
        ))}
        <select
          value={sortBy}
          onChange={(e) => { setSortBy(e.target.value); fetchPickups({ sortBy: e.target.value }); }}
          className="clay-input ml-auto text-xs font-semibold w-auto py-1.5 px-3"
        >
          {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-clay-muted">Loading…</p>
      ) : pickups.length === 0 ? (
        <p className="text-sm text-clay-muted">No container pickups scheduled.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-clay-muted border-b">
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Qty</th>
                  <th className="py-2 pr-3">Pickup</th>
                  <th className="py-2 pr-3">Delivery</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3">
                      <div className="font-semibold text-clay-ink">{p.customer_name}</div>
                      <a href={`tel:${p.phone}`} className="text-xs text-sky-600">{p.phone}</a>
                    </td>
                    <td className="py-2 pr-3 text-xs text-clay-muted">
                      {p.address}, {p.barangay}
                      <a href={navUrl(p)} target="_blank" rel="noopener noreferrer" className="block text-sky-600 font-semibold mt-0.5">
                        <ClayIcon name="send" className="w-3 h-3 inline" /> Navigate
                      </a>
                    </td>
                    <td className="py-2 pr-3">{p.container_qty}</td>
                    <td className="py-2 pr-3 text-xs">{p.pickup_date} {p.pickup_time}</td>
                    <td className="py-2 pr-3 text-xs">{p.delivery_date} {p.delivery_time}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={p.status}
                        disabled={updating === p.id}
                        onChange={(e) => updateStatus(p.id, e.target.value)}
                        className={'text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ' + STATUS_COLORS[p.status]}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {p.status !== 'cancelled' && (
                          <>
                            <button onClick={() => notify(p.id, p.status, 'sms')} disabled={notifying === p.id + 'sms'} title="Copy SMS message" className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                              Copy SMS
                            </button>
                            {p.messenger_psid && (
                              <button onClick={() => notify(p.id, p.status, 'messenger')} disabled={notifying === p.id + 'messenger'} title="Send via Messenger" className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                                Messenger
                              </button>
                            )}
                          </>
                        )}
                        {DELETABLE_STATUSES.includes(p.status) && (
                          <button onClick={() => setDeleteModal(p)} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-2 py-1 rounded-full transition-colors">
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden space-y-3">
            {pickups.map((p) => (
              <div key={p.id} className="clay-raised-sm rounded-2xl p-4">
                <div className="flex justify-between items-start mb-1">
                  <div>
                    <div className="font-semibold text-clay-ink">{p.customer_name}</div>
                    <a href={`tel:${p.phone}`} className="text-xs text-sky-600">{p.phone}</a>
                  </div>
                  <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ' + STATUS_COLORS[p.status]}>
                    {STATUS_OPTIONS.find((s) => s.value === p.status)?.label}
                  </span>
                </div>
                <p className="text-xs text-clay-muted mb-1">{p.address}, {p.barangay}</p>
                <a href={navUrl(p)} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-600 font-semibold inline-flex items-center gap-1 mb-1">
                  <ClayIcon name="send" className="w-3.5 h-3.5" /> Navigate
                </a>
                <p className="text-xs text-clay-muted mb-1">Qty: {p.container_qty}</p>
                <p className="text-xs text-clay-muted mb-1">Pickup: {p.pickup_date} {p.pickup_time}</p>
                <p className="text-xs text-clay-muted mb-2">Delivery: {p.delivery_date} {p.delivery_time}</p>
                <select
                  value={p.status}
                  disabled={updating === p.id}
                  onChange={(e) => updateStatus(p.id, e.target.value)}
                  className={'text-xs font-semibold px-2 py-1 rounded-full border-0 mb-2 ' + STATUS_COLORS[p.status]}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <div className="flex flex-wrap gap-1">
                  {p.status !== 'cancelled' && (
                    <>
                      <button onClick={() => notify(p.id, p.status, 'sms')} disabled={notifying === p.id + 'sms'} className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                        Copy SMS
                      </button>
                      {p.messenger_psid && (
                        <button onClick={() => notify(p.id, p.status, 'messenger')} disabled={notifying === p.id + 'messenger'} className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                          Messenger
                        </button>
                      )}
                    </>
                  )}
                  {DELETABLE_STATUSES.includes(p.status) && (
                    <button onClick={() => setDeleteModal(p)} className="text-xs bg-red-100 hover:bg-red-200 text-red-700 font-semibold px-2 py-1 rounded-full transition-colors">
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {notifyModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" role="dialog" aria-modal="true" aria-label="Send Notification">
          <div className="clay-raised rounded-3xl p-6 max-w-md w-full">
            <h2 className="text-lg font-bold text-sky-800 mb-1"><ClayIcon name="clipboard" className="w-5 h-5 inline mr-1" /> Send Notification</h2>
            {notifyModal.error ? (
              <p className="text-sm text-red-600">{notifyModal.message || notifyModal.error}</p>
            ) : (
              <>
                <p className="text-sm text-clay-muted mb-3">Copy and send via SMS, Viber, or Messenger:</p>
                <div className="clay-inset rounded-xl p-4 text-sm text-clay-ink mb-4 leading-relaxed">{notifyModal.message}</div>
                <button onClick={() => navigator.clipboard.writeText(notifyModal.message)} className="w-full border border-sky-300 text-sky-600 font-semibold py-2 rounded-full hover:bg-sky-50 transition-colors text-sm mb-2">
                  Copy Message
                </button>
              </>
            )}
            <button onClick={() => setNotifyModal(null)} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-full transition-colors text-sm">
              Close
            </button>
          </div>
        </div>
      )}

      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" role="dialog" aria-modal="true" aria-label="Delete pickup record">
          <div className="clay-raised rounded-3xl p-6 max-w-sm w-full">
            <h2 className="text-lg font-bold text-red-700 mb-2">Delete pickup record?</h2>
            <p className="text-sm text-clay-muted mb-4">This removes the pickup record for {deleteModal.customer_name}. This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(null)} className="flex-1 border border-gray-300 text-clay-muted font-semibold py-2 rounded-full text-sm">Cancel</button>
              <button onClick={() => deletePickup(deleteModal.id)} disabled={deleting === deleteModal.id} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50 text-sm">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
