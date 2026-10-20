import { bankReferenceMatches } from "@/lib/accounting/tenant-reconciliation";
import type { RenovationPayment } from "./model";
import type { BankLineOption } from "@/components/renovation/payments";

export function renovationBulkCandidates(payments: RenovationPayment[], lines: BankLineOption[]) {
  const remaining = new Map(payments.map(p => [p.id, Math.round((Number(p.amount) - (p.matched ?? 0)) * 100)]));
  return [...lines].sort((a,b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id)).flatMap(line => {
    if (line.blocked || line.transaction_date < "2026-09-01" || line.remaining <= 0.005) return [];
    const candidates = payments.filter(p => p.status === "verified" && p.bank_transaction_id && p.bank_account_id === line.bank_account_id
      && (remaining.get(p.id) ?? 0) > 0 && p.payment_date.slice(0,7) === line.transaction_date.slice(0,7)
      && !line.matchedSourceIds?.includes(p.bank_transaction_id)
      && bankReferenceMatches({id:line.id,amount:line.remaining,date:line.transaction_date,reference:line.reference_number ?? "",description:line.description,used:false},p.reference_number));
    if (candidates.length !== 1) return [];
    const payment = candidates[0];
    const cents = Math.min(remaining.get(payment.id)!, Math.round(line.remaining * 100));
    remaining.set(payment.id,remaining.get(payment.id)! - cents);
    return [{paymentId:payment.id,transactionId:payment.bank_transaction_id!,lineId:line.id,reference:payment.reference_number,amount:cents/100,date:line.transaction_date}];
  });
}
