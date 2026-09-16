export type ReconciliationStatus = 'PENDING' | 'MATCH_SUGGESTED' | 'RECONCILED' | 'UNMATCHED' | 'MANUAL_REVIEW';
export type ExistingPayment = {
  id: string; tenant: string; property: string; room: string; invoice: string; invoiceId: string | null;
  receipt: string; amount: number; date: string; reference: string; arReference: string;
  slipUrl: string | null; invoiceMonth: string | null; eligible: boolean; tenantStatus: string; reconciliationStatus: ReconciliationStatus;
  bankId: string | null; legacyMatched: boolean;
  duplicate?: boolean; submissionOnly?: boolean;
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
  const ranked = payments.filter(p => p.eligible && !p.bankId && !p.legacyMatched).flatMap(payment => {
    const same = Math.round(bank.amount * 100) === Math.round(payment.amount * 100);
    const days = Math.abs(Date.parse(bank.date) - Date.parse(payment.date)) / 86400000;
    const sameStatementMonth = bank.date.slice(0,7) === payment.date.slice(0,7);
    const ref = contains(text, payment.reference);
    const name = containsTenantName(text, payment.tenant);
    const document = contains(text, payment.invoice) || payment.receipt.split(',').some(receipt=>contains(text,receipt));
    const priority = sameStatementMonth && (same && days <= 3 ? 1 : same && ref ? 2 : same && name ? 3 : document ? 4 : days <= 3 && Math.abs(bank.amount-payment.amount)<=5 ? 5 : 0);
    const location = text.toUpperCase().match(/\b(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*(?:ROOM\s*)?([A-Z]?\d+)\b/);
    const room = payment.room.toUpperCase().replace(/^ROOM\s*/, '').replace(/^0+(?=\d)/, '');
    const locationConflict = Boolean(location && (!payment.property.toUpperCase().includes(location[1]) || location[2].replace(/^0+(?=\d)/, '') !== room));
    const locationMatch=Boolean(location&&!locationConflict);
    const missingIdentity=!name&&!locationMatch;
    return priority ? [{payment,priority,identity:ref || name || document || locationMatch, exactAmount:same,locationConflict,missingIdentity,
      matchReason:name?'Tenant name matches bank description':locationMatch?'Property / room reference matches':'No matching tenant name or property / room reference — select the existing receipt manually'}] : [];
  }).sort((a,b) => Number(a.missingIdentity)-Number(b.missingIdentity) || a.priority-b.priority || Number(b.identity)-Number(a.identity));
  const ambiguous = ranked.length>1 && ((ranked[0].priority===ranked[1].priority && ranked[0].identity===ranked[1].identity) || (!ranked[0].identity&&ranked.some(item=>item.identity)));
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
