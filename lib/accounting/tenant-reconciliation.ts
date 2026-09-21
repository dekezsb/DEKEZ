import { bankRoomScope, paymentInBankScope } from './bank-room-scope';
export type ReconciliationStatus = 'PENDING' | 'MATCH_SUGGESTED' | 'RECONCILED' | 'UNMATCHED' | 'MANUAL_REVIEW';
export type ExistingPayment = {
  id: string; tenant: string; property: string; room: string; invoice: string; invoiceId: string | null;
  receipt: string; amount: number; date: string; reference: string; arReference: string;
  slipUrl: string | null; eligible: boolean; tenantStatus: string; reconciliationStatus: ReconciliationStatus;
  bankId: string | null; legacyMatched: boolean;
  duplicate?: boolean; submissionOnly?: boolean; invoiceMonth?: string | null; propertyCode?: string;
};
export type StatementTransaction = { id: string; amount: number; date: string; reference: string; description: string; used: boolean; completed?: boolean; duplicate?: boolean; bankAccountId?: string; statementId?: string; legacyPaymentLinks?: {sourceType:string;sourceId:string;amount:number}[] };
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const contains = (haystack: string, needle: string) => normalized(needle).length >= 4 && normalized(haystack).includes(normalized(needle));
// Preserve word boundaries: ANN LEE must not match JOANN LEE or ANN LEELA.
const nameWords = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const containsTenantName = (text: string, name: string) => {
  const fullName=nameWords(name);
  return fullName.length>=4 && !['unlinked tenant','unknown','tenant'].includes(fullName)
    && ` ${nameWords(text)} `.includes(` ${fullName} `);
};
export function rankExistingPayments(bank: StatementTransaction, payments: ExistingPayment[]) {
  if (bank.used) return [];
  const text = `${bank.reference} ${bank.description}`;
  const { hint: location, conflict } = bankRoomScope(bank);
  if (conflict) return [];
  const ranked = payments.filter(p => p.eligible && !p.bankId && !p.legacyMatched).flatMap(payment => {
    if (!paymentInBankScope(bank, payment)) return [];
    const same = Math.round(bank.amount * 100) === Math.round(payment.amount * 100);
    const days = Math.abs(Date.parse(bank.date) - Date.parse(payment.date)) / 86400000;
    const ref = contains(text, payment.reference);
    const name = containsTenantName(text, payment.tenant);
    const document = contains(text, payment.invoice) || payment.receipt.split(',').some(receipt=>contains(text,receipt));
    const priority = same && days <= 3 ? 1 : same && ref ? 2 : same && (name || location) ? 3 : document ? 4 : location || (days <= 3 && Math.abs(bank.amount-payment.amount)<=5) ? 5 : 0;
    const locationConflict = false; // Conflicting rooms were excluded before ranking.
    const locationMatch=Boolean(location&&!locationConflict);
    const missingIdentity=!name&&!locationMatch;
    return priority ? [{payment,priority,identity:ref || name || document || locationMatch, exactAmount:same,locationConflict,missingIdentity,
      matchReason:locationMatch ? same ? 'Property / room and amount match' : 'Correct property / room; amount differs — review existing payments' : name?'Tenant name matches bank description':'No matching tenant name or property / room reference — select the existing receipt manually'}] : [];
  }).sort((a,b) => Number(a.missingIdentity)-Number(b.missingIdentity) || a.priority-b.priority || Number(b.identity)-Number(a.identity));
  const ambiguous = location ? ranked.filter(item=>item.exactAmount).length>1 : ranked.length>1 && ((ranked[0].priority===ranked[1].priority && ranked[0].identity===ranked[1].identity) || (!ranked[0].identity&&ranked.some(item=>item.identity)));
  return ranked.map(item => ({...item,
    confidence: item.missingIdentity || bank.duplicate || item.payment.duplicate || item.locationConflict || !item.exactAmount || item.priority===5 || ambiguous ? 'Manual Review' : item.identity && item.priority<=2 ? 'Exact Match' : item.priority<=3 ? 'High Confidence' : 'Possible Match',
    status: (item.missingIdentity || bank.duplicate || item.payment.duplicate || item.locationConflict || !item.exactAmount || ambiguous || item.priority===5 ? 'MANUAL_REVIEW' : 'MATCH_SUGGESTED') as ReconciliationStatus,
  }));
}

export function flagDuplicateBanks(banks: StatementTransaction[]): StatementTransaction[] {
  return banks.map(bank => ({...bank, duplicate: !bank.used && banks.some(other => other.id!==bank.id && other.bankAccountId===bank.bankAccountId && other.used && other.amount===bank.amount && other.date===bank.date && ((bank.reference.trim() && bank.reference===other.reference) || (bank.description.trim() && bank.description===other.description)))}));
}

// A ready suggestion still requires the user's Reconcile click. It is not posted automatically.
export function directReconciliationPayment(bank: StatementTransaction, ranked: ReturnType<typeof rankExistingPayments>) {
  const top = ranked[0];
  if (!top || bank.used || bank.duplicate || top.status !== 'MATCH_SUGGESTED'
    || !['Exact Match','High Confidence'].includes(top.confidence) || !top.exactAmount || top.locationConflict
    || !top.payment.eligible || top.payment.bankId || top.payment.legacyMatched || top.payment.duplicate
    || !(top.payment.slipUrl || top.payment.receipt.trim())) return null;
  return top.payment;
}
