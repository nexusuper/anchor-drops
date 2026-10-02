import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';
import OpsShell from '@/components/admin/OpsShell';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import {
  fetchMachines,
  fetchMaintenanceLogs,
  fetchMaintenanceSchedules,
  createMachine,
  createMaintenanceLog,
  applySchedulePreset,
  updateScheduleInterval,
  retireMachine,
} from '@/components/admin/ops/ProductionApi';
import {
  BACKWASH_GUIDE,
  DUE_STATUS_RANK,
  TIER_LABELS,
  computeTaskDue,
  dueLabel,
  latestBySchedule,
  manilaDateString,
  parseIntervalDays,
  performedAtFromDate,
} from '@/lib/maintenance';

const DUE_SOON_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 15;
const INPUT = 'w-full rounded-xl border border-gray-200 bg-clay-bg px-3 py-2.5 text-sm font-medium text-clay-ink';

function dueFlag(nextDue) {
  if (!nextDue) return null;
  const days = (new Date(nextDue).getTime() - Date.now()) / MS_PER_DAY;
  if (days < 0) return 'overdue';
  if (days <= DUE_SOON_DAYS) return 'soon';
  return null;
}

// Legacy badge for a machine with no recurring schedule: driven by the
// free-text logs' hand-entered next_due.
function dueBadge(due) {
  const flag = dueFlag(due);
  if (!due) return { label: 'Not Scheduled', className: 'bg-gray-100 text-gray-500' };
  if (flag === 'overdue') return { label: 'Overdue', className: 'bg-red-100 text-red-700' };
  if (flag === 'soon') return { label: 'Due Soon', className: 'bg-amber-100 text-amber-700' };
  return { label: 'Good', className: 'bg-green-100 text-green-700' };
}

const STATUS_CLASS = {
  overdue: 'bg-red-100 text-red-700',
  today: 'bg-amber-100 text-amber-700',
  soon: 'bg-sky-100 text-sky-700',
  good: 'bg-green-100 text-green-700',
};

const STATUS_LABEL = { overdue: 'Overdue', today: 'Due Today', soon: 'Due Soon', good: 'Good' };

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
}

// 'YYYY-MM-DD' (already a PHT calendar date) → 'Sep 29, 2026'. Anchored at noon
// PHT so the timezone-aware formatter can't slip it to the neighbouring day.
function fmtDay(date) {
  return fmtDate(`${date}T12:00:00+08:00`);
}

