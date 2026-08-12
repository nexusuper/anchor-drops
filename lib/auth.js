import crypto from 'node:crypto';
// ponytail: relative (not '@/lib/...') so scripts/auth.test.mjs can run under plain node.
import { getIp } from './rate-limit.js';

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ADMIN_USERS="owner:pass1,rider1:pass2". Unset → single unnamed "admin" using
// ADMIN_PASSWORD (byte-for-byte the old behavior). Passwords may not contain ','.
function adminUsers() {
  const raw = process.env.ADMIN_USERS;
  if (!raw) {
    const p = process.env.ADMIN_PASSWORD;
    return p ? [{ name: 'admin', password: p }] : [];
  }
  return raw
    .split(',')
    .map((pair) => {
      const i = pair.indexOf(':');
      if (i < 1) return null;
      return { name: pair.slice(0, i).trim(), password: pair.slice(i + 1) };
    })
    // 'locked'/'failed' are checkLockout sentinels — never allow them as names.
    .filter((u) => u && u.name && u.password && u.name !== 'locked' && u.name !== 'failed');
}

// sha256 both sides so timingSafeEqual always gets equal-length buffers —
// password length never leaks, and no candidate is skipped early.
function digest(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

// Returns the matched staff name (truthy string) or false. Every candidate is
// compared, so neither which user matched nor how many exist leaks via timing.
export function verifyAdmin(req) {
  const password = req.headers['password'];
  const users = adminUsers();
  if (typeof password !== 'string' || !password || users.length === 0) return false;
  const given = digest(password);
  let matched = false;
  for (const u of users) {
    if (crypto.timingSafeEqual(given, digest(u.password)) && !matched) matched = u.name;
  }
  return matched;
}

const LOCKOUT_MAX = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// In-memory per-IP lockout, same windowed-counter shape as lib/rate-limit.js.
// ponytail: state resets on cold start / isn't shared across instances — same
// accepted tradeoff lib/rate-limit.js already documents for this deployment.
const failures = new Map();

function checkLockout(req) {
  const ip = getIp(req);
  const now = Date.now();
  let entry = failures.get(ip);
  if (entry && now - entry.windowStart > LOCKOUT_WINDOW_MS) entry = undefined;

  if (entry && entry.count >= LOCKOUT_MAX) return 'locked';

  const name = verifyAdmin(req);
  if (!name) {
    if (!entry) entry = { count: 0, windowStart: now };
    entry.count += 1;
    failures.set(ip, entry);
    return 'failed';
  }

  failures.delete(ip);
  return name; // truthy staff name doubles as the 'ok' result
}

// Checks lockout, verifies admin password, records failures / clears on success.
// Returns the matched staff name (truthy) so callers can attribute the action;
// returns false and sends a response if auth fails or is locked out.
export async function verifyAdminWithLockout(req, res) {
  const result = checkLockout(req);
  if (result === 'locked') {
    res.setHeader('Retry-After', '900');
    res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    return false;
  }
  if (result === 'failed') {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return result;
}

// For routes where a missing password just means a public request (e.g. order
// tracking): only requests that present a password header count toward, or are
// blocked by, the lockout. Never sends a response — returns false for
// non-admin, locked-out, or wrong-password requests alike.
export async function verifyAdminSoftLockout(req) {
  if (!req.headers['password']) return false;
  const result = checkLockout(req);
  return result === 'locked' || result === 'failed' ? false : result;
}
