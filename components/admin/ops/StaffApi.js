import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Web port of ../anchor-drops-system/src/api/employees.ts. Same RLS-scoped
// reads (0002_rls.sql profiles_sel / activity_sel) and same Edge Function for
// creation — owner/admin only, enforced both by OpsShell and by RLS/the
// function itself.

export async function fetchEmployees() {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.from('profiles').select('*').order('full_name');
  if (error) throw error;
  return data;
}

export async function fetchActivityLog() {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

// Creating an auth.users row needs the Admin API (service_role), which the
// browser never holds — routed through the deployed manage-employee Edge
// Function, which re-checks the caller's role server-side. invoke() forwards
// the caller's session as the Authorization bearer automatically.
async function invokeManageEmployee(body) {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.functions.invoke('manage-employee', { body });
  if (error) throw error;
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error));
  }
  return data;
}

export async function createEmployee(input) {
  return invokeManageEmployee({ ...input, action: 'create' });
}

// Not a plain `profiles` update: flipping is_active revokes authorization (0031
// makes app_role() ignore inactive rows) but leaves the login working. The Edge
// Function also bans the auth user, which needs the Admin API / service_role
// key the browser never holds.
export async function deactivateEmployee(id) {
  return invokeManageEmployee({ action: 'deactivate', id });
}

export async function reactivateEmployee(id) {
  return invokeManageEmployee({ action: 'reactivate', id });
}
