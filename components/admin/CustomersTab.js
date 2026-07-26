import { useState, useEffect, useRef } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { SEGMENT_DEFS } from '@/lib/segments';

export default function CustomersTab({ savedPassword, onError, onCountChange }) {
  const [customers, setCustomers] = useState([]);
  const [custPage, setCustPage] = useState(1);
  const [custTotalPages, setCustTotalPages] = useState(1);
  const [custSearch, setCustSearch] = useState('');
  const [custSort, setCustSort] = useState('last_order_desc');
  const [custStats, setCustStats] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [custLoading, setCustLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [newTags, setNewTags] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [newLogSummary, setNewLogSummary] = useState('');
  const [newLogChannel, setNewLogChannel] = useState('manual');
  const [savingLog, setSavingLog] = useState(false);
  const [custSegment, setCustSegment] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [custTagFilter, setCustTagFilter] = useState('');
  const [exporting, setExporting] = useState(false);
  const [quickMessage, setQuickMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageResult, setMessageResult] = useState(null);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const [containerQty, setContainerQty] = useState(1);
  const [containerReason, setContainerReason] = useState('');
  const [savingContainer, setSavingContainer] = useState(false);
  const [reorders, setReorders] = useState(null);
  const [nudging, setNudging] = useState(null);
  const [showReorders, setShowReorders] = useState(false);
  const [custTotal, setCustTotal] = useState(0);
  const [selected, setSelected] = useState([]);
  const [deletingCust, setDeletingCust] = useState(false);

  function toggleSelect(phone) {
    setSelected((s) => (s.includes(phone) ? s.filter((p) => p !== phone) : [...s, phone]));
  }
  function toggleSelectAllOnPage() {
    const pagePhones = customers.map((c) => c.phone_normalized);
    const allSel = pagePhones.length > 0 && pagePhones.every((p) => selected.includes(p));
    setSelected((s) => (allSel ? s.filter((p) => !pagePhones.includes(p)) : [...new Set([...s, ...pagePhones])]));
  }
  async function deleteSelected() {
    if (selected.length === 0) return;
    const ok = window.confirm(
      `Delete ${selected.length} customer(s)?\n\nThis PERMANENTLY removes them AND all their orders, notes, and history. This cannot be undone.`
    );
    if (!ok) return;
    setDeletingCust(true);
    try {
      const res = await fetch('/api/customers/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ phones: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setSelected([]);
      await fetchCustomers(1);
      fetchCustStats();
    } catch (e) {
      onError?.(e.message || 'Failed to delete customers');
    }
    setDeletingCust(false);
  }

  async function fetchCustomers(p, overrides) {
    setCustLoading(true);
    const s = overrides?.search ?? custSearch;
    const sort = overrides?.sort ?? custSort;
    const target = p || custPage;
    const params = new URLSearchParams({ page: target, limit: 50, sort });
    if (s) params.set('search', s);
    const seg = overrides?.segment ?? custSegment;
    if (seg) params.set('segment', seg);
    const tag = overrides?.tag ?? custTagFilter;
    if (tag) params.set('tag', tag);
    try {
      const res = await fetch(`/api/customers?${params}`, { headers: { password: savedPassword } });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setSelected([]);
        setCustTotal(data.total);
        onCountChange?.(data.total);
        setCustTotalPages(data.totalPages);
        setCustPage(data.page);
      }
    } catch (e) {
      console.error('Failed to fetch customers:', e);
    }
    setCustLoading(false);
  }

  async function fetchCustStats() {
    try {
      const res = await fetch('/api/customers/stats', { headers: { password: savedPassword } });
      if (res.ok) setCustStats(await res.json());
    } catch (e) {
      console.error('Failed to fetch customer stats:', e);
    }
  }

  async function fetchReorders() {
    try {
      const res = await fetch('/api/customers/reorders', { headers: { password: savedPassword } });
      if (res.ok) setReorders(await res.json());
    } catch (e) {
      console.error('Failed to fetch reorders:', e);
    }
  }

  async function nudgeReorder(c) {
    setNudging(c.phone_normalized);
    try {
      const msg = `Hi ${c.customer_name}! 💧 It's been a while since your last Anchor Drops water delivery. Ready for a refill? Reply here to place your order!`;
      const res = await fetch(`/api/customers/${c.phone_normalized}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) {
        setMessageResult({ ok: true, text: `Nudged ${c.customer_name}` });
      } else {
        setMessageResult({ ok: false, text: 'Failed to send nudge' });
      }
    } catch (e) {
      setMessageResult({ ok: false, text: 'Failed to send nudge' });
    } finally {
      setNudging(null);
    }
  }

  async function adjustContainers(sign) {
    if (!selectedCustomer || !containerQty) return;
    setSavingContainer(true);
    try {
      await fetch(`/api/customers/${selectedCustomer.phone_normalized}/container-adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ delta: sign * Math.abs(containerQty), reason: containerReason }),
      });
      setContainerReason('');
      setContainerQty(1);
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
    } catch (e) {
      console.error('Failed to adjust containers:', e);
    }
    setSavingContainer(false);
  }

  async function fetchCustomerDetail(phone) {
    setNewNote('');
    setNewTags('');
    setNewLogSummary('');
    setNewLogChannel('manual');
    setQuickMessage('');
    setMessageResult(null);
    setShowTagInput(false);
    setTagInputValue('');
    setContainerQty(1);
    setContainerReason('');
    try {
      const res = await fetch(`/api/customers/${phone}`, { headers: { password: savedPassword } });
      if (res.ok) setSelectedCustomer(await res.json());
    } catch (e) {
      console.error('Failed to fetch customer detail:', e);
    }
  }

  async function saveNote() {
    if (!newNote.trim() || !selectedCustomer) return;
    setSavingNote(true);
    try {
      await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ content: newNote, tags: newTags }),
      });
      setNewNote('');
      setNewTags('');
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
      fetchCustomers();
    } catch (e) {
      console.error('Failed to save note:', e);
    }
    setSavingNote(false);
  }

  async function deleteNote(noteId) {
    if (!selectedCustomer) return;
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    try {
      await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes/${noteId}`, {
        method: 'DELETE',
        headers: { password: savedPassword },
      });
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
      fetchCustomers();
    } catch (e) {
      console.error('Failed to delete note:', e);
    }
  }

  async function saveContactLog() {
    if (!newLogSummary.trim() || !selectedCustomer) return;
    setSavingLog(true);
    try {
      await fetch(`/api/customers/${selectedCustomer.phone_normalized}/contact-log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ channel: newLogChannel, direction: 'outbound', summary: newLogSummary }),
      });
      setNewLogSummary('');
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
    } catch (e) {
      console.error('Failed to save contact log:', e);
    }
    setSavingLog(false);
  }

  const custSearchTimer = useRef(null);
  function handleCustSearchChange(val) {
    setCustSearch(val);
    clearTimeout(custSearchTimer.current);
    custSearchTimer.current = setTimeout(() => { setCustPage(1); fetchCustomers(1, { search: val }); }, 400);
  }

  async function fetchAllTags() {
    try {
      const res = await fetch('/api/customers/tags', { headers: { password: savedPassword } });
      if (res.ok) {
        const data = await res.json();
        setAllTags(data.tags || []);
      }
    } catch (e) {
      console.error('Failed to fetch tags:', e);
    }
  }

  async function exportCSV() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ sort: custSort });
      if (custSearch) params.set('search', custSearch);
      if (custTagFilter) params.set('tag', custTagFilter);
      if (custSegment) params.set('segment', custSegment);
      const res = await fetch(`/api/customers/export?${params}`, { headers: { password: savedPassword } });
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const headers = ['Name', 'Phone', 'Total Orders', 'Total Spent', 'First Order', 'Last Order', 'Segment', 'Tags'];
      const csvRows = [headers.join(',')];
      for (const c of data.customers) {
        const row = [
          `"${(c.customer_name || '').replace(/"/g, '""')}"`,
          c.phone_normalized,
          c.total_orders,
          c.total_spent,
          c.first_order || '',
          c.last_order || '',
          c.segment || '',
          `"${(c.tags || '').replace(/"/g, '""')}"`,
        ];
        csvRows.push(row.join(','));
      }
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `anchor-drops-customers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
    setExporting(false);
  }

  async function sendQuickMessage() {
    if (!quickMessage.trim() || !selectedCustomer) return;
    setSendingMessage(true);
    setMessageResult(null);
    try {
      const res = await fetch(`/api/customers/${selectedCustomer.phone_normalized}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ message: quickMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessageResult({ success: true });
        setQuickMessage('');
        await fetchCustomerDetail(selectedCustomer.phone_normalized);
      } else {
        setMessageResult({ error: data.error || 'Failed to send' });
      }
    } catch (e) {
      setMessageResult({ error: 'Network error' });
    }
    setSendingMessage(false);
  }

  async function addTagToCustomer(tag) {
    if (!tag.trim() || !selectedCustomer) return;
    const existingTags = (selectedCustomer.notes || []).flatMap((n) =>
      typeof n.tags === 'string' ? n.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
    );
    if (existingTags.includes(tag.trim())) return;
    try {
      await fetch(`/api/customers/${selectedCustomer.phone_normalized}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', password: savedPassword },
        body: JSON.stringify({ content: `Tag added: ${tag.trim()}`, tags: tag.trim() }),
      });
      setTagInputValue('');
      setShowTagInput(false);
      await fetchCustomerDetail(selectedCustomer.phone_normalized);
      fetchCustomers();
      fetchAllTags();
    } catch (e) {
      console.error('Failed to add tag:', e);
    }
  }


  useEffect(() => {
    queueMicrotask(() => {
      fetchCustomers(1);
      fetchCustStats();
      fetchAllTags();
      fetchReorders();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>

          {/* Due for Reorder */}
          {reorders && reorders.count > 0 && (
            <div className="clay-raised rounded-2xl p-4 mb-4">
              <button
                onClick={() => setShowReorders((v) => !v)}
                className="w-full flex items-center justify-between"
              >
                <span className="text-sm font-semibold text-clay-ink">
                  🔔 Due for Reorder
                  <span className="ml-2 text-[10px] font-bold bg-amber-400 text-amber-900 rounded-full px-2 py-0.5">{reorders.count}</span>
                </span>
                <span className="text-xs text-clay-ink/50">{showReorders ? 'Hide' : 'Show'}</span>
              </button>
              {showReorders && (
                <ul className="mt-3 space-y-2">
                  {reorders.customers.map((c) => (
                    <li key={c.phone_normalized} className="flex items-center justify-between gap-2 clay-inset rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-clay-ink truncate">{c.customer_name}</p>
                        <p className="text-xs text-clay-ink/60">
                          {Math.round(c.daysOverdue)}d overdue · every ~{Math.round(c.avgIntervalDays)}d
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={'text-[10px] font-bold rounded-full px-2 py-0.5 ' + (c.status === 'overdue' ? 'bg-rose-500 text-white' : 'bg-amber-400 text-amber-900')}>
                          {c.status}
                        </span>
                        {c.has_messenger ? (
                          <button
                            onClick={() => nudgeReorder(c)}
                            disabled={nudging === c.phone_normalized}
                            className="clay-btn-primary text-xs px-3 py-1 rounded-full disabled:opacity-50"
                          >
                            {nudging === c.phone_normalized ? '…' : 'Nudge'}
                          </button>
                        ) : (
                          <a href={`tel:${c.phone_display}`} className="clay-btn-white text-xs px-3 py-1 rounded-full">Call</a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Customer Stats Dashboard */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="rounded-2xl p-4 text-center clay-raised-sm">
              <ClayIcon name="users" className="w-6 h-6 mx-auto mb-1 text-sky-600" />
              <div className="text-2xl font-bold text-sky-700">{custStats?.totalCustomers ?? '-'}</div>
              <div className="text-xs text-gray-500">Total Customers</div>
            </div>
            <div className="rounded-2xl p-4 text-center clay-raised-sm">
              <ClayIcon name="check" className="w-6 h-6 mx-auto mb-1 text-green-600" />
              <div className="text-2xl font-bold text-green-700">{custStats?.activeThisMonth ?? '-'}</div>
              <div className="text-xs text-gray-500">Active This Month</div>
            </div>
            <div className="rounded-2xl p-4 text-center clay-raised-sm">
              <ClayIcon name="star" className="w-6 h-6 mx-auto mb-1 text-amber-500" />
              <div className="text-2xl font-bold text-amber-600">{custStats?.newThisMonth ?? '-'}</div>
              <div className="text-xs text-gray-500">New This Month</div>
            </div>
            <div className="rounded-2xl p-4 text-center clay-raised-sm">
              <ClayIcon name="user" className="w-6 h-6 mx-auto mb-1 text-purple-600" />
              <div className="text-lg font-bold text-purple-700 truncate">{custStats?.topSpender?.name ?? '-'}</div>
              <div className="text-xs text-gray-500">Top Spender</div>
            </div>
          </div>

          {/* Segment Filter */}
          {custStats?.segmentCounts && (
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => { setCustSegment(''); fetchCustomers(1, { segment: '' }); }}
                className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (!custSegment ? 'bg-sky-600 text-white' : 'clay-raised-sm text-gray-600 hover:bg-sky-50')}
              >
                All ({custStats.totalCustomers})
              </button>
              {SEGMENT_DEFS.map((seg) => (
                <button
                  key={seg.value}
                  onClick={() => { setCustSegment(seg.value); fetchCustomers(1, { segment: seg.value }); }}
                  className={'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ' + (custSegment === seg.value ? seg.color + ' ring-2 ring-offset-1 ring-sky-400' : seg.color + ' opacity-70 hover:opacity-100')}
                >
                  {seg.label} ({custStats.segmentCounts[seg.value] || 0})
                </button>
              ))}
            </div>
          )}

          {/* Customer Search + Sort */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input
              type="text"
              value={custSearch}
              onChange={(e) => handleCustSearchChange(e.target.value)}
              placeholder="Search customers by name or phone..."
              className="clay-input flex-1"
            />
            {allTags.length > 0 && (
              <select
                value={custTagFilter}
                onChange={(e) => { setCustTagFilter(e.target.value); fetchCustomers(1, { tag: e.target.value }); setCustPage(1); }}
                className="clay-input"
              >
                <option value="">All Tags</option>
                {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
            <select
              value={custSort}
              onChange={(e) => { setCustSort(e.target.value); fetchCustomers(1, { sort: e.target.value }); setCustPage(1); }}
              className="clay-input"
            >
              <option value="last_order_desc">Last Order: Newest</option>
              <option value="last_order_asc">Last Order: Oldest</option>
              <option value="total_spent_desc">Spent: High to Low</option>
              <option value="total_spent_asc">Spent: Low to High</option>
              <option value="total_orders_desc">Orders: Most</option>
              <option value="total_orders_asc">Orders: Fewest</option>
              <option value="name_asc">Name: A to Z</option>
              <option value="name_desc">Name: Z to A</option>
            </select>
            <button
              onClick={exportCSV}
              disabled={exporting}
              className="clay-btn-white clay-pressable rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              <ClayIcon name="download" className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </button>
            {selected.length > 0 && (
              <button
                onClick={deleteSelected}
                disabled={deletingCust}
                className="clay-pressable rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50 flex items-center gap-1 whitespace-nowrap bg-red-500 text-white hover:bg-red-600"
              >
                <ClayIcon name="trash" className="w-4 h-4" />
                {deletingCust ? 'Deleting...' : `Delete Selected (${selected.length})`}
              </button>
            )}
          </div>

          {/* Customer Table */}
          <div className="clay-raised rounded-3xl overflow-hidden">
            {custLoading ? (
              <div className="text-center py-12 text-gray-400">Loading customers...</div>
            ) : customers.length === 0 ? (
              <div className="text-center py-12 text-gray-400">No customers found</div>
            ) : (
              <>
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs text-gray-400">Showing {customers.length} of {custTotal} customers (page {custPage})</span>
                </div>
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="px-4 py-3 w-10">
                          <input
                            type="checkbox"
                            aria-label="Select all on page"
                            className="w-4 h-4 cursor-pointer accent-sky-600"
                            checked={customers.length > 0 && customers.every((c) => selected.includes(c.phone_normalized))}
                            onChange={toggleSelectAllOnPage}
                          />
                        </th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Phone</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Orders</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Total Spent</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Last Order</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Tags</th>
                        <th className="text-left px-4 py-3 font-semibold text-gray-600">Segment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c, i) => (
                        <tr
                          key={c.phone_normalized}
                          onClick={() => fetchCustomerDetail(c.phone_normalized)}
                          className={'cursor-pointer hover:bg-sky-50 transition-colors ' + (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50')}
                        >
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${c.customer_name}`}
                              className="w-4 h-4 cursor-pointer accent-sky-600"
                              checked={selected.includes(c.phone_normalized)}
                              onChange={() => toggleSelect(c.phone_normalized)}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-800 flex items-center gap-1">
                              {c.customer_name}
                              {c.has_messenger && <ClayIcon name="chat" title="Messenger linked" className="w-4 h-4 inline text-blue-500" />}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs font-mono">{c.phone_display || c.phone_normalized}</td>
                          <td className="px-4 py-3 font-bold text-sky-600">{c.total_orders}</td>
                          <td className="px-4 py-3 font-bold text-sky-600">{'₱'}{c.total_spent}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {c.last_order ? new Date(c.last_order).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            {c.tags && c.tags.length > 0 && (() => {
                              const tagList = (typeof c.tags === 'string' ? c.tags.split(',').filter(Boolean) : c.tags);
                              return tagList.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {tagList.slice(0, 3).map((t) => (
                                    <span key={t} className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">{t.trim()}</span>
                                  ))}
                                  {tagList.length > 3 && <span className="text-[10px] text-gray-400">+{tagList.length - 3}</span>}
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {c.segment && (() => {
                              const def = SEGMENT_DEFS.find((s) => s.value === c.segment);
                              return def ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${def.color}`}>{def.label}</span> : null;
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="sm:hidden divide-y divide-gray-100">
                  {customers.map((c) => (
                    <div key={c.phone_normalized} className="p-4 flex items-start gap-3 hover:bg-sky-50">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.customer_name}`}
                        className="w-4 h-4 mt-1 cursor-pointer accent-sky-600 shrink-0"
                        checked={selected.includes(c.phone_normalized)}
                        onChange={() => toggleSelect(c.phone_normalized)}
                      />
                      <div onClick={() => fetchCustomerDetail(c.phone_normalized)} className="flex-1 space-y-1 cursor-pointer">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-800 flex items-center gap-1">
                          {c.customer_name}
                          {c.has_messenger && <ClayIcon name="chat" className="w-4 h-4 inline text-blue-500" />}
                        </span>
                        {c.segment && (() => {
                          const def = SEGMENT_DEFS.find((s) => s.value === c.segment);
                          return def ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${def.color}`}>{def.label}</span> : null;
                        })()}
                      </div>
                      <div className="text-xs text-gray-400 font-mono">{c.phone_display || c.phone_normalized}</div>
                      <div className="text-xs text-gray-600">{c.total_orders} orders · ₱{c.total_spent}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Customer Pagination */}
          {custTotalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button
                onClick={() => fetchCustomers(custPage - 1)}
                disabled={custPage <= 1}
                className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors"
              >
                ← Prev
              </button>
              <span className="text-sm text-gray-500 px-3">
                Page {custPage} of {custTotalPages}
              </span>
              <button
                onClick={() => fetchCustomers(custPage + 1)}
                disabled={custPage >= custTotalPages}
                className="px-4 py-2 rounded-full text-sm font-semibold clay-raised-sm disabled:opacity-40 hover:bg-sky-50 transition-colors"
              >
                Next →
              </button>
            </div>
          )}

          {/* ===== CUSTOMER DETAIL SLIDE-OUT ===== */}
          {selectedCustomer && (
            <div className="fixed inset-0 z-50 flex justify-end">
              <div className="absolute inset-0 bg-black/30" onClick={() => setSelectedCustomer(null)} />
              <div className="relative w-full max-w-xl bg-clay-bg overflow-y-auto shadow-2xl">
                {/* Detail Header */}
                <div className="sticky top-0 z-10 text-white px-6 py-4" style={{ background: 'linear-gradient(160deg,#38bdf8,#0284c7)' }}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedCustomer(null)} className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition-colors">
                      <ClayIcon name="arrow-left" className="w-4 h-4" />
                    </button>
                    <div className="flex-1">
                      <h2 className="text-lg font-bold flex items-center gap-2">
                        {selectedCustomer.customer_name}
                        {selectedCustomer.has_messenger && (
                          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">Messenger</span>
                        )}
                      </h2>
                      <p className="text-sky-200 text-sm">{selectedCustomer.phone_display || selectedCustomer.phone_normalized}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {selectedCustomer.segment && (() => {
                          const def = SEGMENT_DEFS.find((s) => s.value === selectedCustomer.segment);
                          return def ? <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${def.color}`}>{def.label}</span> : null;
                        })()}
                        {selectedCustomer.notes && selectedCustomer.notes.flatMap((n) =>
                          (typeof n.tags === 'string' ? n.tags.split(',').filter(Boolean) : [])
                        ).filter((v, i, a) => a.indexOf(v) === i).map((t) => (
                          <span key={t} className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full">{t.trim()}</span>
                        ))}
                        {!showTagInput ? (
                          <button onClick={() => setShowTagInput(true)} className="text-[10px] bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded-full transition-colors">
                            <ClayIcon name="plus" className="w-3 h-3 inline" /> Tag
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={tagInputValue}
                              onChange={(e) => setTagInputValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') addTagToCustomer(tagInputValue); if (e.key === 'Escape') { setShowTagInput(false); setTagInputValue(''); } }}
                              placeholder="Add tag..."
                              list="tag-suggestions"
                              className="text-xs bg-white/20 border-0 rounded-full px-2 py-0.5 text-white placeholder-white/50 outline-none w-24"
                              autoFocus
                            />
                            <datalist id="tag-suggestions">
                              {allTags.map((t) => <option key={t} value={t} />)}
                            </datalist>
                            <button onClick={() => { setShowTagInput(false); setTagInputValue(''); }} className="text-white/60 hover:text-white">
                              <ClayIcon name="close" className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Stats Cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="clay-raised-sm rounded-2xl p-3 text-center">
                      <div className="text-xl font-bold text-sky-700">{selectedCustomer.total_orders}</div>
                      <div className="text-xs text-gray-500">Total Orders</div>
                    </div>
                    <div className="clay-raised-sm rounded-2xl p-3 text-center">
                      <div className="text-xl font-bold text-sky-700">{'₱'}{selectedCustomer.total_spent}</div>
                      <div className="text-xs text-gray-500">Total Spent</div>
                    </div>
                    <div className="clay-raised-sm rounded-2xl p-3 text-center">
                      <div className="text-xl font-bold text-sky-700">
                        {selectedCustomer.total_orders > 0 ? `₱${Math.round(selectedCustomer.total_spent / selectedCustomer.total_orders)}` : '-'}
                      </div>
                      <div className="text-xs text-gray-500">Avg Order</div>
                    </div>
                    <div className="clay-raised-sm rounded-2xl p-3 text-center">
                      <div className="text-xl font-bold text-emerald-600">{selectedCustomer.loyalty?.available ?? 0}</div>
                      <div className="text-xs text-gray-500">Free Refills</div>
                    </div>
                  </div>

                  {/* Loyalty Progress */}
                  {selectedCustomer.loyalty && (
                    <div className="clay-raised-sm rounded-2xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-700">
                          <ClayIcon name="star" className="w-4 h-4 inline text-amber-500 mr-1" /> Loyalty Progress
                        </span>
                        <span className="text-xs text-gray-500">
                          {selectedCustomer.loyalty.deliveredGallons} gal delivered &middot; {selectedCustomer.loyalty.gallonsToNext} gal to next free refill
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2.5">
                        <div
                          className="bg-amber-500 h-2.5 rounded-full transition-all"
                          style={{ width: `${Math.min(100, selectedCustomer.loyalty.progressPct * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Customer Info */}
                  <div className="clay-raised-sm rounded-2xl p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      <ClayIcon name="info" className="w-4 h-4 inline mr-1" /> Customer Info
                    </h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-400">Phone:</span></div>
                      <div className="font-mono text-gray-700">{selectedCustomer.phone_display || selectedCustomer.phone_normalized}</div>
                      <div><span className="text-gray-400">First Order:</span></div>
                      <div className="text-gray-700">{selectedCustomer.first_order ? new Date(selectedCustomer.first_order).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</div>
                      <div><span className="text-gray-400">Last Order:</span></div>
                      <div className="text-gray-700">{selectedCustomer.last_order ? new Date(selectedCustomer.last_order).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}</div>
                      <div><span className="text-gray-400">Messenger:</span></div>
                      <div>{selectedCustomer.has_messenger ? <span className="text-blue-600 font-medium">Linked</span> : <span className="text-gray-400">Not linked</span>}</div>
                    </div>
                  </div>

                  {/* Containers Out */}
                  <div className="clay-raised-sm rounded-2xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">
                      <ClayIcon name="jug" className="w-4 h-4 inline mr-1" /> Containers Out
                    </h3>
                    <div className="text-3xl font-bold text-sky-700 mb-3">{selectedCustomer.containers_out ?? 0}</div>
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={containerQty}
                        onChange={(e) => setContainerQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="clay-input w-20 text-sm"
                      />
                      <input
                        type="text"
                        value={containerReason}
                        onChange={(e) => setContainerReason(e.target.value)}
                        placeholder="Reason (optional)"
                        className="clay-input flex-1 text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => adjustContainers(1)} disabled={savingContainer} className="flex-1 clay-btn-primary clay-pressable rounded-full py-1.5 text-sm font-semibold disabled:opacity-50">+ Give</button>
                      <button onClick={() => adjustContainers(-1)} disabled={savingContainer} className="flex-1 clay-btn-white clay-pressable rounded-full py-1.5 text-sm font-semibold disabled:opacity-50">− Collect</button>
                    </div>
                    {selectedCustomer.containerAdjustments && selectedCustomer.containerAdjustments.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {selectedCustomer.containerAdjustments.map((a) => (
                          <div key={a.id} className="flex items-center justify-between text-xs clay-inset rounded-lg px-2 py-1">
                            <span className={'font-semibold ' + (a.delta > 0 ? 'text-sky-600' : 'text-amber-600')}>{a.delta > 0 ? '+' : ''}{a.delta}</span>
                            <span className="text-gray-500 flex-1 px-2 truncate">{a.reason || '—'}</span>
                            <span className="text-gray-400">{new Date(a.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Notes Section */}
                  <div className="clay-raised-sm rounded-2xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                      <ClayIcon name="note" className="w-4 h-4 inline mr-1" /> Notes
                    </h3>
                    {/* Add Note Form */}
                    <div className="mb-3 space-y-2">
                      <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="Add a note..."
                        rows={2}
                        className="clay-input w-full text-sm"
                      />
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newTags}
                          onChange={(e) => setNewTags(e.target.value)}
                          placeholder="Tags (comma-separated)"
                          className="clay-input flex-1 text-sm"
                        />
                        <button
                          onClick={saveNote}
                          disabled={savingNote || !newNote.trim()}
                          className="clay-btn-primary clay-pressable rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
                        >
                          {savingNote ? 'Saving...' : 'Add'}
                        </button>
                      </div>
                    </div>
                    {/* Notes List */}
                    {selectedCustomer.notes && selectedCustomer.notes.length > 0 ? (
                      <div className="space-y-2">
                        {selectedCustomer.notes.map((n) => (
                          <div key={n.id} className="clay-inset rounded-xl p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="text-sm text-gray-700">{n.content}</p>
                                {n.tags && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {(typeof n.tags === 'string' ? n.tags.split(',').filter(Boolean) : n.tags).map((t) => (
                                      <span key={t} className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">{t.trim()}</span>
                                    ))}
                                  </div>
                                )}
                                <p className="text-[10px] text-gray-400 mt-1">
                                  {new Date(n.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                              </div>
                              <button onClick={() => deleteNote(n.id)} title="Delete note" className="text-red-400 hover:text-red-600 transition-colors p-1">
                                <ClayIcon name="trash" className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-2">No notes yet</p>
                    )}
                  </div>

                  {/* Contact Log */}
                  <div className="clay-raised-sm rounded-2xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                      <ClayIcon name="phone" className="w-4 h-4 inline mr-1" /> Contact Log
                    </h3>
                    {/* Add Log Entry */}
                    <div className="mb-3 space-y-2">
                      <div className="flex gap-2">
                        <select
                          value={newLogChannel}
                          onChange={(e) => setNewLogChannel(e.target.value)}
                          className="clay-input text-sm"
                        >
                          <option value="manual">Manual</option>
                          <option value="call">Call</option>
                          <option value="sms">SMS</option>
                          <option value="messenger">Messenger</option>
                          <option value="viber">Viber</option>
                          <option value="in-person">In Person</option>
                        </select>
                        <input
                          type="text"
                          value={newLogSummary}
                          onChange={(e) => setNewLogSummary(e.target.value)}
                          placeholder="Contact summary..."
                          className="clay-input flex-1 text-sm"
                        />
                        <button
                          onClick={saveContactLog}
                          disabled={savingLog || !newLogSummary.trim()}
                          className="clay-btn-primary clay-pressable rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
                        >
                          {savingLog ? '...' : 'Log'}
                        </button>
                      </div>
                    </div>
                    {/* Log Timeline */}
                    {selectedCustomer.contactLog && selectedCustomer.contactLog.length > 0 ? (
                      <div className="space-y-2">
                        {selectedCustomer.contactLog.map((log) => (
                          <div key={log.id} className="clay-inset rounded-xl p-3 flex items-start gap-3">
                            <div className="flex-shrink-0 mt-0.5">
                              <ClayIcon name={log.channel === 'messenger' ? 'chat' : log.channel === 'phone' ? 'phone' : 'note'} className="w-4 h-4 text-gray-400" />
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{log.channel}</span>
                                <span className="text-[10px] text-gray-400">{log.direction}</span>
                              </div>
                              <p className="text-sm text-gray-700 mt-0.5">{log.summary}</p>
                              <p className="text-[10px] text-gray-400 mt-1">
                                {new Date(log.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-2">No contact log entries</p>
                    )}
                  </div>

                  {/* Messenger Quick-Send */}
                  {selectedCustomer.has_messenger && (
                    <div className="clay-raised-sm rounded-2xl p-4">
                      <h3 className="text-sm font-semibold text-gray-700 mb-3">
                        <ClayIcon name="send" className="w-4 h-4 inline mr-1" /> Send Messenger Message
                      </h3>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={quickMessage}
                          onChange={(e) => setQuickMessage(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !sendingMessage) sendQuickMessage(); }}
                          placeholder="Type a message..."
                          className="clay-input flex-1 text-sm"
                        />
                        <button
                          onClick={sendQuickMessage}
                          disabled={sendingMessage || !quickMessage.trim()}
                          className="clay-btn-primary clay-pressable rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-50"
                        >
                          {sendingMessage ? '...' : 'Send'}
                        </button>
                      </div>
                      {messageResult && (
                        <div className={`mt-2 text-xs font-medium ${messageResult.success ? 'text-green-600' : 'text-red-500'}`}>
                          {messageResult.success ? 'Message sent!' : messageResult.error}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Order History */}
                  <div className="clay-raised-sm rounded-2xl p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">
                      <ClayIcon name="clipboard" className="w-4 h-4 inline mr-1" /> Order History
                    </h3>
                    {selectedCustomer.orders && selectedCustomer.orders.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="border-b border-gray-100">
                            <tr>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 text-xs">ID</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 text-xs">Date</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 text-xs">Items</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 text-xs">Total</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-500 text-xs">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedCustomer.orders.map((ord) => (
                              <tr key={ord.id} className="border-b border-gray-50">
                                <td className="px-3 py-2 font-mono text-sky-600 text-xs">{ord.id}</td>
                                <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                                  {new Date(ord.created_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                                </td>
                                <td className="px-3 py-2 text-gray-700 text-xs">{ord.product_type} x{ord.quantity}</td>
                                <td className="px-3 py-2 font-bold text-sky-600 text-xs">{'₱'}{ord.total_amount}</td>
                                <td className="px-3 py-2">
                                  <span className={'text-[10px] font-semibold px-2 py-0.5 rounded-full ' + (STATUS_COLORS[ord.status] || '')}>
                                    {ord.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 text-center py-2">No orders</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          </>
  );
}
