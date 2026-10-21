'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { getCurrentUser, getFirstCompany } from '@/lib/data/organization';
import { createAdminClient } from '@/lib/supabase/admin';
import type { HistoricalCreditPreview } from '@/lib/accounting/historical-credit';

async function context() {
  await requireRole(['super_admin', 'admin', 'owner'], { module: 'reports', level: 'manage' });
  const [user, company] = await Promise.all([getCurrentUser(), getFirstCompany()]);
  if (!user || !company) throw new Error('Authorized company access required');
  return { user, company, db: createAdminClient() };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function previewHistoricalCredits(bankId: string) {
  const { user, company, db } = await context();
  if (!uuid.test(bankId)) return { ok: false as const, error: 'Select a valid bank account.' };
  const { data, error } = await db.rpc('preview_historical_rental_credits', {
    p_company: company.id, p_bank: bankId, p_actor: user.id,
  });
  if (error) return { ok: false as const, error: 'Historical preview is unavailable. Nothing was changed. Check that the approved database update has been installed.' };
  return { ok: true as const, preview: data as HistoricalCreditPreview, runId: randomUUID() };
}
export async function clearHistoricalCredits(bankId: string, runId: string, hash: string, confirmed: boolean) {
  const { user, company, db } = await context();
  if (confirmed !== true || !uuid.test(bankId) || !uuid.test(runId) || !/^[a-f0-9]{32}$/.test(hash)) {
    return { ok: false as const, error: 'Preview and confirm the historical batch first.' };
  }
  const { data, error } = await db.rpc('clear_historical_rental_credits', {
    p_company: company.id, p_bank: bankId, p_actor: user.id, p_run: runId, p_hash: hash,
  });
  if (error) return { ok: false as const, error: error.message.includes('preview_changed')
    ? 'Records changed after preview. Refresh the preview and confirm the updated totals. Nothing was applied.'
    : 'The batch could not be confirmed. Retry with this same preview if the connection was interrupted; otherwise refresh it. No partial batch is committed.' };
  revalidatePath('/reports');
  return { ok: true as const, result: data as { cleared_count: number; cleared_amount: number; new_ar_credit: number; completed_statements: string[] } };
}
