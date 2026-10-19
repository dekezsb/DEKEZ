"use client";
import { useActionState } from "react";
import { matchRenovationPayment, submitRenovationPayment, verifyRenovationPayment } from "@/app/renovation/actions";
import { money, type RenovationPayment } from "@/lib/renovation/model";
const field = "block w-full rounded border border-slate-300 bg-white px-3 py-2";
const button = "rounded bg-[#b58a2a] px-4 py-2 font-semibold text-white disabled:opacity-50";
export type BankOption = { id: string; name: string };
export type BankLineOption = { id: string; bank_account_id: string; transaction_date: string; description: string; reference_number: string | null; remaining: number };
export function PaymentUpload({ invoiceId, banks, today, outstanding }: { invoiceId: string; banks: BankOption[]; today: string; outstanding: number }) {
  const [state, action, pending] = useActionState(submitRenovationPayment, {});
  return <details className="rounded-lg border bg-white p-4"><summary className="cursor-pointer font-semibold">+ Upload renovation payment / instalment</summary><form action={action} className="mt-4 grid gap-3 sm:grid-cols-2"><input type="hidden" name="invoice_id" value={invoiceId} />
    <label>Amount received (RM)<input name="amount" type="number" required min="0.01" max={outstanding} step="0.01" className={field} /></label><label>Payment date<input name="payment_date" type="date" required defaultValue={today} className={field} /></label>
    <label>Received into<select name="bank_account_id" required className={field}><option value="">Select company bank</option>{banks.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label><label>Bank code / reference<input name="reference_number" required minLength={3} maxLength={120} className={field} /></label>
    <label className="sm:col-span-2">Bank-in slip (JPG / PNG / PDF, up to 3 MB)<input name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required className={field} /></label>
    <p className="text-sm sm:col-span-2">Uploading proof does not mark this invoice paid. Verification is required. Rental payments are not affected.</p>
    {state.error && <p role="alert" className="text-red-700 sm:col-span-2">{state.error}</p>}<button className={button} disabled={pending}>{pending ? "Uploading…" : "Submit for verification"}</button>
  </form></details>;
}
function VerifyPayment({ payment }: { payment: RenovationPayment }) {
  const [state, action, pending] = useActionState(verifyRenovationPayment, {});
  return <form action={action} className="space-y-3 rounded border border-amber-300 bg-amber-50 p-3"><input type="hidden" name="payment_id" value={payment.id} /><input type="hidden" name="invoice_id" value={payment.invoice_id} />
    <label className="flex gap-2"><input name="confirm" value="yes" type="checkbox" /><span>I checked this slip and confirm {money(Number(payment.amount))} was received for this renovation invoice.</span></label>
    <label>Reason (required if rejecting)<input name="reason" className={field} maxLength={2000} /></label>
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}<div className="flex gap-3"><button className={button} name="decision" value="verify" disabled={pending}>Verify payment</button><button className="rounded border border-red-400 px-4 py-2 text-red-700" name="decision" value="reject" disabled={pending}>Reject</button></div>
  </form>;
}
function MatchPayment({ payment, lines }: { payment: RenovationPayment; lines: BankLineOption[] }) {
  const [state, action, pending] = useActionState(matchRenovationPayment, {});
  const options = lines.filter(l => l.bank_account_id === payment.bank_account_id && l.remaining > 0);
  return <form action={action} className="space-y-3 rounded border bg-slate-50 p-3"><input type="hidden" name="invoice_id" value={payment.invoice_id} /><input type="hidden" name="transaction_id" value={payment.bank_transaction_id ?? ""} />
    <p className="text-sm">Bank matched: {money(payment.matched ?? 0)} / {money(Number(payment.amount))}. Matching uses the smaller remaining amount and creates no new payment or income.</p>
    <label>Match to imported bank transaction<select name="line_id" className={field} required><option value="">Select same-bank money-in transaction</option>{options.map(l => <option key={l.id} value={l.id}>{l.transaction_date} · {money(l.remaining)} remaining · {l.reference_number ?? ""} · {l.description}</option>)}</select></label>
    {!options.length && <p className="text-sm">No open money-in lines for this bank. Import the statement in Accounting first.</p>}
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}<button className={button} disabled={pending || !options.length}>Match verified payment</button>
  </form>;
}
export function PaymentCard({ payment, lines, manage }: { payment: RenovationPayment; lines: BankLineOption[]; manage: boolean }) {
  return <section className="space-y-3 rounded-lg border bg-white p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{money(Number(payment.amount))} · {payment.status.toUpperCase()}</strong><span>{payment.payment_date} · Ref {payment.reference_number}</span></div>
    {payment.proofUrl ? <details><summary className="cursor-pointer font-semibold underline">View bank-in slip</summary><div className="mt-3 rounded border bg-slate-100 p-2">{payment.proof_path.endsWith(".pdf") ? <iframe title="Renovation bank-in slip" src={payment.proofUrl} className="h-[32rem] w-full" /> : <img alt="Renovation bank-in slip" src={payment.proofUrl} className="mx-auto max-h-[32rem] max-w-full object-contain" />}</div></details> : <p className="text-red-700">Proof preview unavailable. Do not verify until the slip can be reviewed.</p>}
    {payment.rejection_reason && <p>Rejection reason: {payment.rejection_reason}</p>}
    {manage && payment.status === "pending" && payment.proofUrl && <VerifyPayment payment={payment} />}
    {payment.status === "verified" && (Number(payment.amount) - (payment.matched ?? 0) < 0.005 ? <p className="font-semibold text-emerald-700">Fully matched to bank statement</p> : manage ? <MatchPayment payment={payment} lines={lines} /> : <p>Bank matching outstanding: {money(Number(payment.amount) - (payment.matched ?? 0))}</p>)}
  </section>;
}
