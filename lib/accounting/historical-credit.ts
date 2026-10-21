export type HistoricalCreditRow = {
  id: string; date: string; month: string; statement_id: string; statement_month: string;
  description: string; reference: string | null; amount: number; allocated: number;
  remaining: number; ready: number; new_ar_credit: number;
  mode: 'existing_payment' | 'existing_ar_offset' | 'reclassify_other_ar' | null;
  source_id: string | null; reason: string | null;
};
export type HistoricalCreditPreview = {
  bank_id: string; account_code: string; adjustment_date: string; rows: HistoricalCreditRow[]; hash: string;
};
export const historicalMonth = (month: string) => /^2026-0[3-8]$/.test(month);
export const historicalStatementRange = (start: string, end: string) =>
  historicalMonth(start.slice(0, 7)) && historicalMonth(end.slice(0, 7)) && start <= end;
export function historicalCreditSummary(rows: HistoricalCreditRow[]) {
  const cents = (value: number) => Math.round(Number(value) * 100);
  return Array.from({ length: 6 }, (_, i) => {
    const month = `2026-${String(i + 3).padStart(2, '0')}`;
    const selected = rows.filter(row => row.month === month);
    return {
      month, count: selected.length,
      total: selected.reduce((n, r) => n + cents(r.amount), 0) / 100,
      completed: selected.reduce((n, r) => n + cents(r.reason === 'already_completed' ? r.amount : r.allocated), 0) / 100,
      ready: selected.reduce((n, r) => n + cents(r.ready), 0) / 100,
      newCredit: selected.reduce((n, r) => n + cents(r.new_ar_credit), 0) / 100,
      excluded: selected.reduce((n, r) => n + (r.reason === 'already_completed' ? 0 : Math.max(0, cents(r.remaining) - cents(r.ready))), 0) / 100,
      readyCount: selected.filter(r => Number(r.ready) > 0).length,
    };
  });
}
export const historicalExclusionLabels: Record<string, string> = {
  already_completed: 'Already completed — skipped',
  statement_closed: 'Statement already closed',
  security_or_mixed_deposit: 'Security deposit or mixed rent/deposit — protected',
  transfer_or_non_rental: 'Transfer or non-rental money — protected',
  existing_accounting_allocation: 'Existing accounting allocation — protected',
  possible_duplicate_bank: 'Possible duplicate bank transaction — protected',
  ambiguous_existing_settlements: 'More than one possible existing settlement',
  conflicting_location_evidence: 'Bank location conflicts with the existing settlement',
  receivable_settlement_not_established: 'Existing receivable settlement could not be established',
  unverified_source: 'Source payment has not been verified',
  settlement_already_fully_linked: 'Existing settlement already fully reconciled',
  non_rental_offset: 'Existing offset is not a rental receivable',
  protected_offset: 'Protected deposit or non-rental offset',
  accounting_source_not_established: 'Missing accounting evidence — no new receivable credit created',
  current_adjustment_period_locked: 'Current adjustment period is locked',
  source_claimed_by_multiple_banks: 'Same source identified by multiple bank transactions',
};
