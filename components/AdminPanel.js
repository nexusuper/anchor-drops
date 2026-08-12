import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import ClayIcon from './ui/ClayIcon';
import POSPanel from './admin/POSPanel';
import ContainerPickupsPanel from './admin/ContainerPickupsPanel';
import DashboardTab from './admin/DashboardTab';
import CustomersTab from './admin/CustomersTab';
import RouteTab from './admin/RouteTab';
import InventoryTab from './admin/InventoryTab';
import ScreenshotsTab from './admin/ScreenshotsTab';
import ExpensesTab from './admin/ExpensesTab';
import Receipt, { orderToReceipt } from './admin/Receipt';
import { SEGMENT_DEFS } from '@/lib/segments';
import { apiFetch } from '@/lib/api-client';

const NOTIFIABLE_STATUSES = ['confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
const DELETABLE_STATUSES = ['delivered', 'cancelled'];

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-blue-100 text-blue-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};


const SORT_OPTIONS = [
  { value: 'date_desc', label: 'Newest first' },
  { value: 'date_asc', label: 'Oldest first' },
  { value: 'total_desc', label: 'Total: High → Low' },
  { value: 'total_asc', label: 'Total: Low → High' },
  { value: 'name_asc', label: 'Name: A → Z' },
  { value: 'name_desc', label: 'Name: Z → A' },
  { value: 'status_asc', label: 'Status' },
];


