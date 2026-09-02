import { useState, useEffect, useCallback } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { apiFetch } from '@/lib/api-client';

export default function ScreenshotsTab({ savedPassword, onError }) {
  const [screenshots, setScreenshots] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  const fetchScreenshots = useCallback(async (targetPage) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/orders/screenshots?page=${targetPage}`, { password: savedPassword });
      setScreenshots(data.items || []);
      setTotalPages(data.totalPages || 1);
      setPage(targetPage);
    } catch (e) {
      console.error('Failed to fetch screenshots:', e);
    }
    setLoading(false);
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchScreenshots(1)); }, [fetchScreenshots]);

  function toggleSelectAll() {
    if (screenshots.length > 0 && screenshots.every((s) => selected.includes(s.id))) {
      setSelected([]);
    } else {
      setSelected(screenshots.map((s) => s.id));
    }
  }

  function toggleOne(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // The `download` attribute is ignored by browsers on cross-origin URLs (Supabase
  // signed URLs), which silently opened the image instead of saving it — fetch as a
  // blob so the save actually happens.
  async function downloadScreenshot(url, filename) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      onError?.('Failed to download screenshot');
    }
  }

  async function deleteScreenshots(ids) {
    setDeleting(true);
    try {
      await apiFetch('/api/orders/screenshots', { method: 'DELETE', password: savedPassword, body: { ids } });
      setSelected([]);
      await fetchScreenshots(page);
    } catch (e) {
      onError?.(e.message);
    }
    setDeleting(false);
    setDeleteModal(false);
  }

  return (
    <div className="space-y-4">
      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="clay-raised rounded-3xl p-6 max-w-sm w-full">
            <ClayIcon name="trash" className="w-8 h-8 mx-auto mb-3 text-red-500" />
            <h2 className="text-lg font-bold text-clay-ink text-center mb-2">
              Delete {selected.length} screenshot{selected.length > 1 ? 's' : ''}?
            </h2>
            <p className="text-sm text-clay-muted text-center mb-2">The order itself will be kept — only the attached image is removed.</p>
            <p className="text-xs text-red-400 text-center mb-5">This cannot be undone.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteModal(false)} className="flex-1 border border-gray-200 text-clay-muted font-semibold py-2 rounded-full hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={() => deleteScreenshots(selected)} disabled={deleting} className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-full transition-colors disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="clay-raised rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-clay-ink cursor-pointer">
          <input
            type="checkbox"
            checked={screenshots.length > 0 && screenshots.every((s) => selected.includes(s.id))}
            onChange={toggleSelectAll}
            className="w-4 h-4 accent-sky-500 cursor-pointer"
          />
          Select all on this page
        </label>
        {selected.length > 0 && (
          <button onClick={() => setDeleteModal(true)} className="text-xs bg-red-500 hover:bg-red-600 text-white font-bold px-3 py-1.5 rounded-full transition-colors">
            <ClayIcon name="trash" className="w-3.5 h-3.5 inline" /> Delete {selected.length} selected
          </button>
        )}
      </div>

      {loading && screenshots.length === 0 && (
        <p className="text-clay-ink/60 text-sm">Loading screenshots…</p>
      )}
      {!loading && screenshots.length === 0 && (
        <div className="clay-raised rounded-2xl p-12 text-center text-clay-muted">No payment screenshots yet</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {screenshots.map((s) => (
          <div key={s.id} className={`clay-raised rounded-2xl p-4 ${selected.includes(s.id) ? 'ring-2 ring-sky-400' : ''}`}>
            <div className="flex items-start justify-between mb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.includes(s.id)}
                  onChange={() => toggleOne(s.id)}
                  className="w-4 h-4 accent-sky-500 cursor-pointer"
                />
                <span className="font-mono font-bold text-sky-600 text-sm">{s.id}</span>
              </label>
              <span className="text-[10px] uppercase font-semibold text-clay-muted">{s.payment_method === 'bank_transfer' ? 'BANK TRANSFER' : s.payment_method}</span>
            </div>
            <a href={s.payment_screenshot_path} target="_blank" rel="noopener noreferrer">
              <img src={s.payment_screenshot_path} alt={`Payment screenshot for order ${s.id}`} className="w-full h-40 object-cover rounded-xl border border-gray-200 hover:opacity-90 mb-2" />
            </a>
            <div className="text-sm text-clay-ink font-medium">{s.customer_name}</div>
            <div className="text-xs text-clay-muted">{s.phone}</div>
            <div className="text-xs text-clay-muted mt-1">
              {new Date(s.created_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
            {s.reference_number && <div className="text-xs text-clay-muted">Ref: {s.reference_number}</div>}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => downloadScreenshot(s.payment_screenshot_path, `payment-${s.id}.jpg`)}
                className="flex-1 text-center text-xs bg-sky-100 hover:bg-sky-200 text-sky-700 font-semibold px-2 py-1.5 rounded-full transition-colors"
              >
                <ClayIcon name="download" className="w-3.5 h-3.5 inline mr-1" /> Download
              </button>
              <button
                onClick={() => { setSelected([s.id]); setDeleteModal(true); }}
                className="flex-1 text-center text-xs bg-clay-danger-bg hover:bg-red-200 text-clay-danger font-semibold px-2 py-1.5 rounded-full transition-colors"
              >
                <ClayIcon name="trash" className="w-3.5 h-3.5 inline mr-1" /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            disabled={page <= 1 || loading}
            onClick={() => fetchScreenshots(page - 1)}
            className="clay-btn-white text-sm px-4 py-2 rounded-full disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-clay-muted">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => fetchScreenshots(page + 1)}
            className="clay-btn-white text-sm px-4 py-2 rounded-full disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
