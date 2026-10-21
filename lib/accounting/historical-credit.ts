export type HistoricalCreditRow = {
  id: string; date: string; month: string; statement_id: string; statement_month: string;
  description: string; reference: string | null; amount: number; allocated: number;
  remaining: number; ready: number; new_ar_credit: number;
  mode: 'historical_classification' | null;
  source_id: string | null; reason: string | null;
};
export type HistoricalCreditPreview = {
  bank_id: string; account_code: string; adjustment_date: string; period_locked: boolean; rows: HistoricalCreditRow[]; hash: string;
};
export const historicalMonth = (month: string) => /^2026-0[3-8]$/.test(month);
export const historicalStatementRange = (start: string, end: string) =>
  historicalMonth(start.slice(0, 7)) && historicalMonth(end.slice(0, 7)) && start <= end;
export const septemberStatementRange = (start: string, end: string) =>
  start >= '2026-09-01' && end <= '2026-09-30' && start <= end;
export function historicalCreditSummary(rows: HistoricalCreditRow[], months = Array.from({ length: 6 }, (_, i) => `2026-${String(i + 3).padStart(2, '0')}`)) {
  const cents = (value: number) => Math.round(Number(value) * 100);
  return months.map(month => {
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
  known_other_category: 'Existing accounting category retained — no reclassification',
  known_security_liability: 'Recorded tenant security deposit liability retained',
  already_accounted: 'Existing accounting retained — no second receivable credit',
  source_changed: 'Source changed since the fixed batch was captured — no posting',
};
