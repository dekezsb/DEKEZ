import Link from "next/link";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";
import { renovationPaymentData } from "@/lib/renovation/payments";
import { money } from "@/lib/renovation/model";
import { MatchPayment } from "@/components/renovation/payments";
import { ReceiptViewer } from "@/app/payment-verification/receipt-viewer";

export async function RenovationBankReconciliation({ statementIds, bankAccountId, locked, returnTo }: {
  statementIds: string[]; bankAccountId: string; locked: boolean; returnTo: string;
}) {
  const { access } = await getCurrentUserAccess();
  const manage = hasModuleAccess(access, "reports", "manage");
  const data = await renovationPaymentData(undefined, statementIds);
  const invoices = new Map(data.invoices.map(d => [d.id, d]));
  const payments = data.payments.filter(p => p.status === "verified" && p.bank_transaction_id && p.bank_account_id === bankAccountId && Number(p.amount) - (p.matched ?? 0) > 0.005);
  return <section id="renovation-reconciliation" className="scroll-mt-6 space-y-4 rounded-xl border border-purple-200 bg-white p-5">
    <h2 className="text-xl font-semibold">Renovation · verified receipts to reconcile</h2>
    <p className="text-sm text-slate-600">General-company receipts for this bank. Match against this statement using the smaller remaining balance. Payments stay verified; no new payment or income is created. Completed receipts leave this queue.</p>
    {payments.map(payment => { const invoice = invoices.get(payment.invoice_id); return <article key={payment.id} className="space-y-3 rounded border border-purple-200 bg-purple-50 p-4">
      <h3 className="font-semibold">{invoice?.client_snapshot.name ?? "Client"} · {money(Number(payment.amount))} · Ref {payment.reference_number}</h3>
      <Link className="block underline" href={`/renovation/${payment.invoice_id}`}>{invoice?.document_number ?? "Open invoice"} · {invoice?.project}</Link>
      <p>Payment date: {payment.payment_date} · Remaining to match: {money(Number(payment.amount) - (payment.matched ?? 0))}</p>
      {payment.proofUrl && <ReceiptViewer url={payment.proofUrl} isImage={!payment.proof_path.endsWith(".pdf")} label="Verified renovation receipt" thumbnail={false} />}
      {manage && !locked ? <MatchPayment payment={payment} lines={data.lines} returnTo={returnTo} /> : <p>{locked ? "This statement is locked." : "Bank matching requires accounting management permission."}</p>}
    </article>; })}
    {!payments.length && <p className="text-sm text-slate-600">No unmatched verified renovation receipts for this bank.</p>}
    <Link className="block text-sm underline" href="/verification?view=payments#renovation-payments">Pending slips must first be approved in Payment Verification →</Link>
  </section>;
}
