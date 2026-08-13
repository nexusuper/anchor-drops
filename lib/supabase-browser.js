import { createClient } from '@supabase/supabase-js';

// Browser-side client for the ops console (/admin/ops/*). Anon/publishable key
// only — Postgres RLS is the access boundary, exactly like the Expo app
// (../anchor-drops-system/src/api/supabase.ts). Never import lib/supabaseAdmin
// (service_role) from anything that reaches the browser.
let client;

export function getSupabaseBrowser() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Set them in .env.local and in the Vercel project env.'
    );
  }
  client = createClient(url, key, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  return client;
}
