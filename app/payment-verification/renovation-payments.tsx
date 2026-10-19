import Link from "next/link";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";
import { renovationPaymentData } from "@/lib/renovation/payments";
import { money, renovationWorkflowReturnTo } from "@/lib/renovation/model";
import { VerifyPayment } from "@/components/renovation/payments";
import { ReceiptViewer } from "./receipt-viewer";

export async function RenovationPaymentVerification({ params, returnTo }: {
  params: { renovation_status?: string; renovation_q?: string; [key: string]: string | undefined };
  returnTo: string;
}) {
  const { access, role } = await getCurrentUserAccess();
  if (!["super_admin", "admin"].includes(role) || !hasModuleAccess(access, "reports", "view") || !hasModuleAccess(access, "verification", "view")) return null;
  const manage = hasModuleAccess(access, "reports", "manage") && hasModuleAccess(access, "verification", "manage");
  const data = await renovationPaymentData();
  const invoices = new Map(data.invoices.map(d => [d.id, d]));
  const banks = new Map(data.banks.map(b => [b.id, b.name]));
  const status = ["pending", "verified", "rejected", "all"].includes(params.renovation_status ?? "") ? params.renovation_status! : "pending";
  const query = params.renovation_q?.trim().toLowerCase() ?? "";
  const payments = data.payments.filter(p => {
    const invoice = invoices.get(p.invoice_id);
    return (status === "all" || p.status === status) && `${invoice?.client_snapshot.name ?? ""} ${invoice?.document_number ?? ""} ${invoice?.project ?? ""} ${p.reference_number}`.toLowerCase().includes(query);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const path = returnTo.startsWith("/verification?") ? "/verification" : "/payment-verification";
  const destination = renovationWorkflowReturnTo(`${path}?${search}`, "verification");
  const pending = data.payments.filter(p => p.status === "pending");
  return <section id="renovation-payments" className="scroll-mt-6 space-y-4 rounded-xl border border-purple-200 bg-white p-5">
    <div><h2 className="text-xl font-semibold">Renovation payment verification</h2><p className="mt-1 text-sm text-slate-600">General-company client payments, separate from rental. Approve the existing slip here, then match its verified receipt in Bank Reconciliation.</p></div>
    <p className="rounded border border-amber-200 bg-amber-50 p-3">{pending.length} awaiting approval · {money(pending.reduce((sum, p) => sum + Number(p.amount), 0))} pending</p>
    <form method="get" action={`${path}#renovation-payments`} className="flex flex-wrap items-end gap-3">
      {path === "/verification" && <input type="hidden" name="view" value="payments" />}
      {["status", "property", "tenant", "month", "method"].map(key => params[key] ? <input type="hidden" key={key} name={key} value={params[key]} /> : null)}
      <label className="text-sm">Renovation status<select name="renovation_status" defaultValue={status} className="mt-1 block rounded border px-3 py-2"><option value="pending">Pending verification</option><option value="verified">Verified</option><option value="rejected">Rejected</option><option value="all">All</option></select></label>
      <label className="min-w-0 flex-1 text-sm">Client / invoice / reference<input name="renovation_q" defaultValue={params.renovation_q ?? ""} className="mt-1 block w-full rounded border px-3 py-2" /></label>
      <button className="rounded border px-4 py-2">Filter renovation slips</button>
    </form>
    {payments.map(payment => { const invoice = invoices.get(payment.invoice_id); return <article key={`${payment.id}:${payment.status}`} className="rounded-lg border border-purple-200 bg-purple-50 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
        <div className="space-y-3">
          {payment.proofUrl ? <ReceiptViewer url={payment.proofUrl} isImage={!payment.proof_path.endsWith(".pdf")} label={`Renovation · ${invoice?.client_snapshot.name ?? "Client"} · ${money(Number(payment.amount))}`} /> : <p role="alert">Slip unavailable. Do not verify until it can be reviewed.</p>}
          {manage && payment.status === "pending" && payment.proofUrl && <VerifyPayment payment={payment} returnTo={destination} />}
          {payment.status !== "pending" && <strong className="block uppercase">{payment.status}</strong>}
        </div>
        <div className="min-w-0 space-y-2 break-words"><span className="rounded bg-purple-800 px-2 py-1 text-xs font-bold text-white">RENOVATION CLIENT PAYMENT</span><h3 className="pt-2 text-lg font-semibold">{invoice?.client_snapshot.name ?? "Client"} · {money(Number(payment.amount))}</h3><Link className="underline" href={`/renovation/${payment.invoice_id}`}>{invoice?.document_number ?? "Open renovation invoice"}</Link><p>{invoice?.project}</p><p>Payment date: {payment.payment_date}</p><p>Bank: {banks.get(payment.bank_account_id) ?? "Company bank"}</p><p>Bank code / reference: <strong>{payment.reference_number}</strong></p>
          {payment.rejection_reason && <p>Rejection reason: {payment.rejection_reason}</p>}
          {payment.status === "verified" && <><p>Bank matched: {money(payment.matched ?? 0)} / {money(Number(payment.amount))}</p>{Number(payment.amount) - (payment.matched ?? 0) > 0.005 && <Link className="block underline" href="/reports?tab=bank&bankFlow=credit#renovation-reconciliation">Open Bank Reconciliation →</Link>}</>}
        </div>
      </div>
    </article>; })}
    {!payments.length && <p className="text-sm text-slate-600">No renovation slips for this filter. Already-approved receipts are under Verified.</p>}
  </section>;
}
