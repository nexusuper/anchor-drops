import { rateLimit } from '@/lib/rate-limit';

const limiter = rateLimit({ windowMs: 60_000, max: 20 });

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!limiter(req, res)) return;
  const { message, stack, url, context } = req.body || {};
  // Vercel captures console.error into the runtime logs, which is our storage.
  console.error('[client-error]', JSON.stringify({
    message: String(message || '').slice(0, 500),
    stack: String(stack || '').slice(0, 2000),
    url: String(url || '').slice(0, 300),
    context,
  }));
  return res.status(204).end();
}
