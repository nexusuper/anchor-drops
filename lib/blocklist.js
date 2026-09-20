// Server-only. The blocklist lives in app_settings.blocked_phones as
// [{ phone, reason, at }] so it needs no schema change.
const KEY = 'blocked_phones';

export async function loadBlocklist(supabase) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) throw error;
  return Array.isArray(data?.value) ? data.value : [];
}

export async function saveBlocklist(supabase, list) {
  const { data, error } = await supabase
    .from('app_settings')
    .upsert({ key: KEY, value: list }, { onConflict: 'key' })
    .select('key');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Blocklist was not saved');
}

// Fail open, like the strike lookup: a settings outage must not stop real orders.
export async function loadBlocklistSafe(supabase) {
  try {
    return await loadBlocklist(supabase);
  } catch (err) {
    console.error('Blocklist lookup failed:', err);
    return [];
  }
}
