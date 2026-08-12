import { useCallback, useEffect, useMemo, useState } from 'react';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import { manilaToday, addDays } from '@/lib/scheduling';
import {
  fetchSalesReport,
  fetchDeliveryReport,
  fetchInventoryReport,
  fetchCustomerReport,
  fetchProductionReport,
} from '@/components/admin/ops/ReportsApi';
import { toCsv, toHtmlTable } from '@/lib/report-export';

// Web port of anchor-drops-system/app/(app)/reports.tsx. Same report builder
// + filters; export differs per WORK PACKAGE spec: CSV via Blob download
// (expo-file-system/sharing has no web equivalent), PDF via window.print()
// on a print-only table instead of expo-print/expo-sharing.
const REPORT_TYPES = ['sales', 'delivery', 'inventory', 'customer', 'production'];

const REPORT_LABELS = {
  sales: 'Sales Report',
  delivery: 'Delivery Report',
  inventory: 'Inventory Report',
  customer: 'Customer Report',
  production: 'Production Report',
};

const REPORT_ICONS = {
  sales: 'cash',
  delivery: 'truck',
  inventory: 'box',
  customer: 'users',
  production: 'drop',
};

function daysAgoStr(days) {
  return addDays(manilaToday(), -days);
}

function buildTable(reportType, data) {
  if (!data) return null;
  switch (reportType) {
    case 'sales': {
      const r = data;
      return {
        headers: ['Date', 'Orders', 'Total'],
        rows: [
          ...r.byDay.map((d) => [d.date, d.count, d.total.toFixed(2)]),
          ...r.byStatus.map((s) => [`Status: ${s.status}`, s.count, s.total.toFixed(2)]),
          ['TOTAL', r.totalCount, r.totalAmount.toFixed(2)],
        ],
      };
    }
    case 'delivery': {
      const r = data;
      return {
        headers: ['Driver', 'Deliveries', 'Avg hours'],
        rows: [
          ...r.byDriver.map((d) => [d.driverName, d.count, d.avgHours != null ? d.avgHours.toFixed(1) : '—']),
          ['TOTAL', r.totalCount, ''],
        ],
      };
    }
    case 'inventory': {
      const r = data;
      return {
        headers: ['Product', 'Stock', 'Low-stock at', 'Movement (30d)'],
        rows: r.stock.map((s) => {
          const movement = r.recentMovement
            .filter((m) => m.productId === s.productId)
            .map((m) => `${m.type}: ${m.totalDelta > 0 ? '+' : ''}${m.totalDelta}`)
            .join(', ');
          return [s.productId, s.currentStock, s.lowStockThreshold, movement || '—'];
        }),
      };
    }
    case 'customer': {
      const r = data;
      return {
        headers: ['Customer', 'Orders', 'Total'],
        rows: [
          ...r.topCustomers.map((c) => [c.name, c.orderCount, c.total.toFixed(2)]),
          ['New customers in range', r.newCustomersCount, ''],
        ],
      };
    }
    case 'production': {
      const r = data;
      return {
        headers: ['Metric', 'Value'],
        rows: [
          ['Total volume (L)', r.totalVolumeLiters.toFixed(1)],
          ['Batches', r.batchCount],
          ['Quality tests', r.qualityTotal],
          ['Passed', r.qualityPassed],
          ['Pass rate', r.passRate != null ? `${(r.passRate * 100).toFixed(1)}%` : '—'],
        ],
      };
    }
    default:
      return null;
  }
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { role } = useOpsSession();
  const isOwner = role === 'owner';

  const [reportType, setReportType] = useState('sales');
  const [from, setFrom] = useState(daysAgoStr(6));
  const [to, setTo] = useState(manilaToday());
  const [branchId, setBranchId] = useState(undefined);
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const dateRange = useMemo(() => ({ from, to }), [from, to]);
  const effectiveBranchId = isOwner ? branchId : undefined;

  // Owner-only branch picker. RLS already scopes rows for admin/staff.
  useEffect(() => {
    if (!isOwner) return;
    getSupabaseBrowser()
      .from('branches')
      .select('id, name')
      .order('name')
      .then(({ data }) => setBranches(data || []));
  }, [isOwner]);

  const load = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    setLoading(true);
    setError(null);
    try {
      let result;
      switch (reportType) {
        case 'sales':
          result = await fetchSalesReport(supabase, dateRange, effectiveBranchId);
          break;
        case 'delivery':
          result = await fetchDeliveryReport(supabase, dateRange, effectiveBranchId);
          break;
        case 'inventory':
          result = await fetchInventoryReport(supabase, effectiveBranchId);
          break;
        case 'customer':
          result = await fetchCustomerReport(supabase, dateRange, effectiveBranchId);
          break;
        case 'production':
          result = await fetchProductionReport(supabase, dateRange, effectiveBranchId);
          break;
        default:
          result = null;
      }
      setData(result);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [reportType, dateRange, effectiveBranchId]);

  useEffect(() => { queueMicrotask(() => load()); }, [load]);

  const table = useMemo(() => buildTable(reportType, data), [reportType, data]);

  function exportCsv() {
    if (!table) return;
    downloadCsv(`${reportType}-report-${Date.now()}.csv`, toCsv(table.headers, table.rows));
  }

  // Web equivalent of expo-print/expo-sharing: open the same HTML the app
  // would hand to Print.printToFileAsync in a new tab and trigger the
  // browser's print dialog (which offers "Save as PDF") on it.
  function exportPdf() {
    if (!table) return;
    const html = toHtmlTable(`${REPORT_LABELS[reportType]} (${from} to ${to})`, table.headers, table.rows);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <OpsShell title="Reports" allow={['owner', 'admin']}>
      <div className="space-y-5">
        <div>
          <h2 className="font-display font-semibold text-clay-ink mb-2">Report Type</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {REPORT_TYPES.map((rt) => {
              const selected = reportType === rt;
              return (
                <button
                  key={rt}
                  onClick={() => setReportType(rt)}
                  className={
                    'flex items-center gap-3 p-3 rounded-2xl text-left clay-pressable ' +
                    (selected ? 'clay-raised-sm ring-2 ring-clay-sky' : 'clay-raised-sm')
                  }
                >
                  <span className={'w-9 h-9 rounded-xl grid place-items-center ' + (selected ? 'bg-clay-skydeep text-white' : 'bg-clay-bg text-clay-skydeep')}>
                    <ClayIcon name={REPORT_ICONS[rt]} className="w-4 h-4" />
                  </span>
                  <span className={'font-semibold flex-1 ' + (selected ? 'text-clay-skydeep' : 'text-clay-ink')}>
                    {REPORT_LABELS[rt]}
                  </span>
                  {selected && <ClayIcon name="check" className="w-5 h-5 text-clay-skydeep" />}
                </button>
              );
            })}
          </div>
        </div>

        {reportType !== 'inventory' && (
          <div>
            <h2 className="font-display font-semibold text-clay-ink mb-2">Date Range</h2>
            <ClayCard className="p-3 flex items-center gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="clay-input flex-1" />
              <span className="text-clay-ink/40">–</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="clay-input flex-1" />
            </ClayCard>
          </div>
        )}

        {isOwner && (
          <div>
            <h2 className="font-display font-semibold text-clay-ink mb-2">Branch</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setBranchId(undefined)}
                className={'rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' + (!branchId ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')}
              >
                All Branches
              </button>
              {branches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setBranchId(b.id)}
                  className={'rounded-full px-4 py-1.5 text-sm font-semibold clay-pressable ' + (branchId === b.id ? 'clay-btn-primary' : 'bg-clay-surface text-clay-ink clay-raised-sm')}
                >
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <ClayButton variant="primary" disabled={!table} onClick={exportCsv} className="flex-1">
            <ClayIcon name="download" className="w-4 h-4" /> Generate CSV
          </ClayButton>
          <ClayButton variant="outline" disabled={!table} onClick={exportPdf} className="flex-1">
            <ClayIcon name="doc" className="w-4 h-4" /> Print / PDF
          </ClayButton>
        </div>

        {loading && <p className="text-sm text-clay-ink/50">Loading…</p>}
        {error && <p className="clay-raised-sm rounded-2xl p-3 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>}

        {table && (
          <ClayCard className="overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-clay-bg">
                  {table.headers.map((h) => (
                    <th key={h} className="text-left font-bold text-clay-ink px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr><td colSpan={table.headers.length} className="text-center text-clay-ink/40 py-6">No data for this range.</td></tr>
                ) : (
                  table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-clay-ink/10">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 text-clay-ink/70 whitespace-nowrap">{String(cell)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ClayCard>
        )}
      </div>
    </OpsShell>
  );
}
