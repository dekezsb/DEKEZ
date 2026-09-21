import type { ExistingPayment, StatementTransaction, rankExistingPayments } from './tenant-reconciliation';

export const CONFIDENCE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'Exact / High Confidence' },
  { value: 'possible', label: 'Possible Match' },
  { value: 'review', label: 'Manual Review' },
  { value: 'unmatched', label: 'Unmatched' },
] as const;
export type ConfidenceFilter = typeof CONFIDENCE_FILTERS[number]['value'];
type Ranked = ReturnType<typeof rankExistingPayments>;

// Presentation only: the matching engine always retains its full candidate pool.
export function reconciliationViewGroup(bank: StatementTransaction, ranked: Ranked, selected?: ExistingPayment): Exclude<ConfidenceFilter, 'all'> {
  const suggestion = selected ? ranked.find(item => item.payment.id === selected.id) : ranked[0];
  if (bank.used || bank.duplicate || selected?.duplicate || selected?.bankId || selected?.legacyMatched
    || (selected && (!selected.eligible || Math.round(selected.amount * 100) !== Math.round(bank.amount * 100)))) return 'review';
  if (!suggestion) return selected ? 'review' : 'unmatched';
  if (suggestion.status === 'MANUAL_REVIEW') return 'review';
  if (['Exact Match', 'High Confidence'].includes(suggestion.confidence)) return 'high';
  return suggestion.confidence === 'Possible Match' ? 'possible' : 'review';
}

export function reconciliationViewPriority(group: Exclude<ConfidenceFilter, 'all'>, confidence?: string) {
  if (group === 'high') return confidence === 'Exact Match' ? 0 : 1;
  return group === 'possible' ? 2 : group === 'review' ? 3 : 4;
}
