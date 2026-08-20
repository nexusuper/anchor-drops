// ponytail: posts to our own API route, not a third-party service - free, no
// account, no SDK. Vercel's runtime logs are the storage layer.
export function reportError(error, context = {}) {
  try {
    const body = JSON.stringify({
      message: String(error?.message || error),
      stack: String(error?.stack || '').slice(0, 2000),
      // Origin + pathname only, no query string: /track carries the
      // customer's phone as a query param, which must never land in logs.
      url: typeof window !== 'undefined' ? window.location.origin + window.location.pathname : null,
      context,
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
    } else {
      // .catch() is required: an unhandled rejection here (offline, DNS
      // failure, server down) would fire our own unhandledrejection
      // listener in _app.js and call reportError again, looping.
      fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never itself throw and break the page.
  }
}