function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/orders', { headers: { password } });
    if (res.ok) {
      const data = await res.json();
      onLogin(password, data);
    } else {
      setError('Invalid password');
    }
    setLoading(false);
  }

  return (
    <>
      <Head><title>Admin — Anchor Drops</title></Head>
      <div className="min-h-screen bg-clay-bg flex items-center justify-center px-4">
        <div className="clay-raised rounded-3xl p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <ClayIcon name="lock" className="w-10 h-10 mx-auto mb-2 text-clay-sky" />
            <h1 className="text-2xl font-bold text-clay-ink font-display">Admin Panel</h1>
            <p className="text-gray-400 text-sm">Anchor Drops Order Management</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="clay-input"
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full clay-btn-primary clay-pressable rounded-full py-3 font-display font-semibold"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export default function AdminPanel() {
  const [authed, setAuthed] = useState(false);
  const [orders, setOrders] = useState([]);
  const [savedPassword, setSavedPassword] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date_desc');
  const [updating, setUpdating] = useState(null);
  const [notifyModal, setNotifyModal] = useState(null);
  const [notifying, setNotifying] = useState(null);
  const [messengerNotifying, setMessengerNotifying] = useState(null);
  const [messengerResult, setMessengerResult] = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [applyRewardModal, setApplyRewardModal] = useState(null);
  const [applyingReward, setApplyingReward] = useState(null);
  const [selected, setSelected] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteModal, setBulkDeleteModal] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [statusCounts, setStatusCounts] = useState({});
  const [newOrderCount, setNewOrderCount] = useState(0);
  const lastSeenOrderIdRef = useRef(null);
  const [adminError, setAdminError] = useState('');
  const [ordersLoading, setOrdersLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('orders');
  const [custTotal, setCustTotal] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);

  function applyPageData(data) {
    setOrders(data.orders);
    setTotalOrders(data.total);
    setTotalPages(data.totalPages);
    setPage(data.page);
    setStatusCounts(data.statusCounts || {});
    setSelected([]);
  }

  function handleLogin(password, data) {
    setSavedPassword(password);
    applyPageData(data);
    setOrdersLoading(false);
    setAuthed(true);
    // ponytail: sessionStorage — readable by JS but repo has no XSS sinks + strict CSP,
    // and it clears on tab close. Keeps the owner logged in across page refreshes.
    try { sessionStorage.setItem('cf_admin_pw', password); } catch { /* private mode */ }
  }

  function handleLogout() {
    try { sessionStorage.removeItem('cf_admin_pw'); } catch { /* ignore */ }
    setAuthed(false);
    setOrders([]);
    setSavedPassword('');
  }

  // Restore an existing session on refresh: re-validate the stored password against
  // the API; on success rehydrate, on any rejection drop the stale credential.
  useEffect(() => {
    let stored;
    try { stored = sessionStorage.getItem('cf_admin_pw'); } catch { stored = null; }
    if (!stored) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/orders?page=1&limit=50&sort=date_desc', { headers: { password: stored } });
        if (cancelled) return;
        if (res.ok) {
          handleLogin(stored, await res.json());
        } else {
          try { sessionStorage.removeItem('cf_admin_pw'); } catch { /* ignore */ }
        }
      } catch { /* offline — leave on login screen */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wraps a mutation so failures surface in the admin error banner
  // instead of silently refetching stale data.
  async function withErrorBanner(fn) {
    setAdminError('');
    try {
      await fn();
    } catch (e) {
      setAdminError(e.message || 'Something went wrong');
    }
  }

  async function fetchOrders(p, overrides) {
    const f = overrides?.filter ?? filter;
    const s = overrides?.search ?? search;
    const sort = overrides?.sortBy ?? sortBy;
    const target = p || page;
    const params = new URLSearchParams({ page: target, limit: 50, sort });
    if (f && f !== 'all') params.set('status', f);
    if (s) params.set('search', s);
    if (orders.length === 0) setOrdersLoading(true);
    const res = await fetch(`/api/orders?${params}`, { headers: { password: savedPassword } });
    if (res.ok) {
      const data = await res.json();
      if (data.orders.length === 0 && data.page > 1) {
        return fetchOrders(data.page - 1, overrides);
      }
      applyPageData(data);
    } else if (res.status === 401) {
      // Stored password no longer valid (changed/rotated) — drop to login.
      handleLogout();
    }
    setOrdersLoading(false);
  }

  // Poll callbacks capture a stale fetchOrders (with old filter/sort/page)
  // from the render the interval was created in; the ref always points at
  // the latest one so a new order doesn't reset the admin's view.
  const fetchOrdersRef = useRef(fetchOrders);
  useEffect(() => {
    fetchOrdersRef.current = fetchOrders;
  });

  function playNewOrderBeep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (e) {}
  }

  async function pollForNewOrders() {
    try {
      const res = await fetch('/api/orders?page=1&limit=1&sort=date_desc', { headers: { password: savedPassword } });
      if (!res.ok) return;
      const data = await res.json();
      const latest = data.orders?.[0];
      if (!latest) return;
      if (lastSeenOrderIdRef.current === null) {
        lastSeenOrderIdRef.current = latest.id;
        return;
      }
      if (latest.id !== lastSeenOrderIdRef.current) {
        lastSeenOrderIdRef.current = latest.id;
        setNewOrderCount((n) => n + 1);
        playNewOrderBeep();
        fetchOrdersRef.current();
      }
    } catch (e) {}
  }

  async function togglePaymentVerified(id, verified) {
    await withErrorBanner(async () => {
      await apiFetch('/api/orders/' + id, { method: 'PATCH', password: savedPassword, body: { payment_verified: verified } });
      await fetchOrders();
    });
  }

  async function updateStatus(id, status) {
    setUpdating(id);
    await withErrorBanner(async () => {
      await apiFetch('/api/orders/' + id, { method: 'PATCH', password: savedPassword, body: { status } });
      await fetchOrders();
    });
    setUpdating(null);
  }

  async function notifyCustomer(orderId, status) {
    setNotifying(orderId);
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', password: savedPassword },
      body: JSON.stringify({ orderId, status }),
    });
    setNotifyModal(await res.json());
    setNotifying(null);
  }

  async function notifyViaMessenger(orderId, status) {
    setMessengerNotifying(orderId);
    setMessengerResult(null);
    try {
      const res = await fetch('/api/messenger-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ orderId, status }),
      });
      const data = await res.json();
      setMessengerResult(data);
    } catch (e) {
      setMessengerResult({ error: 'Network error' });
    }
    setMessengerNotifying(null);
  }

  async function deleteOrder(id) {
    setDeleting(id);
    await withErrorBanner(async () => {
      await apiFetch('/api/orders/' + id, { method: 'DELETE', password: savedPassword });
      await fetchOrders();
    });
    setDeleting(null);
    setDeleteModal(null);
  }

  async function applyReward(id) {
    setApplyingReward(id);
    await withErrorBanner(async () => {
      await apiFetch('/api/orders/' + id + '/apply-reward', { method: 'POST', password: savedPassword, body: {} });
      await fetchOrders();
    });
    setApplyingReward(null);
    setApplyRewardModal(null);
  }

  async function bulkDelete() {
    setBulkDeleting(true);
    await withErrorBanner(async () => {
      await apiFetch('/api/orders/bulk-delete', { method: 'POST', password: savedPassword, body: { ids: selected } });
      await fetchOrders();
    });
    setBulkDeleting(false);
    setBulkDeleteModal(false);
  }

  const searchTimer = useRef(null);
  function handleSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => { setPage(1); fetchOrders(1, { search: val }); }, 400);
  }

  useEffect(() => {
    if (!authed || activeTab !== 'orders') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') pollForNewOrders();
    }, 25000);
    return () => clearInterval(timer);
  }, [authed, activeTab, savedPassword]);

  const deletableInView = orders.filter((o) => DELETABLE_STATUSES.includes(o.status));
  const allSelected = deletableInView.length > 0 && deletableInView.every((o) => selected.includes(o.id));

  function toggleSelectAll() {
    if (allSelected) {
      setSelected([]);
    } else {
      setSelected(deletableInView.map((o) => o.id));
    }
  }

  function toggleOne(id) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  if (!authed) return <LoginScreen onLogin={handleLogin} />;

  return (
    <>
      <Head><title>Admin — Anchor Drops</title></Head>

      {/* Delivery receipt — same slip POS prints. Rendered outside the admin
          shell (which is print-hidden while open) so the browser's own
          print-to-PDF gets the receipt alone. */}
      {printOrder && (
        <div className="fixed inset-0 z-[70] bg-black/40 overflow-y-auto px-4 py-8 print:static print:bg-white print:p-0">
          <div className="max-w-lg mx-auto">
            <Receipt receipt={orderToReceipt(printOrder)} />
            <div className="flex gap-3 mt-4 print:hidden">
              <button onClick={() => window.print()} className="flex-1 clay-btn-primary clay-pressable rounded-full py-3 font-display font-semibold">
                <ClayIcon name="download" className="w-4 h-4 inline mr-1" /> Print
              </button>
              <button onClick={() => setPrintOrder(null)} className="flex-1 clay-btn-white clay-pressable rounded-full py-3 font-display font-semibold text-clay-skydeep">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={'min-h-screen bg-clay-bg' + (printOrder ? ' print:hidden' : '')}>

        {/* Global error banner */}
        {adminError && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60]" role="alert">
            <div className="rounded-xl shadow-lg px-4 py-3 bg-red-500 text-white flex items-center gap-3 max-w-md">
              <span className="text-sm font-semibold">{adminError}</span>
              <button onClick={() => setAdminError('')} className="text-white/80 hover:text-white text-sm font-bold px-1">✕</button>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-white" style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}>
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold">Anchor Drops — Admin</h1>
              <p className="text-sky-200 text-sm">
                {activeTab === 'orders' ? `${totalOrders} total orders` : activeTab === 'customers' ? `${custTotal} customers` : activeTab === 'route' ? "Today's deliveries" : activeTab === 'inventory' ? 'Stock levels' : activeTab === 'pos' ? 'Quick order entry' : activeTab === 'screenshots' ? 'Payment screenshots' : 'Business overview'}
              </p>
            </div>
            <div className="flex gap-3">
              {activeTab === 'orders' && (
                <button onClick={() => fetchOrders()} className="bg-sky-500 hover:bg-sky-400 px-4 py-2 rounded-full text-sm font-medium transition-colors">
                  <ClayIcon name="refresh" className="w-4 h-4 inline" /> Refresh
                </button>
              )}
              <button
                onClick={handleLogout}
                className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full text-sm transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
          <div className="flex gap-1 px-6 pb-0 flex-wrap">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'dashboard' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="bolt" className="w-4 h-4 inline mr-1" /> Dashboard
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'orders' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Orders
            </button>
            <button
              onClick={() => setActiveTab('customers')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'customers' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="users" className="w-4 h-4 inline mr-1" /> Customers
            </button>
            <button
              onClick={() => setActiveTab('route')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'route' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="truck" className="w-4 h-4 inline mr-1" /> Route
            </button>
            <button
              onClick={() => setActiveTab('inventory')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors relative ' + (activeTab === 'inventory' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="jug" className="w-4 h-4 inline mr-1" /> Inventory
              {lowStockCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center text-[10px] font-bold bg-rose-500 text-white rounded-full w-4 h-4">{lowStockCount}</span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('pos')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'pos' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="cash" className="w-4 h-4 inline mr-1" /> POS
            </button>
            <button
              onClick={() => setActiveTab('pickups')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'pickups' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Pickups
            </button>
            <button
              onClick={() => setActiveTab('expenses')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'expenses' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="cash" className="w-4 h-4 inline mr-1" /> Expenses
            </button>
            <button
              onClick={() => setActiveTab('screenshots')}
              className={'px-5 py-2 rounded-t-xl text-sm font-semibold transition-colors ' + (activeTab === 'screenshots' ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')}
            >
              <ClayIcon name="card" className="w-4 h-4 inline mr-1" /> Payment Screenshots
            </button>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 py-6">

          {/* ===== DASHBOARD TAB ===== */}
          {activeTab === 'dashboard' && <DashboardTab savedPassword={savedPassword} />}

          {/* ===== ORDERS TAB ===== */}
          {activeTab === 'orders' && (<>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                onClick={() => { const next = filter === s.value ? 'all' : s.value; setFilter(next); setPage(1); fetchOrders(1, { filter: next }); }}
                className={'rounded-2xl p-3 text-center clay-raised-sm ' + (filter === s.value ? 'clay-tile-selected' : '')}
              >
                <div className="text-2xl font-bold text-sky-700">{statusCounts[s.value] || 0}</div>
                <div className="text-xs text-gray-500">{s.label}</div>
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by name, phone, or order ID..."
              className="clay-input flex-1"
            />
            <select
              value={sortBy}
              onChange={(e) => { setSortBy(e.target.value); fetchOrders(1, { sortBy: e.target.value }); setPage(1); }}
              className="clay-input"
            >
              {SORT_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Notify Modal */}
          {notifyModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
              <div className="clay-raised rounded-3xl p-6 max-w-md w-full">
                <h2 className="text-lg font-bold text-sky-800 mb-1"><ClayIcon name="clipboard" className="w-5 h-5 inline mr-1" /> Send Notification</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Copy and send to <strong>{notifyModal.phone}</strong> via SMS, Viber, or Messenger:
                </p>
                <div className="clay-inset rounded-xl p-4 text-sm text-gray-700 mb-4 leading-relaxed">
                  {notifyModal.message}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => navigator.clipboard.writeText(notifyModal.message)} className="flex-1 border border-sky-300 text-sky-600 font-semibold py-2 rounded-full hover:bg-sky-50 transition-colors text-sm">
                    Copy Message
                  </button>
                  <button onClick={() => setNotifyModal(null)} className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold py-2 rounded-full transition-colors text-sm">
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* New Order Alert */}
          {newOrderCount > 0 && (
            <div className="fixed top-4 right-4 z-50">
              <div className="rounded-xl shadow-lg p-4 max-w-sm bg-sky-500 text-white flex items-center gap-3">
                <ClayIcon name="bolt" className="w-5 h-5" />
                <span className="text-sm font-semibold">
                  {newOrderCount} new order{newOrderCount > 1 ? 's' : ''} came in
                </span>
                <button onClick={() => setNewOrderCount(0)} className="text-white/80 hover:text-white text-sm font-bold px-1">
                  ✕
                </button>
              </div>
            </div>
          )}

          {/* Messenger Result Toast */}
          {messengerResult && (
            <div className="fixed bottom-4 right-4 z-50">
              <div className={`rounded-xl shadow-lg p-4 max-w-sm ${messengerResult.success ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                <div className="flex items-center gap-2">
                  <span>{messengerResult.success ? <ClayIcon name="check" className="w-4 h-4" /> : <ClayIcon name="cancel" className="w-4 h-4" />}</span>
                  <span className="font-medium">
                    {messengerResult.success ? 'Messenger notification sent!' : messengerResult.message || messengerResult.error}
                  </span>
                  <button onClick={() => setMessengerResult(null)} className="ml-2 hover:opacity-70"><ClayIcon name="close" className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          )}

          {/* Bulk Delete Modal */}
          {bulkDeleteModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
              <div className="clay-raised rounded-3xl p-6 max-w-sm w-full">
                <ClayIcon name="trash" className="w-8 h-8 mx-auto mb-3 text-red-500" />
                <h2 className="text-lg font-bold text-gray-800 text-center mb-2">Delete {selected.length} orders?</h2>
                <p className="text-sm text-gray-500 text-center mb-2">All selected delivered & cancelled orders will be permanently removed.</p>
                <p className="text-xs text-red-400 text-center mb-5">This cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => setBulkDeleteModal(false)} className="flex-1 border border-gray-200 text-gray-600 font-semibold py-2 rounded-full hover:bg-gray-50 transition-colors">Cancel</button>
                  <button onClick={bulkDelete} disabled={bulkDeleting} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50">
                    {bulkDeleting ? 'Deleting...' : 'Delete ' + selected.length}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Single Delete Modal */}
          {deleteModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
              <div className="clay-raised rounded-3xl p-6 max-w-sm w-full">
                <ClayIcon name="trash" className="w-8 h-8 mx-auto mb-3 text-red-500" />
                <h2 className="text-lg font-bold text-gray-800 text-center mb-1">Delete Order?</h2>
                <p className="text-sm text-gray-500 text-center mb-1">Order <span className="font-mono font-bold text-sky-600">{deleteModal.id}</span></p>
                <p className="text-sm text-gray-500 text-center mb-4">{deleteModal.customer_name} — ₱{deleteModal.total_amount}</p>
                <p className="text-xs text-red-400 text-center mb-5">This cannot be undone.</p>
                <div className="flex gap-2">
                  <button onClick={() => setDeleteModal(null)} className="flex-1 border border-gray-200 text-gray-600 font-semibold py-2 rounded-full hover:bg-gray-50 transition-colors">Cancel</button>
                  <button onClick={() => deleteOrder(deleteModal.id)} disabled={deleting === deleteModal.id} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50">
                    {deleting === deleteModal.id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {applyRewardModal && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
                <h2 className="text-lg font-bold text-gray-800 text-center mb-1">Apply free refill reward?</h2>
                <p className="text-sm text-gray-500 text-center mb-1">Order <span className="font-mono font-bold text-sky-600">{applyRewardModal.id}</span></p>
                <p className="text-sm text-gray-500 text-center mb-4">{applyRewardModal.customer_name} requested {applyRewardModal.reward_requested} free refill(s) (−₱{applyRewardModal.reward_requested * 30}).</p>
                <p className="text-xs text-gray-400 text-center mb-5">Only apply after confirming this is the real customer.</p>
                <div className="flex gap-2">
                  <button onClick={() => setApplyRewardModal(null)} className="flex-1 border border-gray-200 text-gray-600 font-semibold py-2 rounded-full hover:bg-gray-50 transition-colors">Cancel</button>
                  <button onClick={() => applyReward(applyRewardModal.id)} disabled={applyingReward === applyRewardModal.id} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50">
                    {applyingReward === applyRewardModal.id ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Orders Table */}
          <div className="clay-raised rounded-3xl overflow-hidden">
            {ordersLoading && orders.length === 0 ? (
              <div className="text-center py-12 text-gray-400" aria-busy="true">
                <span className="clay-spinner inline-block align-middle mr-2" aria-hidden="true" /> Loading orders…
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No orders found</div>
            ) : (
              <>
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs text-gray-400">Showing {orders.length} of {totalOrders} orders (page {page})</span>
                  {selected.length > 0 && (
                    <button onClick={() => setBulkDeleteModal(true)} className="text-xs bg-red-500 hover:bg-red-600 text-white font-bold px-3 py-1 rounded-full transition-colors">
                      <ClayIcon name="trash" className="w-3.5 h-3.5 inline" /> Delete {selected.length} selected
                    </button>
                  )}
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3">
                          {deletableInView.length > 0 && (
                            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-4 h-4 accent-red-500 cursor-pointer" />
                          )}
                        </th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">ID</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Address</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Order</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Payment</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Total</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={o.id} className={(selected.includes(o.id) ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}>
                          <td className="px-4 py-3">
                            {DELETABLE_STATUSES.includes(o.status) && (
                              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleOne(o.id)} className="w-4 h-4 accent-red-500 cursor-pointer" />
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono font-bold text-sky-600">{o.id}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800 flex items-center gap-1">
                              {o.customer_name}
                              {o.messenger_psid && <ClayIcon name="chat" title="Messenger linked" className="w-4 h-4 inline text-blue-500" />}
                              {o.sale_channel === 'pos' && (
                                <span className="text-[10px] font-bold bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5">Counter Sale</span>
                              )}
                            </div>
                            <div className="text-gray-400 text-xs">{o.phone}</div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 max-w-[150px]">
                            <div className="truncate">{o.address}</div>
                            <div className="text-gray-400 text-xs">{o.barangay}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-gray-700">{o.product_type} x{o.quantity}</div>
                            {o.need_container ? <div className="text-gray-400 text-xs">+{o.container_quantity} container(s)</div> : null}
                          </td>
                          <td className="px-4 py-3">
                            <div className="uppercase text-xs font-semibold text-gray-600">{o.payment_method === 'bank_transfer' ? 'BANK TRANSFER' : o.payment_method}</div>
                            {o.reference_number && <div className="text-gray-400 text-xs">Ref: {o.reference_number}</div>}
                            {o.payment_screenshot_path && (
                              <a href={o.payment_screenshot_path} target="_blank" rel="noopener noreferrer" className="inline-block mt-1">
                                <img src={o.payment_screenshot_path} alt="Payment screenshot" className="w-10 h-10 object-cover rounded-lg border border-gray-200 hover:opacity-80" />
                              </a>
                            )}
                            {(o.payment_method === 'gcash' || o.payment_method === 'bank_transfer') && (
                              <label className="flex items-center gap-1 mt-1 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={!!o.payment_verified}
                                  onChange={(e) => togglePaymentVerified(o.id, e.target.checked)}
                                  className="w-3.5 h-3.5 accent-green-500"
                                />
                                <span className={'text-[10px] font-semibold ' + (o.payment_verified ? 'text-green-600' : 'text-amber-600')}>
                                  {o.payment_verified ? 'Verified' : 'Unverified'}
                                </span>
                              </label>
                            )}
                          </td>
                          <td className="px-4 py-3 font-bold text-sky-600">
                            ₱{o.total_amount}
                            {o.voucher_discount > 0 && (
                              <div className="text-[10px] font-semibold text-emerald-600">−₱{o.voucher_discount} reward</div>
                            )}
                            {o.reward_requested > 0 && (
                              <div className="text-[10px] font-semibold text-amber-600">wants {o.reward_requested} free refill{o.reward_requested > 1 ? 's' : ''}</div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {new Date(o.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {(o.delivery_slot || o.delivery_time) ? (
                              <div className="text-[10px] font-semibold text-sky-600">
                                {o.pickup_date ? `Pickup ${o.pickup_date} ${o.pickup_time || ''} · ` : ''}Delivery {o.delivery_date || ''} {o.delivery_time || ''}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <select
                              value={o.status}
                              disabled={updating === o.id}
                              onChange={(e) => updateStatus(o.id, e.target.value)}
                              className={'text-xs font-semibold px-2 py-1 rounded-full border-0 cursor-pointer ' + STATUS_COLORS[o.status]}
                            >
                              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            {o.sms_pending ? (
                              <div className="text-[10px] font-semibold text-amber-600 mt-1">SMS reminder pending</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              <a href={`tel:${o.phone}`} title="Call customer" className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-2 py-1 rounded-full transition-colors">
                                <ClayIcon name="phone" className="w-4 h-4" />
                              </a>
                              <button onClick={() => setPrintOrder(o)} title="Print receipt" className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-2 py-1 rounded-full transition-colors">
                                <ClayIcon name="download" className="w-4 h-4" />
                              </button>
                              {NOTIFIABLE_STATUSES.includes(o.status) && (
                                <>
                                  <button onClick={() => notifyCustomer(o.id, o.status)} disabled={notifying === o.id} title="Copy SMS message" className="text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                                    {notifying === o.id ? '...' : <ClayIcon name="mobile" className="w-4 h-4" />}
                                  </button>
                                  {o.messenger_psid && (
                                    <button onClick={() => notifyViaMessenger(o.id, o.status)} disabled={messengerNotifying === o.id} title="Send via Messenger" className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold px-2 py-1 rounded-full transition-colors disabled:opacity-50">
                                      {messengerNotifying === o.id ? '...' : <ClayIcon name="chat" className="w-4 h-4" />}
                                    </button>
                                  )}
                                </>
                              )}
                              {DELETABLE_STATUSES.includes(o.status) && (
                                <button onClick={() => setDeleteModal(o)} title="Delete order" className="text-xs bg-red-100 hover:bg-red-200 text-red-600 font-semibold px-2 py-1 rounded-full transition-colors">
                                  <ClayIcon name="trash" className="w-4 h-4" />
                                </button>
                              )}
                              {o.reward_requested > 0 && (
                                <button onClick={() => setApplyRewardModal(o)} title="Apply free refill reward" className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 font-semibold px-2 py-1 rounded-full transition-colors">
                                  Apply reward
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sm:hidden divide-y divide-gray-100">
                  {orders.map((o) => (
                    <div key={o.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sky-600">{o.id}</span>
                        <span className="font-bold text-sky-600">₱{o.total_amount}</span>
                      </div>
                      <div className="font-medium text-gray-800 flex items-center gap-1">
                        {o.customer_name}
                        {o.sale_channel === 'pos' && (
                          <span className="text-[10px] font-bold bg-purple-100 text-purple-700 rounded-full px-1.5 py-0.5">Counter Sale</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">{o.phone} · {o.barangay}</div>
                      <div className="text-sm text-gray-600">{o.product_type} x{o.quantity}</div>
                      <select
                        value={o.status}
                        disabled={updating === o.id}
                        onChange={(e) => updateStatus(o.id, e.target.value)}
                        className={'text-xs font-semibold px-2 py-1 rounded-full border-0 ' + STATUS_COLORS[o.status]}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      {o.sms_pending ? <div className="text-[10px] font-semibold text-amber-600">SMS reminder pending</div> : null}
                      <button onClick={() => setPrintOrder(o)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-3 py-1.5 rounded-full transition-colors">
                        <ClayIcon name="download" className="w-4 h-4 inline mr-1" /> Receipt
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => fetchOrders(page - 1)}
                disabled={page <= 1}
                className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors"
              >
                ← Prev
              </button>
              <span className="text-sm text-gray-500 px-3">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => fetchOrders(page + 1)}
                disabled={page >= totalPages}
                className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors"
              >
                Next →
              </button>
            </div>
          )}

          </>)}

          {/* ===== CUSTOMERS TAB ===== */}
          {activeTab === 'customers' && <CustomersTab savedPassword={savedPassword} onError={setAdminError} onCountChange={setCustTotal} />}

          {/* ===== ROUTE TAB ===== */}
          {activeTab === 'route' && <RouteTab savedPassword={savedPassword} onError={setAdminError} />}

          {/* ===== INVENTORY TAB ===== */}
          {activeTab === 'inventory' && <InventoryTab savedPassword={savedPassword} onLowStockCount={setLowStockCount} />}

          {/* ===== POS TAB ===== */}
          {activeTab === 'pos' && (
            <POSPanel savedPassword={savedPassword} onSaleComplete={() => { fetchOrders(); }} />
          )}

          {/* ===== PICKUPS TAB ===== */}
          {activeTab === 'pickups' && (
            <ContainerPickupsPanel savedPassword={savedPassword} />
          )}

          {/* ===== EXPENSES TAB ===== */}
          {activeTab === 'expenses' && <ExpensesTab savedPassword={savedPassword} onError={setAdminError} />}

          {/* ===== SCREENSHOTS TAB ===== */}
          {activeTab === 'screenshots' && <ScreenshotsTab savedPassword={savedPassword} onError={setAdminError} />}

        </div>
      </div>
    </>
  );
}
