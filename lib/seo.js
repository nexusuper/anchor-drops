// Single source of truth for absolute URLs. The env var is set per-environment
// in Vercel; the fallback is the production domain so a missing var degrades to
// correct-but-hardcoded rather than to a vercel.app subdomain.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.anchordropscdo.com';

export function canonicalFor(path) {
  return new URL(path || '/', SITE_URL).toString();
}
