// Plain data-layer functions mirroring anchor-drops-system/src/api/production.ts
// (machines, production_logs, quality_tests, maintenance_logs). No TanStack Query
// here — web pages call these from useState/useEffect and roll their own loading
// state. RLS scopes every read/write; no manual branch_id filter is added.

export async function fetchMachines(supabase) {
  const { data, error } = await supabase.from('machines').select('*').order('name');
  if (error) throw error;
  return data;
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
