import { paymentInBankScope } from './bank-room-scope';
import type { ExistingPayment, StatementTransaction } from './tenant-reconciliation';
const cents = (amount:number) => Math.round(amount * 100);
export const remainingPaymentAmount = (p:ExistingPayment) => p.remainingAmount ?? p.amount;
export const remainingBankAmount = (b:StatementTransaction) => b.remainingAmount ?? b.amount;
export const allocationAmount = (b:StatementTransaction,p:ExistingPayment) => Math.max(0,Math.min(cents(remainingBankAmount(b)),cents(remainingPaymentAmount(p))))/100;

// A display choice, not a replacement payment. Only parts of the SAME verified
// submission can be combined automatically; equal amounts/invoices are not proof.
export function existingPaymentChoices(payments:ExistingPayment[]):ExistingPayment[] {
  const groups = new Map<string,ExistingPayment[]>();
  const singles:ExistingPayment[]=[];
  for(const p of payments) {
    if(p.submissionId && p.slipVerified && !p.submissionOnly) {
      groups.set(p.submissionId,[...(groups.get(p.submissionId)??[]),p]);
    } else singles.push(p);
  }
  for(const parts of groups.values()) {
    if(parts.length===1) { singles.push(parts[0]);continue; }
    const sorted=[...parts].sort((a,b)=>a.id.localeCompare(b.id));
    const first=sorted[0];
    const consistent=Boolean(first.tenancyId) && sorted.every(p=>p.tenancyId===first.tenancyId
      && p.propertyCode===first.propertyCode && p.room===first.room
      && p.date===first.date && p.eligible && !p.legacyMatched && !p.duplicate);
    if(!consistent) { singles.push(...parts.map(p=>({...p,eligible:false})));continue; }
    const remaining=sorted.reduce((n,p)=>n+cents(remainingPaymentAmount(p)),0)/100;
    const amount=sorted.reduce((n,p)=>n+cents(p.amount),0)/100;
    singles.push({...first,amount,remainingAmount:remaining,reconciledAmount:amount-remaining,
      invoice:[...new Set(sorted.map(p=>p.invoice).filter(Boolean))].join(', '),
      arReference:[...new Set(sorted.map(p=>p.arReference).filter(Boolean))].join('; '),
      bankId:remaining>0?null:first.bankId,legacyMatched:false,
      reconciliationStatus:remaining===0?'RECONCILED':first.reconciliationStatus==='RECONCILED'?'PENDING':first.reconciliationStatus,
      receipt:[...new Set(sorted.map(p=>p.receipt).filter(Boolean))].join(', '),
      allocationParts:sorted.map(p=>({id:p.id,amount:p.amount,remaining:remainingPaymentAmount(p),invoiceId:p.invoiceId,invoice:p.invoice,invoiceMonth:p.invoiceMonth}))});
  }
  return singles.filter(p=>remainingPaymentAmount(p)>0 && p.reconciliationStatus!=='RECONCILED');
}

export function canAllocateExistingPayment(bank:StatementTransaction,p:ExistingPayment|null|undefined) {
  return Boolean(p && p.eligible && !p.submissionOnly && !p.bankId && !p.legacyMatched && !p.duplicate
    && !bank.used && !bank.completed && !bank.duplicate && allocationAmount(bank,p)>0 && paymentInBankScope(bank,p));
}

// One bank line legitimately identifies more than one existing confirmed payment for the SAME
// tenant/room (for example a deposit plus a separate rent invoice paid together) — the bulk
// auto-queue may combine those into one multi-payment allocation, applying the bank line's
// balance to each in turn (still MIN-of-balances, still the same per-payment eligibility gate).
// It never combines candidates just because their amounts happen to sum to the bank amount, and
// it never combines candidates that could be indistinguishable duplicates of the same charge
// (equal amounts) — that stays a manual decision, same as today's "duplicate receipts never
// become ready" rule. Tenant identity prefers tenancyId when every candidate has one; otherwise
// it requires the same tenant name AND the same property/room.
export function canBulkGroupPayments(payments:ExistingPayment[]) {
  if(payments.length<2) return true;
  const name=(t:string)=>t.trim().toLowerCase();
  const normalizedRef=(p:ExistingPayment)=>p.reference.replace(/[^a-z0-9]/gi,'').toUpperCase();
  const refCode=normalizedRef(payments[0]);
  // An identical bank code the admin explicitly saved on every candidate (user-approved
  // 2026-09-27: a tenant renting more than one room, paid together in a single transfer, so
  // the same bank code is verified onto each room's payment) is direct, deliberate proof
  // they belong to the same transfer - stronger evidence than tenancy/name/location alone,
  // so it groups even across different rooms or tenancies for the same tenant. Equal amounts
  // are only disqualifying within the SAME room+invoice (a genuine duplicate-charge risk,
  // e.g. an accidental double-save) - different rooms/invoices with equal amounts are
  // unambiguous, since each payment already links to its own invoice regardless of the
  // order the bank line's balance is applied in.
  if(refCode.length>=4 && /\d/.test(refCode) && payments.every(p=>normalizedRef(p)===refCode)) {
    const seenAmountsByRoomInvoice=new Map<string,Set<number>>();
    for(const p of payments) {
      const key=`${(p.propertyCode?.trim().toUpperCase()||p.property)} ${p.room}::${p.invoiceId??p.id}`;
      const seen=seenAmountsByRoomInvoice.get(key)??new Set<number>();
      if(seen.has(cents(p.amount))) return false;
      seen.add(cents(p.amount));
      seenAmountsByRoomInvoice.set(key,seen);
    }
    return payments.every(p=>name(p.tenant)===name(payments[0].tenant));
  }
  const amounts=payments.map(p=>cents(p.amount));
  if(new Set(amounts).size!==amounts.length) return false;
  const [first,...rest]=payments;
  if(first.tenancyId && payments.every(p=>p.tenancyId)) return rest.every(p=>p.tenancyId===first.tenancyId);
  const location=(p:ExistingPayment)=>`${(p.propertyCode?.trim().toUpperCase()||p.property)} ${p.room}`;
  return rest.every(p=>name(p.tenant)===name(first.tenant) && location(p)===location(first));
}
