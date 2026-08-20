import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, max: 20 });

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!limiter(req, res)) return;
  const { message, stack, url, context } = req.body || {};
  // Public, unauthenticated endpoint: bound every field before logging, not
  // just the ones reportError() happens to send. A direct POST could push an
  // arbitrarily large context object otherwise (Next's 1MB body limit is the
  // only cap), which is the same log-quota exhaustion risk the rate limiter
  // exists to prevent. JSON.stringify can throw on a circular object, so
  // guard it.
  let boundedContext;
  try {
    boundedContext = String(JSON.stringify(context ?? null)).slice(0, 500);
  } catch {
    boundedContext = '"[unserializable]"';
  }
  // Vercel captures console.error into the runtime logs, which is our storage.
  console.error('[client-error]', JSON.stringify({
    message: String(message || '').slice(0, 500),
    stack: String(stack || '').slice(0, 2000),
    url: String(url || '').slice(0, 300),
    context: boundedContext,
  }));
  return res.status(204).end();
}
