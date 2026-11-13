import { z } from 'zod';
import { rateLimit } from '@/lib/rate-limit';
import { getSupabase } from '@/lib/supabaseAdmin';

export const config = { api: { bodyParser: { sizeLimit: '12kb' } } };
const quoteRate = rateLimit({ windowMs: 60_000, max: 60 });
const QuoteSchema = z.object({
  lines: z.array(z.object({
    sku: z.string().min(1).max(50),
    quantity: z.number().int().min(1).max(50),
    container_quantity: z.number().int().min(0).max(50).default(0),
  })).min(1).max(20),
  fulfillment: z.enum(['pickup', 'delivery']),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await quoteRate(req, res)) return;
  if (Array.isArray(req.body?.lines) && req.body.lines.length > 20) {
    return res.status(400).json({ error: 'Choose between 1 and 20 order lines.' });
  }

  const input = QuoteSchema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: 'Invalid quote request' });
  const { lines, fulfillment, lat, lng } = input.data;
  const { data, error } = await getSupabase().rpc('quote_catalog_order', {
    p_lines: lines,
    p_fulfillment: fulfillment,
    p_lat: lat ?? null,
    p_lng: lng ?? null,
  });
  if (error) {
    if (error.code === '22023') return res.status(400).json({ error: error.message });
    console.error('Order quote failed:', error.code);
    return res.status(503).json({ error: 'Could not load current prices. Please try again.' });
  }
  return res.status(200).json(data);
}
