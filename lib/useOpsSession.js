import { useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase-browser';

// Mirrors the Expo app's auth store (src/stores/auth.ts + src/api/auth.ts):
// a Supabase session plus the caller's own `profiles` row (role, branch_id).
// `loading` stays true until the boot-time session check has run, so route
// guards never redirect against stale null state.
export const ROLES = ['owner', 'admin', 'staff', 'driver'];

export function useOpsSession() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let cancelled = false;

    async function loadProfile(s) {
      if (!s?.user) {
        if (!cancelled) { setProfile(null); setSession(null); setLoading(false); }
        return;
      }
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, role, branch_id, full_name, avatar_url')
        .eq('id', s.user.id)
        .single();
      if (cancelled) return;
      setSession(s);
      if (err || !data) {
        // Authenticated but no profile row → no role, so RLS grants nothing.
        setProfile(null);
        setError('This account has no staff profile. Ask the owner to add you.');
      } else {
        setProfile(data);
        setError(null);
      }
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setLoading(true);
      loadProfile(s);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const signOut = useCallback(async () => {
    await getSupabaseBrowser().auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  return { loading, session, profile, role: profile?.role ?? null, branchId: profile?.branch_id ?? null, error, signOut };
}
