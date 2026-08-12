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
export async function createEmployee(input) {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase.functions.invoke('manage-employee', { body: input });
  if (error) throw error;
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new Error(String(data.error));
  }
  return data;
}

// Plain RLS-covered update — profiles_upd already lets owner/admin flip
// is_active on a non-owner row in their branch. No Edge Function needed.
export async function deactivateEmployee(id) {
  const supabase = getSupabaseBrowser();
  const { data, error } = await supabase
    .from('profiles')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
