import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';
import { z } from 'zod';
import crypto from 'node:crypto';

const adminRate = rateLimit({ windowMs: 60_000, max: 60 });

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.coerce.number().positive().max(1_000_000),
  spent_at: DATE,
  notes: z.string().max(500).optional().nullable(),
  // Same shape the order form posts: a data: URL, or '' when nothing attached.
  receipt: z
    .union([z.literal(''), z.string().startsWith('data:image/').max(2_000_000)])
    .optional()
    .nullable(),
});

export default async function handler(req, res) {
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const range = z.object({ from: DATE.optional(), to: DATE.optional() }).safeParse(req.query);
    if (!range.success) return res.status(400).json({ error: 'Invalid date range' });
    const { from, to } = range.data;

    try {
      let query = supabase.from('expenses').select('*').eq('branch_id', DEFAULT_BRANCH_ID);
      if (from) query = query.gte('spent_at', from);
      if (to) query = query.lte('spent_at', to);
      const { data: rows, error } = await query.order('spent_at', { ascending: false }).limit(500);
      if (error) throw error;

      // receipt_path is a bare Storage path, not a servable URL.
      const paths = [...new Set((rows || []).map((e) => e.receipt_path).filter(Boolean))];
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('expense-receipts').createSignedUrls(paths, 3600);
        const urlByPath = new Map((signed || []).map((s) => [s.path, s.signedUrl]));
        for (const e of rows) {
          if (e.receipt_path) e.receipt_path = urlByPath.get(e.receipt_path) || null;
        }
      }

      const byCategory = {};
      let total = 0;
      for (const e of rows || []) {
        const amt = Number(e.amount) || 0;
        total += amt;
        byCategory[e.category] = (byCategory[e.category] || 0) + amt;
      }

      return res.status(200).json({
        expenses: rows || [],
        total: Math.round(total * 100) / 100,
        byCategory: Object.entries(byCategory)
          .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
          .sort((a, b) => b.amount - a.amount),
      });
    } catch (err) {
      console.error('Expenses list query failed:', err);
      return res.status(500).json({ error: 'Failed to load expenses' });
    }
  }

  if (req.method === 'POST') {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid expense data' });
    const { category, amount, spent_at, notes, receipt } = parsed.data;

    try {
      const id = crypto.randomUUID();

      let receipt_path = null;
      if (receipt) {
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(receipt);
        if (match) {
          const [, contentType, base64] = match;
          const ext = contentType === 'image/png' ? 'png' : 'jpg';
          receipt_path = `${id}/receipt.${ext}`;
          const { error: uploadErr } = await supabase.storage
            .from('expense-receipts')
            .upload(receipt_path, Buffer.from(base64, 'base64'), { contentType, upsert: true });
          if (uploadErr) {
            console.error('Receipt upload failed:', uploadErr);
            receipt_path = null;
          }
        }
      }

      // ponytail: supplier_id left null — expenses.supplier_id is a FK to a
      // suppliers table with no UI, and free-text notes cover "who from".
      const { data, error } = await supabase.from('expenses').insert({
        id,
        branch_id: DEFAULT_BRANCH_ID,
        category,
        amount,
        spent_at,
        notes: notes || null,
        receipt_path,
      }).select('*').single();
      if (error) throw error;

      return res.status(201).json(data);
    } catch (err) {
      console.error('Expense insert failed:', err);
      return res.status(500).json({ error: 'Failed to save expense' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
