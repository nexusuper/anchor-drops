import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ClayCard from '@/components/ui/ClayCard';
import ClayButton from '@/components/ui/ClayButton';
import ClayIcon from '@/components/ui/ClayIcon';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { useOpsSession } from '@/lib/useOpsSession';

// Per-user sign-in for the ops console (/admin/ops/*), same accounts and roles
// as the Expo app (app/login.tsx). The legacy shared-password panel at /admin
// is untouched and still works.
export default function OpsLogin() {
  const router = useRouter();
  const { loading, session } = useOpsSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const next = typeof router.query.next === 'string' ? router.query.next : '/admin/ops';

  useEffect(() => {
    if (!loading && session) router.replace(next);
  }, [loading, session, next, router]);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await getSupabaseBrowser().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err) {
      // Supabase already returns a deliberately vague message; don't add detail.
      setError('Sign-in failed. Check your email and password.');
      setBusy(false);
      return;
    }
    router.replace(next);
  }

  return (
    <>
      <Head>
        <title>Staff Sign-in · Anchor Drops</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen flex items-center justify-center px-4 py-12">
        <ClayCard className="w-full max-w-sm p-7">
          <div className="flex items-center gap-2 mb-1 text-clay-ink">
            <ClayIcon name="lock" className="w-5 h-5" />
            <h1 className="font-display font-bold text-xl">Staff Sign-in</h1>
          </div>
          <p className="text-sm text-clay-muted mb-5">
            Ops console. Use the same account as the Anchor Drops System app.
          </p>
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold text-clay-ink2">Email</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full clay-inset rounded-2xl px-4 py-3 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-clay-ink2">Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full clay-inset rounded-2xl px-4 py-3 text-sm outline-none"
              />
            </label>
            {error && (
              <p className="text-sm text-clay-danger bg-clay-danger-bg rounded-xl px-3 py-2">{error}</p>
            )}
            <ClayButton type="submit" loading={busy} className="w-full">
              Sign in
            </ClayButton>
          </form>
        </ClayCard>
      </div>
    </>
  );
}
