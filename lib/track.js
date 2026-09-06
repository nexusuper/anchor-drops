// Lightweight first-party visitor tracking. No cookies, no cross-site
// identifiers — just a random id in localStorage so repeat visits in the same
// browser count as one "session" for the admin dashboard. Never send this id
// anywhere else, and never pair it with a name/phone/email.
const SESSION_KEY = 'ad_sid';

function sessionId() {
  if (typeof window === 'undefined') return null;
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked (private mode etc.) — tracking is best-effort
  }
}

function send(event_type, path, label) {
  const session_id = sessionId();
  if (!session_id) return;
  const body = JSON.stringify({
    session_id,
    event_type,
    path,
    label: label || undefined,
    referrer: document.referrer || undefined,
  });
  // sendBeacon survives page unload (e.g. a click that navigates away);
  // fetch keepalive is the fallback where sendBeacon is unavailable.
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
  } else {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }
}

export function trackPageview(path) {
  send('pageview', path);
}

// Delegated click capture — no per-component instrumentation needed. Only
// reports the clicked element's own visible text/aria-label, truncated, so
// nothing typed into a form field can leak through.
export function initClickTracking() {
  if (typeof window === 'undefined' || window.__adClickTrackingInit) return;
  window.__adClickTrackingInit = true;
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button, [role="button"]');
    if (!el) return;
    const path = window.location.pathname;
    if (path.startsWith('/admin')) return;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!label) return;
    send('click', path, label);
  }, { capture: true });
}
