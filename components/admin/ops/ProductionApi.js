// Plain data-layer functions mirroring anchor-drops-system/src/api/production.ts
// (machines, production_logs, quality_tests, maintenance_logs). No TanStack Query
// here — web pages call these from useState/useEffect and roll their own loading
// state. RLS scopes every read/write; no manual branch_id filter is added.

import { MAINTENANCE_TASKS } from '@/lib/maintenance';

export async function fetchMachines(supabase) {
  const { data, error } = await supabase.from('machines').select('*').order('name');
  if (error) throw error;
  return data;
}

export async function createMachine(supabase, machine) {
  const { data, error } = await supabase.from('machines').insert(machine).select().single();
  if (error) throw error;
  return data;
}

// "Delete" is a soft delete: status → 'retired'. A hard DELETE is owner-only
// (machines_del) and is refused by the maintenance_logs / production_logs FKs
// as soon as the machine has any history. fetchMachines() still returns retired
// machines so old logs keep their machine name — pages that list or pick
// machines filter them out; notify-maintenance-due already skips them.
export async function retireMachine(supabase, id) {
  // .single(): an update RLS filters out touches zero rows without erroring —
  // surface that instead of reporting a delete that didn't happen.
  const { error } = await supabase.from('machines').update({ status: 'retired' }).eq('id', id).select('id').single();
  if (error) throw error;
}

// Recurring maintenance schedules (anchor-drops-system migration 0052). Next due
// is derived, never stored — see lib/maintenance.js.
export async function fetchMaintenanceSchedules(supabase) {
  const { data, error } = await supabase
    .from('maintenance_schedules')
    .select('*')
    .eq('is_active', true)
    .order('created_at');
  if (error) throw error;
  return data;
}

// Creates the guide's five default schedules for a machine, or — because it's an
// upsert on (machine_id, task_key) — resets an existing machine's intervals to
// the chosen production tier's preset. One call covers both.
export async function applySchedulePreset(supabase, machine, tier) {
  const rows = MAINTENANCE_TASKS.map((task) => ({
    // The machine's branch, not the caller's: an owner can act on any branch,
    // and the insert policy requires schedule and machine branches to match.
    branch_id: machine.branch_id,
    machine_id: machine.id,
    task_key: task.key,
    name: task.name,
    interval_days: task.days[tier],
  }));
  const { error } = await supabase.from('maintenance_schedules').upsert(rows, { onConflict: 'machine_id,task_key' });
  if (error) throw error;
}

export async function updateScheduleInterval(supabase, id, intervalDays) {
  const { error } = await supabase.from('maintenance_schedules').update({ interval_days: intervalDays }).eq('id', id);
  if (error) throw error;
}

// Correct when a task was last serviced: move its latest linked log to the
// given date, or — if it was never logged — create the first one.
// ponytail: only the latest log moves. If an older log is newer than the date
// chosen, that older log becomes "last done" instead. Fixing that needs a
// delete, which is owner-only (maint_del) — add an owner path if it bites.
export async function setLastServiceDate(supabase, schedule, lastLogId, performedAt) {
  // .single(): an update RLS filters out touches zero rows without erroring.
  const { error } = lastLogId
    ? await supabase.from('maintenance_logs').update({ performed_at: performedAt }).eq('id', lastLogId).select('id').single()
    : await supabase
        .from('maintenance_logs')
        .insert({
          branch_id: schedule.branch_id,
          machine_id: schedule.machine_id,
          schedule_id: schedule.id,
          description: schedule.name,
          performed_at: performedAt,
        })
        .select('id')
        .single();
  if (error) throw error;
}

export async function fetchProductionLogs(supabase, { machineId } = {}) {
  let query = supabase.from('production_logs').select('*').order('produced_at', { ascending: false });
  if (machineId) query = query.eq('machine_id', machineId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createProductionLog(supabase, log) {
  const { data, error } = await supabase.from('production_logs').insert(log).select().single();
  if (error) throw error;
  return data;
}

export async function fetchQualityTests(supabase, { productionLogId } = {}) {
  let query = supabase.from('quality_tests').select('*').order('tested_at', { ascending: false });
  if (productionLogId) query = query.eq('production_log_id', productionLogId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createQualityTest(supabase, test) {
  const { data, error } = await supabase.from('quality_tests').insert(test).select().single();
  if (error) throw error;
  return data;
}

export async function fetchMaintenanceLogs(supabase, { machineId } = {}) {
  let query = supabase.from('maintenance_logs').select('*').order('performed_at', { ascending: false });
  if (machineId) query = query.eq('machine_id', machineId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createMaintenanceLog(supabase, log) {
  const { data, error } = await supabase.from('maintenance_logs').insert(log).select().single();
  if (error) throw error;
  return data;
}

// Next 14 days, including already-overdue rows.
const UPCOMING_MAINTENANCE_WINDOW_DAYS = 14;

export async function fetchUpcomingMaintenance(supabase) {
  const horizon = new Date(Date.now() + UPCOMING_MAINTENANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('maintenance_logs')
    .select('*')
    .not('next_due', 'is', null)
    .lte('next_due', horizon.toISOString().slice(0, 10))
    .order('next_due', { ascending: true });
  if (error) throw error;
  return data;
}