/** Recurring tasks for one machine: status, mark-done (backdatable), interval editing. */
function SchedulePanel({ machine, tasks, onChanged }) {
  const [active, setActive] = useState(null); // { id, mode: 'done' | 'interval' }
  const [date, setDate] = useState('');
  const [cost, setCost] = useState('');
  const [notes, setNotes] = useState('');
  const [interval, setIntervalText] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  function open(task, mode) {
    setFormError(null);
    if (active?.id === task.schedule.id && active.mode === mode) {
      setActive(null);
      return;
    }
    setActive({ id: task.schedule.id, mode });
    setDate(manilaDateString());
    setCost('');
    setNotes('');
    setIntervalText(String(task.schedule.interval_days));
  }

  async function run(fn) {
    setSaving(true);
    try {
      await fn(getSupabaseBrowser());
      setActive(null);
      await onChanged();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleMarkDone(task) {
    setFormError(null);
    const performedAt = performedAtFromDate(date);
    if (!performedAt) {
      setFormError('Pick the date it was done — today or earlier.');
      return;
    }
    const costValue = cost.trim() ? Number(cost) : null;
    if (costValue !== null && (!Number.isFinite(costValue) || costValue < 0)) {
      setFormError('Cost must be a number.');
      return;
    }
    run((supabase) =>
      createMaintenanceLog(supabase, {
        branch_id: machine.branch_id,
        machine_id: machine.id,
        schedule_id: task.schedule.id,
        description: notes.trim() ? `${task.schedule.name} — ${notes.trim()}` : task.schedule.name,
        cost: costValue,
        performed_at: performedAt,
      })
    );
  }

  function handleSaveInterval(task) {
    setFormError(null);
    const days = parseIntervalDays(interval);
    if (days === null) {
      setFormError('Enter a whole number of days (1–3650).');
      return;
    }
    run((supabase) => updateScheduleInterval(supabase, task.schedule.id, days));
  }

  function handlePreset(tier) {
    setFormError(null);
    if (
      tasks.length > 0 &&
      !confirm(`Use the ${TIER_LABELS[tier]} preset? This resets every interval for this machine to the monitoring guide defaults. Logged history is kept.`)
    ) return;
    run((supabase) => applySchedulePreset(supabase, machine, tier));
  }

  if (tasks.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="font-display font-bold text-clay-ink">Maintenance Schedule</h3>
        <p className="text-sm text-gray-500">
          No recurring schedule yet. Set one up to track backwashing, filter changes and tank cleaning.
        </p>
        {formError && <p className="text-sm text-clay-danger">{formError}</p>}
        <ClayButton variant="primary" onClick={() => handlePreset('standard')} loading={saving} disabled={saving} className="w-full">
          Set up maintenance schedule
        </ClayButton>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-display font-bold text-clay-ink">Maintenance Schedule</h3>
      <div className="divide-y divide-gray-200">
        {tasks.map((task) => {
          const { schedule, due } = task;
          const mode = active?.id === schedule.id ? active.mode : null;
          return (
            <div key={schedule.id} className="py-3 space-y-2">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-clay-ink">{schedule.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Every {schedule.interval_days} day{schedule.interval_days === 1 ? '' : 's'}
                    {due.lastDone
                      ? ` · last ${fmtDay(due.lastDone)} · next ${fmtDay(due.nextDue)}`
                      : ' · log when it was last done'}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_CLASS[due.status]}`}>
                  {dueLabel(due)}
                </span>
              </div>
              <div className="flex gap-2">
                <ClayButton variant="primary" size="sm" onClick={() => open(task, 'done')} className="flex-1">
                  Mark done
                </ClayButton>
                <ClayButton variant="outline" size="sm" onClick={() => open(task, 'interval')} className="flex-1">
                  Edit interval
                </ClayButton>
              </div>

              {mode === 'done' && (
                <div className="rounded-2xl bg-clay-bg p-4 space-y-3">
                  {schedule.task_key === 'backwash' && (
                    <div className="space-y-2">
                      <p role="alert" className="flex items-start gap-2 rounded-xl bg-clay-danger-bg p-3 text-sm font-bold text-clay-danger">
                        <ClayIcon name="alert" className="w-4 h-4 mt-0.5 shrink-0" />
                        {BACKWASH_GUIDE.warning}
                      </p>
                      {BACKWASH_GUIDE.sections.map((section) => (
                        <div key={section.title}>
                          <p className="text-sm font-semibold text-clay-ink">{section.title}</p>
                          <ol className="list-decimal pl-5 text-xs text-clay-ink2 space-y-0.5">
                            {section.steps.map((step) => <li key={step}>{step}</li>)}
                          </ol>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="block text-xs font-semibold text-clay-muted">
                    Date done
                    <input
                      type="date"
                      max={manilaDateString()}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className={`${INPUT} mt-1 bg-white`}
                    />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Cost (optional)"
                      aria-label="Cost (optional)"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className={`${INPUT} bg-white`}
                    />
                    <input
                      type="text"
                      maxLength={300}
                      placeholder="Notes (optional)"
                      aria-label="Notes (optional)"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className={`${INPUT} bg-white`}
                    />
                  </div>
                  {formError && <p className="text-sm text-clay-danger">{formError}</p>}
                  <ClayButton variant="primary" onClick={() => handleMarkDone(task)} loading={saving} disabled={saving} className="w-full">
                    Save
                  </ClayButton>
                </div>
              )}

              {mode === 'interval' && (
                <div className="rounded-2xl bg-clay-bg p-4 space-y-3">
                  <label className="block text-xs font-semibold text-clay-muted">
                    Repeat every (days)
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      step="1"
                      value={interval}
                      onChange={(e) => setIntervalText(e.target.value)}
                      className={`${INPUT} mt-1 bg-white`}
                    />
                  </label>
                  {formError && <p className="text-sm text-clay-danger">{formError}</p>}
                  <ClayButton variant="primary" onClick={() => handleSaveInterval(task)} loading={saving} disabled={saving} className="w-full">
                    Save interval
                  </ClayButton>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">Reset all intervals to the monitoring guide preset for your daily production:</p>
      {!active && formError && <p className="text-sm text-clay-danger">{formError}</p>}
      <div className="flex gap-2">
        {Object.keys(TIER_LABELS).map((tier) => (
          <ClayButton key={tier} variant="outline" size="sm" onClick={() => handlePreset(tier)} disabled={saving} className="flex-1">
            {TIER_LABELS[tier]}
          </ClayButton>
        ))}
      </div>
    </div>
  );
}

export default function MachinesPage() {
  const router = useRouter();
  const { branchId, role } = useOpsSession();
  // Cosmetic gate against a stray click; RLS (machines_upd) is the real boundary.
  const canDelete = role === 'owner' || role === 'admin';
  const [machines, setMachines] = useState([]);
  const [allMaintenance, setAllMaintenance] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [machineName, setMachineName] = useState('');
  const [machineError, setMachineError] = useState(null);
  const [addingMachine, setAddingMachine] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    setError(null);
    try {
      const supabase = getSupabaseBrowser();
      const [m, l, s] = await Promise.all([
        fetchMachines(supabase),
        fetchMaintenanceLogs(supabase),
        fetchMaintenanceSchedules(supabase),
      ]);
      // Deleted machines are soft-deleted (status 'retired') — hide them here.
      setMachines(m.filter((x) => x.status !== 'retired'));
      setAllMaintenance(l);
      setSchedules(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { queueMicrotask(() => reload()); }, []);

  // Recurring tasks per machine, most urgent first. Next due is derived from
  // the latest log linked to each schedule (lib/maintenance.js).
  const tasksByMachine = useMemo(() => {
    const latest = latestBySchedule(allMaintenance);
    const map = new Map();
    for (const schedule of schedules) {
      const due = computeTaskDue(latest.get(schedule.id) ?? null, schedule.interval_days);
      const list = map.get(schedule.machine_id) ?? [];
      list.push({ schedule, due });
      map.set(schedule.machine_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => DUE_STATUS_RANK[a.due.status] - DUE_STATUS_RANK[b.due.status] || a.due.daysUntil - b.due.daysUntil);
    }
    return map;
  }, [allMaintenance, schedules]);

  const dueNowCount = useMemo(() => {
    let n = 0;
    for (const m of machines) {
      n += (tasksByMachine.get(m.id) ?? []).filter((task) => task.due.status === 'overdue' || task.due.status === 'today').length;
    }
    return n;
  }, [machines, tasksByMachine]);

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

  async function handleAddMachine() {
    setMachineError(null);
    if (!branchId) return;
    if (!machineName.trim()) {
      setMachineError('Machine name is required.');
      return;
    }
    setAddingMachine(true);
    try {
      const supabase = getSupabaseBrowser();
      const machine = await createMachine(supabase, { branch_id: branchId, name: machineName.trim() });
      setMachineName('');
      setSelectedId(machine.id);
      // A new machine starts on the guide's 500 gal/day schedule; if this second
      // step fails the machine still exists and offers "Set up maintenance schedule".
      await applySchedulePreset(supabase, machine, 'standard');
    } catch (e) {
      setMachineError(e.message);
    } finally {
      setAddingMachine(false);
      await reload();
    }
  }

  async function handleDeleteMachine(machine) {
    if (!confirm(`Delete ${machine.name}? It disappears from this list and its reminders stop. Its maintenance and production history is kept.`)) return;
    setFormError(null);
    setDeleting(true);
    try {
      await retireMachine(getSupabaseBrowser(), machine.id);
      setSelectedId(null);
      await reload();
    } catch (e) {
      setFormError(e.message);
    } finally {
      setDeleting(false);
    }
  }

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

        {dueNowCount > 0 && (
          <p role="status" className="flex items-center gap-2 rounded-2xl bg-clay-danger-bg px-4 py-3 text-sm font-bold text-clay-danger">
            <ClayIcon name="alert" className="w-4 h-4 shrink-0" />
            {dueNowCount} maintenance task{dueNowCount === 1 ? '' : 's'} due or overdue
          </p>
        )}

        {loading ? (
          <p className="text-center py-10 text-gray-400">Loading…</p>
        ) : machines.length === 0 ? (
          <ClayCard className="p-8 text-center text-gray-400">No machines yet — add your refilling machine below.</ClayCard>
        ) : (
          machines.map((m) => {
            const tasks = tasksByMachine.get(m.id) ?? [];
            const lastService = lastServiceByMachine.get(m.id) ?? null;
            // Tasks are sorted most-urgent first, so the first one is the machine's status.
            const badge = tasks.length
              ? { label: STATUS_LABEL[tasks[0].due.status], className: STATUS_CLASS[tasks[0].due.status] }
              : dueBadge(nextDueByMachine.get(m.id) ?? null);
            const isSelected = selectedId === m.id;
            return (
              <div key={m.id} className="space-y-2">
                <ClayCard
                  as="button"
                  type="button"
                  aria-expanded={isSelected}
                  variant="raisedSm"
                  className="w-full text-left p-4 flex items-center gap-3 cursor-pointer"
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
                    <SchedulePanel machine={m} tasks={tasks} onChanged={reload} />

                    <h3 className="font-display font-bold text-clay-ink pt-2">Maintenance History</h3>
                    {historyForSelected.length === 0 ? (
                      <p className="text-sm text-gray-400">No maintenance logged for this machine.</p>
                    ) : (
                      <div className="divide-y divide-gray-200">
                        {historyForSelected.slice(0, HISTORY_LIMIT).map((log) => (
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
                    {historyForSelected.length > HISTORY_LIMIT && (
                      <p className="text-xs text-gray-500">+ {historyForSelected.length - HISTORY_LIMIT} older entries</p>
                    )}

                    <h3 className="font-display font-bold text-clay-ink mt-2">Log Other Maintenance</h3>
                    <input
                      type="text"
                      placeholder="Description (repair, part replaced…)"
                      aria-label="Description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className={INPUT}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        type="number"
                        step="any"
                        placeholder="Cost (optional)"
                        aria-label="Cost (optional)"
                        value={cost}
                        onChange={(e) => setCost(e.target.value)}
                        className={INPUT}
                      />
                      <input
                        type="date"
                        placeholder="Next due"
                        aria-label="Next due"
                        value={nextDue}
                        onChange={(e) => setNextDue(e.target.value)}
                        className={INPUT}
                      />
                    </div>
                    {formError && <p className="text-sm text-clay-danger">{formError}</p>}
                    <ClayButton variant="primary" onClick={handleLogMaintenance} loading={saving} disabled={saving} className="w-full">
                      Log maintenance
                    </ClayButton>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDeleteMachine(m)}
                        disabled={deleting}
                        className="w-full mt-3 rounded-full py-2.5 text-sm font-display font-semibold text-clay-danger ring-1 ring-clay-danger/40 hover:bg-clay-danger-bg disabled:opacity-60"
                      >
                        {deleting ? 'Deleting…' : 'Delete machine'}
                      </button>
                    )}
                  </ClayCard>
                )}
              </div>
            );
          })
        )}

        {!loading && (
          <ClayCard className="p-5 space-y-3">
            <h3 className="font-display font-bold text-clay-ink">Add Machine</h3>
            <input
              type="text"
              maxLength={80}
              placeholder="Machine name (e.g. RO purifier)"
              aria-label="Machine name"
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              className={INPUT}
            />
            {machineError && <p className="text-sm text-clay-danger">{machineError}</p>}
            <ClayButton variant="primary" onClick={handleAddMachine} loading={addingMachine} disabled={addingMachine} className="w-full">
              Add machine
            </ClayButton>
          </ClayCard>
        )}
      </div>
    </OpsShell>
  );
}
