// ponytail: posts to our own API route, not a third-party service - free, no
// account, no SDK. Vercel's runtime logs are the storage layer.
export function reportError(error, context = {}) {
  try {
    const body = JSON.stringify({
      message: String(error?.message || error),
      stack: String(error?.stack || '').slice(0, 2000),
      url: typeof window !== 'undefined' ? window.location.href : null,
      context,
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    }
  } catch {
    // Reporting must never itself throw and break the page.
  }
}
