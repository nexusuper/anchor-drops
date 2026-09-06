// Rate limiting, shared across every /api route.
//
// Backed by Upstash Redis (Vercel Marketplace, free tier) when
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set — a real limit
// shared across every serverless instance. Without those env vars, falls back
// to the original in-memory Map: state is NOT shared across concurrent Vercel
// function instances (each cold start gets its own Map), so it's a soft
// speed-bump, not a hard wall. Admin brute-force is handled separately by
// verifyAdminWithLockout in lib/auth.js regardless of which backend is active.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

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

// Vercel's own Marketplace integration for Upstash names these KV_REST_API_*
// rather than UPSTASH_REDIS_REST_*; accept either so this works whether the
// database was connected via "Storage" (KV_*) or a bare Upstash integration.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = REDIS_URL && REDIS_TOKEN
  ? new Redis({ url: REDIS_URL, token: REDIS_TOKEN })
  : null;

if (!redis) {
  console.warn('[rate-limit] KV_REST_API_URL/TOKEN (or UPSTASH_REDIS_REST_URL/TOKEN) not set — using in-memory limiter (not shared across instances).');
}

// Each rateLimit() call site gets its own bucket namespace. Deriving it from
// req.url instead was inert on every dynamic route — /api/orders/<id> puts the
// order id in the path, so each id got a fresh bucket and nothing was ever
// throttled, while the Map grew one entry per id seen. The closure identity IS
// the route pattern (one limiter per handler), and it needs no plumbing at the
// call sites. Key cardinality is now (number of limiters) x (IPs seen in the
// window), and the cleanup timer drops entries once their window lapses.
let limiterSeq = 0;

export function rateLimit({ windowMs = 60_000, max = 20 } = {}) {
  const scope = `r${++limiterSeq}`;

  if (redis) {
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowMs} ms`),
      prefix: `anchor-drops:${scope}`,
    });
    return async function check(req, res) {
      const { success, reset } = await limiter.limit(getIp(req));
      if (!success) {
        res.setHeader('Retry-After', String(Math.max(0, Math.ceil((reset - Date.now()) / 1000))));
        res.status(429).json({ error: 'Too many requests. Please try again later.' });
        return false;
      }
      return true;
    };
  }

  return async function check(req, res) {
    const key = `${scope}:${getIp(req)}`;
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
