import { bankRoomScope, paymentInBankScope } from './bank-room-scope';
export type ReconciliationStatus = 'PENDING' | 'MATCH_SUGGESTED' | 'RECONCILED' | 'UNMATCHED' | 'MANUAL_REVIEW';
export type ExistingPayment = {
  id: string; tenant: string; property: string; room: string; invoice: string; invoiceId: string | null;
  receipt: string; amount: number; date: string; reference: string; arReference: string;
  slipUrl: string | null; eligible: boolean; tenantStatus: string; reconciliationStatus: ReconciliationStatus;
  bankId: string | null; legacyMatched: boolean;
  duplicate?: boolean; submissionOnly?: boolean; invoiceMonth?: string | null; propertyCode?: string;
  submissionId?: string | null; slipVerified?: boolean; tenancyId?: string | null;
  reconciledAmount?: number; remainingAmount?: number; allocationParts?: {id:string;amount:number;remaining:number}[];
};
export type StatementTransaction = { id: string; amount: number; allocatedAmount?:number; remainingAmount?:number; date: string; reference: string; description: string; used: boolean; completed?: boolean; duplicate?: boolean; bankAccountId?: string; statementId?: string; legacyPaymentLinks?: {sourceType:string;sourceId:string;amount:number}[] };
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const contains = (haystack: string, needle: string) => normalized(needle).length >= 4 && normalized(haystack).includes(normalized(needle));
export function bankReferenceMatches(bank: StatementTransaction, reference: string) {
  const code = normalized(reference);
  if (code.length < 4 || !/\d/.test(code)) return false;
  const token = new RegExp(`(^|[^a-z0-9])${code.split('').join('[\\s/\\-]*')}($|[^a-z0-9])`, 'i');
  return token.test(bank.reference) || token.test(bank.description);
}
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
    const same = Math.round((bank.remainingAmount ?? bank.amount) * 100) === Math.round((payment.remainingAmount ?? payment.amount) * 100);
    const days = Math.abs(Date.parse(bank.date) - Date.parse(payment.date)) / 86400000;
    const ref = bankReferenceMatches(bank, payment.reference);
    const name = containsTenantName(text, payment.tenant);
    const document = contains(text, payment.invoice) || payment.receipt.split(',').some(receipt=>contains(text,receipt));
    const priority = same && days <= 3 ? 1 : same && ref ? 2 : same && (name || location) ? 3 : document ? 4 : location || name || ref || (days <= 3 && Math.abs(bank.amount-payment.amount)<=5) ? 5 : 0;
    const locationConflict = false; // Conflicting rooms were excluded before ranking.
    const locationMatch=Boolean(location&&!locationConflict);
    const missingIdentity=!name&&!locationMatch&&!ref;
    return priority ? [{payment,priority,referenceMatch:ref,identity:ref || name || document || locationMatch, exactAmount:same,locationConflict,missingIdentity,
      matchReason:ref ? 'Bank transaction reference matches the verified payment' : locationMatch ? same ? 'Property / room and amount match' : 'Correct property / room; amount differs — review existing payments' : name?'Tenant name matches bank description':'No matching bank code, tenant name or property / room reference — select the existing receipt manually'}] : [];
  }).sort((a,b) => Number(b.referenceMatch&&b.exactAmount)-Number(a.referenceMatch&&a.exactAmount) || Number(a.missingIdentity)-Number(b.missingIdentity) || a.priority-b.priority || Number(b.identity)-Number(a.identity));
  const exactReferences = ranked.filter(item=>item.referenceMatch&&item.exactAmount);
  const ambiguous = exactReferences.length ? exactReferences.length>1 : location ? ranked.filter(item=>item.exactAmount).length>1 : ranked.length>1 && ((ranked[0].priority===ranked[1].priority && ranked[0].identity===ranked[1].identity) || (!ranked[0].identity&&ranked.some(item=>item.identity)));
  return ranked.map(item => ({...item,
    confidence: item.missingIdentity || bank.duplicate || item.payment.duplicate || item.locationConflict || !item.exactAmount || item.priority===5 || ambiguous || (exactReferences.length>0&&!item.referenceMatch) ? 'Manual Review' : item.identity && item.priority<=2 ? 'Exact Match' : item.priority<=3 ? 'High Confidence' : 'Possible Match',
    status: (item.missingIdentity || bank.duplicate || item.payment.duplicate || item.locationConflict || !item.exactAmount || ambiguous || item.priority===5 || (exactReferences.length>0&&!item.referenceMatch) ? 'MANUAL_REVIEW' : 'MATCH_SUGGESTED') as ReconciliationStatus,
  }));
}

export function flagDuplicateBanks(banks: StatementTransaction[]): StatementTransaction[] {
  return banks.map(bank => ({...bank, duplicate: !bank.used && banks.some(other => other.id!==bank.id && other.bankAccountId===bank.bankAccountId && (other.used||(other.allocatedAmount??0)>0) && other.amount===bank.amount && other.date===bank.date && ((bank.reference.trim() && bank.reference===other.reference) || (bank.description.trim() && bank.description===other.description)))}));
}

// A ready suggestion still requires the user's Reconcile click. It is not posted automatically.
export function directReconciliationPayment(bank: StatementTransaction, ranked: ReturnType<typeof rankExistingPayments>) {
  if(bank.used||bank.completed||bank.duplicate||(bank.remainingAmount??bank.amount)<=0) return null;
  // A unique, identified verified slip may be reviewed and partially allocated.
  // This only selects the candidate; the user must still press Reconcile.
  const identified=ranked.filter(s=>!s.missingIdentity);
  if(identified.length===1) {
    const candidate=identified[0],p=candidate.payment;
    if(!candidate.locationConflict&&!p.duplicate&&p.eligible&&!p.bankId&&!p.legacyMatched
      && (p.remainingAmount??p.amount)>0 && (p.slipUrl||p.receipt.trim())) return p;
  }
  const top = ranked[0];
  if (!top || bank.used || bank.duplicate || top.status !== 'MATCH_SUGGESTED'
    || !['Exact Match','High Confidence'].includes(top.confidence) || !top.exactAmount || top.locationConflict
    || !top.payment.eligible || top.payment.bankId || top.payment.legacyMatched || top.payment.duplicate
    || !(top.payment.slipUrl || top.payment.receipt.trim())) return null;
  return top.payment;
}
