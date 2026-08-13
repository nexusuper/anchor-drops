import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import {
  fetchMachines,
  fetchProductionLogs,
  fetchQualityTests,
  fetchUpcomingMaintenance,
  createProductionLog,
  createQualityTest,
} from '@/components/admin/ops/ProductionApi';

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
  });
}

export default function ProductionPage() {
  const { branchId } = useOpsSession();
  const [machines, setMachines] = useState([]);
  const [logs, setLogs] = useState([]);
  const [qualityTests, setQualityTests] = useState([]);
  const [upcomingMaintenance, setUpcomingMaintenance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [machineId, setMachineId] = useState(null);
  const [batchRef, setBatchRef] = useState('');
  const [volume, setVolume] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [pendingLogId, setPendingLogId] = useState(null);
  const [ph, setPh] = useState('');
  const [tds, setTds] = useState('');
  const [chlorine, setChlorine] = useState('');
  const [turbidity, setTurbidity] = useState('');
  const [passed, setPassed] = useState(true);
  const [qtError, setQtError] = useState(null);
  const [qtSaving, setQtSaving] = useState(false);

  async function reload() {
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const [m, l, q, u] = await Promise.all([
        fetchMachines(supabase),
        fetchProductionLogs(supabase),
        fetchQualityTests(supabase),
        fetchUpcomingMaintenance(supabase),
      ]);
      setMachines(m);
      setLogs(l);
      setQualityTests(q);
      setUpcomingMaintenance(u);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { queueMicrotask(() => reload()); }, []);

  const machineName = useMemo(() => {
    const map = new Map(machines.map((m) => [m.id, m.name]));
    return (id) => (id ? map.get(id) ?? 'Unknown machine' : 'No machine');
  }, [machines]);

  const testByLogId = useMemo(() => {
    const map = new Map();
    for (const t of qualityTests) {
      if (t.production_log_id) map.set(t.production_log_id, t.passed);
    }
    return map;
  }, [qualityTests]);

  async function handleLogProduction() {
    setFormError(null);
    if (!branchId) {
      setFormError('No branch on this account — cannot log production.');
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabaseBrowser();
      const created = await createProductionLog(supabase, {
        branch_id: branchId,
        machine_id: machineId,
        batch_ref: batchRef.trim() || null,
        volume_liters: volume.trim() ? Number(volume) : null,
        notes: notes.trim() || null,
      });
      setPendingLogId(created.id);
      setBatchRef('');
      setVolume('');
      setNotes('');
      setMachineId(null);
      await reload();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogQualityTest() {
    setQtError(null);
    if (!branchId || !pendingLogId) return;
    setQtSaving(true);
    try {
      const supabase = getSupabaseBrowser();
      await createQualityTest(supabase, {
        branch_id: branchId,
        production_log_id: pendingLogId,
        ph: ph.trim() ? Number(ph) : null,
        tds: tds.trim() ? Number(tds) : null,
        chlorine: chlorine.trim() ? Number(chlorine) : null,
        turbidity: turbidity.trim() ? Number(turbidity) : null,
        passed,
      });
      setPendingLogId(null);
      setPh('');
      setTds('');
      setChlorine('');
      setTurbidity('');
      setPassed(true);
      await reload();
    } catch (e) {
      setQtError(e.message);
    } finally {
      setQtSaving(false);
    }
  }

  return (
    <OpsShell
      title="Production"
      allow={['owner', 'admin', 'staff']}
      actions={
        <Link
          href="/admin/ops/production/machines"
          className="flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-white/15 hover:bg-white/25"
        >
          <ClayIcon name="gear" className="w-3.5 h-3.5" />
          Machines
        </Link>
      }
    >
      <div className="space-y-4">
        {upcomingMaintenance.length > 0 && (
          <ClayCard variant="raisedSm" className="p-4 flex items-center gap-2 bg-amber-50">
            <ClayIcon name="alert" className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm font-semibold text-amber-800">
              {upcomingMaintenance.length} machine maintenance{upcomingMaintenance.length === 1 ? '' : 's'} due or overdue — see Machines.
            </p>
          </ClayCard>
        )}

        <ClayCard className="p-5 space-y-3">
          <h2 className="font-display font-bold text-lg text-clay-ink">Log Production</h2>

          <div>
            <label className="text-xs font-semibold text-gray-500">Date / Time</label>
            <p className="font-semibold text-clay-ink">{fmtDateTime(new Date().toISOString())}</p>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">Source</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {machines.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMachineId(machineId === m.id ? null : m.id)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold clay-pressable ${machineId === m.id ? 'clay-btn-primary' : 'bg-clay-surface clay-raised-sm text-clay-ink'}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">Total Produced (L)</label>
            <input
              type="number"
              step="any"
              placeholder="500"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">Batch Ref (optional)</label>
            <input
              type="text"
              placeholder="Batch ref"
              value={batchRef}
              onChange={(e) => setBatchRef(e.target.value)}
              className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500">Remarks</label>
            <textarea
              placeholder="Regular production run"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
            />
          </div>

          {formError && <p className="text-sm text-clay-danger">{formError}</p>}
          <ClayButton variant="primary" onClick={handleLogProduction} loading={saving} disabled={saving} className="w-full">
            Save Entry
          </ClayButton>
        </ClayCard>

        {pendingLogId && (
          <ClayCard className="p-5 space-y-3">
            <h2 className="font-display font-bold text-lg text-clay-ink">Water Quality Test</h2>
            {/* quality_tests stores one overall `passed` boolean, not a
                per-parameter status — same simplification as the app screen. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-500">pH</label>
                <input type="number" step="any" placeholder="7.0" value={ph} onChange={(e) => setPh(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">TDS (ppm)</label>
                <input type="number" step="any" placeholder="120" value={tds} onChange={(e) => setTds(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Chlorine (ppm)</label>
                <input type="number" step="any" placeholder="0.2" value={chlorine} onChange={(e) => setChlorine(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500">Turbidity (NTU)</label>
                <input type="number" step="any" placeholder="0.5" value={turbidity} onChange={(e) => setTurbidity(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500">Result</label>
              <div className="flex gap-2 mt-1">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    onClick={() => setPassed(v)}
                    className={`px-3 py-1.5 rounded-full text-sm font-semibold clay-pressable ${passed === v ? 'clay-btn-primary' : 'bg-clay-surface clay-raised-sm text-clay-ink'}`}
                  >
                    {v ? 'Pass' : 'Fail'}
                  </button>
                ))}
              </div>
            </div>

            {qtError && <p className="text-sm text-clay-danger">{qtError}</p>}
            <div className="flex gap-3">
              <ClayButton variant="primary" onClick={handleLogQualityTest} loading={qtSaving} disabled={qtSaving} className="flex-1">
                Save Test
              </ClayButton>
              <ClayButton variant="outline" onClick={() => setPendingLogId(null)} className="flex-1">
                Skip
              </ClayButton>
            </div>
          </ClayCard>
        )}

        {error && <p className="text-sm text-clay-danger">{error}</p>}

        <h2 className="font-display font-bold text-lg text-clay-ink">Recent Logs</h2>
        {loading ? (
          <p className="text-center py-10 text-gray-400">Loading…</p>
        ) : logs.length === 0 ? (
          <ClayCard className="p-8 text-center text-gray-400">No production logged yet</ClayCard>
        ) : (
          <div className="space-y-2">
            {logs.map((item) => {
              const result = testByLogId.get(item.id);
              return (
                <ClayCard key={item.id} variant="raisedSm" className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <p className="font-semibold text-clay-ink text-sm">
                      {fmtDate(item.produced_at)}
                      {item.volume_liters != null ? ` → ${item.volume_liters} L` : ''}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {machineName(item.machine_id)}
                      {item.batch_ref ? ` · ${item.batch_ref}` : ''}
                    </p>
                  </div>
                  {result !== undefined && (
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${result ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {result ? 'Pass' : 'Fail'}
                    </span>
                  )}
                </ClayCard>
              );
            })}
          </div>
        )}
      </div>
    </OpsShell>
  );
}
