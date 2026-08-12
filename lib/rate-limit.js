// NOTE: In-memory rate limiter — state is not shared across concurrent Vercel
// function instances (each cold start gets its own Map). For a global limiter,
// use @upstash/ratelimit backed by Upstash Redis (Vercel Marketplace, free tier).
// Admin brute-force is handled separately by verifyAdminWithLockout in lib/auth.js.
const hits = new Map();

const CLEANUP_INTERVAL = 60_000;
let cleanupTimer;

function scheduleCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.start > entry.window) hits.delete(key);
    }
    if (hits.size === 0) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

export function getIp(req) {
  // Only trust proxy-set headers, never the client-supplied x-forwarded-for
  // chain: a spoofed IP would bypass rate limits and the admin lockout, or
  // lock out a victim's real IP. Vercel sets x-vercel-forwarded-for itself;
  // the last x-forwarded-for entry is appended by the closest trusted proxy.
  const vercelIp = (req.headers['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  const xff = (req.headers['x-forwarded-for'] || '').split(',');
  const lastHop = xff[xff.length - 1].trim();
  return vercelIp || lastHop || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  return function check(req, res) {
    const target = getIp(req);
    const route = req.url?.split('?')[0] || '/';
    const key = `${target}:${route}`;
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { count: 0, start: now, window: windowMs };
      hits.set(key, entry);
      scheduleCleanup();
    }

    entry.count++;

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.start + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return false;
    }
    return true;
  };
}
