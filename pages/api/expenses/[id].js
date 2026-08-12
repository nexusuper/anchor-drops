import { getSupabase } from '@/lib/supabaseAdmin';
import { DEFAULT_BRANCH_ID } from '@/lib/constants';
import { verifyAdminWithLockout } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const adminRate = rateLimit({ windowMs: 60_000, max: 30 });

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  if (!adminRate(req, res)) return;
  if (!await verifyAdminWithLockout(req, res)) return;

  const parsed = z.string().uuid().safeParse(req.query.id);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid expense id' });
  const id = parsed.data;

  const supabase = getSupabase();
  // Scoped to the branch the list endpoint reads, so this can only ever delete a
  // row the caller can actually see.
  const { data: expense } = await supabase.from('expenses')
    .select('id, receipt_path').eq('id', id).eq('branch_id', DEFAULT_BRANCH_ID).single();
  if (!expense) return res.status(404).json({ error: 'Expense not found' });

  const { error } = await supabase.from('expenses').delete().eq('id', id).eq('branch_id', DEFAULT_BRANCH_ID);
  if (error) {
    console.error('Expense delete failed:', error);
    return res.status(500).json({ error: 'Failed to delete expense' });
  }
  if (expense.receipt_path) {
    await supabase.storage.from('expense-receipts').remove([expense.receipt_path]);
  }
  return res.status(200).json({ success: true });
}
