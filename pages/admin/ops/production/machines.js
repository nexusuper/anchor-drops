import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { fetchMachines, fetchMaintenanceLogs, createMaintenanceLog } from '@/components/admin/ops/ProductionApi';

const DUE_SOON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dueFlag(nextDue) {
  if (!nextDue) return null;
  const days = (new Date(nextDue).getTime() - Date.now()) / MS_PER_DAY;
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'soon';
  return null;
}

function dueBadge(due) {
  const flag = dueFlag(due);
  if (!due) return { label: 'Not Scheduled', className: 'bg-gray-100 text-gray-500' };
  if (flag === 'overdue') return { label: 'Overdue', className: 'bg-red-100 text-red-700' };
  if (flag === 'soon') return { label: 'Due Soon', className: 'bg-amber-100 text-amber-700' };
  return { label: 'Good', className: 'bg-green-100 text-green-700' };
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

export default function MachinesPage() {
  const router = useRouter();
  const { branchId } = useOpsSession();
  const [machines, setMachines] = useState([]);
  const [allMaintenance, setAllMaintenance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const [m, l] = await Promise.all([fetchMachines(supabase), fetchMaintenanceLogs(supabase)]);
      setMachines(m);
      setAllMaintenance(l);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { queueMicrotask(() => reload()); }, []);

  const nextDueByMachine = useMemo(() => {
    const map = new Map();
    for (const log of allMaintenance) {
      if (log.next_due && !map.has(log.machine_id)) map.set(log.machine_id, log.next_due);
    }
    return map;
  }, [allMaintenance]);

  const lastServiceByMachine = useMemo(() => {
    const map = new Map();
    for (const log of allMaintenance) {
      if (!map.has(log.machine_id)) map.set(log.machine_id, log.performed_at);
    }
    return map;
  }, [allMaintenance]);

  const historyForSelected = allMaintenance.filter((l) => l.machine_id === selectedId);

  async function handleLogMaintenance() {
    setFormError(null);
    if (!branchId || !selectedId) return;
    if (!description.trim()) {
      setFormError('Description is required.');
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabaseBrowser();
      await createMaintenanceLog(supabase, {
        branch_id: branchId,
        machine_id: selectedId,
        description: description.trim(),
        cost: cost.trim() ? Number(cost) : null,
        next_due: nextDue.trim() || null,
      });
      setDescription('');
      setCost('');
      setNextDue('');
      await reload();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OpsShell
      title="Machines"
      allow={['owner', 'admin', 'staff']}
      actions={
        <button
          onClick={() => router.push('/admin/ops/production')}
          className="flex items-center gap-1 text-xs font-semibold rounded-full px-3 py-1.5 bg-white/15 hover:bg-white/25"
        >
          <ClayIcon name="arrow-left" className="w-3.5 h-3.5" />
          Back
        </button>
      }
    >
      <div className="space-y-3">
        {error && <p className="text-sm text-clay-danger">{error}</p>}

        {loading ? (
          <p className="text-center py-10 text-gray-400">Loading…</p>
        ) : machines.length === 0 ? (
          <ClayCard className="p-8 text-center text-gray-400">No machines yet</ClayCard>
        ) : (
          machines.map((m) => {
            const due = nextDueByMachine.get(m.id) ?? null;
            const lastService = lastServiceByMachine.get(m.id) ?? null;
            const badge = dueBadge(due);
            const isSelected = selectedId === m.id;
            return (
              <div key={m.id} className="space-y-2">
                <ClayCard
                  variant="raisedSm"
                  className="p-4 flex items-center gap-3 cursor-pointer"
                  onClick={() => setSelectedId(isSelected ? null : m.id)}
                >
                  <div className="flex-1">
                    <p className="font-semibold text-clay-ink capitalize">{m.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 capitalize">
                      {lastService ? `Last service ${fmtDate(lastService)}` : m.type ?? 'Machine'}
                    </p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badge.className}`}>{badge.label}</span>
                </ClayCard>

                {isSelected && (
                  <ClayCard className="p-5 space-y-3">
                    <h3 className="font-display font-bold text-clay-ink">Maintenance History</h3>
                    {historyForSelected.length === 0 ? (
                      <p className="text-sm text-gray-400">No maintenance logged for this machine.</p>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {historyForSelected.map((log) => (
                          <div key={log.id} className="py-2">
                            <p className="text-sm text-clay-ink">{log.description}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {fmtDate(log.performed_at)}
                              {log.cost ? ` · ₱${Number(log.cost).toFixed(2)}` : ''}
                              {log.next_due ? ` · next due ${log.next_due}` : ''}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    <h3 className="font-display font-bold text-clay-ink mt-2">Log New Maintenance</h3>
                    <input
                      type="text"
                      placeholder="Description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        step="any"
                        placeholder="Cost (optional)"
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
                      />
                      <input
                        type="date"
                        placeholder="Next due"
                        value={nextDue}
                        onChange={(e) => setNextDue(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink"
                      />
                    </div>
                    {formError && <p className="text-sm text-clay-danger">{formError}</p>}
                    <ClayButton variant="primary" onClick={handleLogMaintenance} loading={saving} disabled={saving} className="w-full">
                      Log maintenance
                    </ClayButton>
                  </ClayCard>
                )}
              </div>
            );
          })
        )}
      </div>
    </OpsShell>
  );
}
