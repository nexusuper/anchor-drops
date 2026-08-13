import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { useOpsSession } from '@/lib/useOpsSession';

// Nav mirrors the Expo drawer/tabs (app/(app)/_layout.tsx): same screens, roles
// decide which items show. RLS remains the real access boundary — hiding a link
// is cosmetic.
const NAV = [
  { href: '/admin/ops', label: 'Overview', icon: 'chart', roles: ['owner', 'admin', 'staff', 'driver'] },
  { href: '/admin/ops/route', label: 'Route', icon: 'truck', roles: ['owner', 'admin', 'staff', 'driver'] },
  { href: '/admin/ops/review', label: 'Needs Review', icon: 'alert', roles: ['owner', 'admin', 'staff'] },
  { href: '/admin/ops/production', label: 'Production', icon: 'drop', roles: ['owner', 'admin', 'staff'] },
  { href: '/admin/ops/containers', label: 'Containers', icon: 'box', roles: ['owner', 'admin', 'staff'] },
  { href: '/admin/ops/finance', label: 'Finance', icon: 'peso', roles: ['owner', 'admin'] },
  { href: '/admin/ops/reports', label: 'Reports', icon: 'doc', roles: ['owner', 'admin'] },
  { href: '/admin/ops/employees', label: 'Employees', icon: 'users', roles: ['owner', 'admin'] },
  { href: '/admin/ops/history', label: 'My Activity', icon: 'clock', roles: ['owner', 'admin', 'staff', 'driver'] },
  { href: '/admin/ops/settings', label: 'Settings', icon: 'gear', roles: ['owner', 'admin'] },
  { href: '/admin/ops/profile', label: 'Profile', icon: 'user', roles: ['owner', 'admin', 'staff', 'driver'] },
];

/**
 * Guard + chrome for every /admin/ops/* page.
 * `allow` lists the roles permitted on this page (defaults to all four).
 * Children only render for a signed-in user whose role is allowed.
 */
export default function OpsShell({ title, subtitle, allow = ['owner', 'admin', 'staff', 'driver'], actions, children }) {
  const router = useRouter();
  const { loading, session, profile, role, error, signOut } = useOpsSession();

  useEffect(() => {
    if (!loading && !session) {
      router.replace(`/admin/login?next=${encodeURIComponent(router.asPath)}`);
    }
  }, [loading, session, router]);

  const denied = !loading && session && (!role || !allow.includes(role));

  return (
    <>
      <Head>
        <title>{title ? `${title} · Anchor Drops Ops` : 'Anchor Drops Ops'}</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div className="min-h-screen bg-clay-bg">
        <header className="bg-clay-ink text-white">
          <div className="max-w-6xl mx-auto px-4 pt-4 pb-2 flex items-center justify-between gap-3">
            <div>
              <div className="font-display font-bold text-lg leading-tight">{title || 'Ops'}</div>
              {subtitle && <div className="text-xs text-white/70">{subtitle}</div>}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              {session && (
                <button
                  onClick={async () => { await signOut(); router.replace('/admin/login'); }}
                  className="text-xs font-semibold rounded-full px-3 py-1.5 bg-white/15 hover:bg-white/25"
                >
                  Sign out
                </button>
              )}
            </div>
          </div>
          <nav className="max-w-6xl mx-auto px-2 pb-1 flex gap-1 overflow-x-auto">
            {NAV.filter((n) => !role || n.roles.includes(role)).map((n) => {
              const active = router.pathname === n.href || router.pathname.startsWith(n.href + '/');
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={
                    'shrink-0 px-4 py-2 rounded-t-xl text-sm font-semibold transition-colors ' +
                    (active ? 'bg-clay-bg text-sky-700' : 'text-white/70 hover:text-white hover:bg-white/10')
                  }
                >
                  <ClayIcon name={n.icon} className="w-3.5 h-3.5 inline mr-1" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-6">
          {loading && <p className="text-center py-16 text-gray-400">Loading…</p>}
          {!loading && error && (
            <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">{error}</p>
          )}
          {denied && !error && (
            <p className="clay-raised-sm rounded-2xl p-4 text-sm text-clay-danger bg-clay-danger-bg">
              Your role ({role || 'none'}) has no access to this screen.
            </p>
          )}
          {!loading && session && profile && !denied && children}
        </main>
      </div>
    </>
  );
}
