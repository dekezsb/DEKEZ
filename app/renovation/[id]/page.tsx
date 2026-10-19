import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoicePrintButton } from "@/components/invoices/invoice-print-button";
import { IssueForm } from "@/components/renovation/forms";
import { RenovationPrintDocument } from "@/components/renovation/print-document";
import { renovationContext, renovationDocument } from "@/lib/renovation/server";
import { malaysiaToday, money, paymentSummary } from "@/lib/renovation/model";
import { renovationPaymentData } from "@/lib/renovation/payments";
import { PaymentCard, PaymentUpload } from "@/components/renovation/payments";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";

export default async function RenovationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await renovationDocument(id);
  if (!d) notFound();
  const { access } = await getCurrentUserAccess();
  const manage = hasModuleAccess(access, "reports", "manage");
  const { db, company } = await renovationContext();
  const { data: children, error } = await db.from("renovation_documents").select("id,kind,status,document_number").eq("company_id", company.id).or(`source_quotation_id.eq.${id},revision_of_id.eq.${id}`);
  if (error) throw new Error("Could not load linked renovation documents.");
  const paymentData = d.kind === "invoice" && d.status === "issued" ? await renovationPaymentData(d.id) : null;
  const summary = paymentData ? paymentSummary(Number(d.total), paymentData.payments) : null;
  return <main className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
    <div className="mx-auto mb-5 max-w-[210mm] space-y-4 print:hidden"><div className="flex flex-wrap items-center gap-3"><Link href="/renovation" className="rounded border bg-white px-4 py-2">← Renovation documents</Link><InvoicePrintButton />{manage && d.status === "draft" && <Link className="underline" href={`/renovation/new?edit=${id}`}>Edit draft / discount</Link>}{manage && d.kind === "quotation" && d.status === "issued" && <Link className="underline" href={`/renovation/new?revise=${id}`}>Revise quotation / discount</Link>}{manage && <Link className="underline" href={`/renovation/new?copy=${id}`}>Copy for a new job</Link>}</div>
      <p>Status: <strong>{d.status}</strong>{d.kind === "invoice" && d.status === "issued" ? " · Posted to general-company Renovation Service Income. No payment is implied." : ""}</p>
      <Link className="block underline" href={`/renovation?client=${d.client_id}`}>Open {d.client_snapshot.name}'s client folder</Link>
      {d.approval_name && <p className="rounded border bg-white p-3">Approval recorded for {d.approval_name}. Evidence: {d.approval_evidence}</p>}
      {d.source_quotation_id && <Link className="block underline" href={`/renovation/${d.source_quotation_id}`}>View original approved quotation</Link>}
      {d.revision_of_id && <Link className="block underline" href={`/renovation/${d.revision_of_id}`}>View previous quotation</Link>}
      {(children ?? []).map(child => <Link className="block underline" href={`/renovation/${child.id}`} key={child.id}>View {child.kind === "invoice" ? "converted invoice" : "quotation revision"}: {child.document_number ?? "draft"} ({child.status})</Link>)}
      {manage && <IssueForm document={d} today={malaysiaToday()} />}
      {paymentData && summary && <section className="space-y-4"><h2 className="text-xl font-bold">Renovation payments & outstanding</h2>
        <div className="grid grid-cols-2 gap-3"><p className="rounded border bg-white p-3">Invoice after discount<strong className="block">{money(Number(d.total))}</strong></p><p className="rounded border bg-emerald-50 p-3">Verified received<strong className="block">{money(summary.verified)}</strong></p><p className="rounded border bg-amber-50 p-3">Pending verification<strong className="block">{money(summary.pending)}</strong></p><p className="rounded border bg-white p-3">Outstanding<strong className="block">{money(summary.outstanding)}</strong></p></div>
        <p className="text-sm">Outstanding excludes only verified payments. Bank matching is tracked separately; it does not reduce the balance twice.</p>
        {manage && summary.outstanding > 0 && <PaymentUpload invoiceId={d.id} banks={paymentData.banks} today={malaysiaToday()} outstanding={summary.outstanding} />}
        {paymentData.payments.map(payment => <PaymentCard key={payment.id} payment={payment} lines={paymentData.lines} manage={manage} />)}
      </section>}
    </div>
    <RenovationPrintDocument document={d} payments={summary ?? undefined} />
  </main>;
}
