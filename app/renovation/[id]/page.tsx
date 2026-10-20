import Link from "next/link";
import { notFound } from "next/navigation";
import { IssueForm, CloseDocumentForm } from "@/components/renovation/forms";
import { RenovationPdfPreview } from "@/components/renovation/pdf-preview";
import { renovationContext, renovationDocument } from "@/lib/renovation/server";
import { malaysiaToday, money, paymentSummary, documentStatus, documentTotals, type RenovationDocument } from "@/lib/renovation/model";
import { allReportRows } from "@/lib/accounting/report-data";
import { renovationPaymentData } from "@/lib/renovation/payments";
import { PaymentCard, PaymentUpload } from "@/components/renovation/payments";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";

export default async function RenovationDetail({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<{version?:string}> }) {
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
  const amounts = documentTotals(d);
  const {data:events,error:historyError}=await allReportRows(db.from('accounting_audit_logs').select('id,action,before_data,after_data,reason,performed_by,performed_at').eq('company_id',company.id).eq('entity_type','renovation_document').eq('entity_id',id).order('performed_at',{ascending:false}));
  if(historyError)throw new Error('Could not load document version history.');
  const versions=new Map<number,RenovationDocument>();
  for(const event of events)for(const row of [event.after_data,event.before_data])if(row?.id===id&&Array.isArray(row.items)&&row.client_snapshot&&!versions.has(row.version))versions.set(row.version,row as RenovationDocument);
  versions.set(d.version,d);
  const requested=(await searchParams).version;
  const printed=requested?versions.get(Number(requested)):d;
  if(!printed)notFound();
  const historical=printed.version!==d.version;
  return <main className="min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
    <div className="mx-auto mb-5 max-w-[210mm] space-y-4 print:hidden"><div className="flex flex-wrap items-center gap-3"><Link href="/renovation" className="rounded border bg-white px-4 py-2">← Client folders</Link>{manage && d.status === "draft" && <Link className="underline" href={`/renovation/new?edit=${id}`}>Edit draft / discount</Link>}{manage && d.kind === "quotation" && d.status === "issued" && <Link className="underline" href={`/renovation/new?revise=${id}`}>Revise quotation / discount</Link>}{manage&&d.kind==='invoice'&&d.status==='issued'&&<Link className="underline" href={`/renovation/new?correct=${id}`}>Controlled invoice correction</Link>}{manage && <Link className="underline" href={`/renovation/new?copy=${id}`}>Copy for a new job</Link>}</div>
      <p>Status: <strong>{documentStatus(d,summary?.verified).replaceAll('_',' ')}</strong>{d.kind === "invoice" && d.status === "issued" ? " · Posted to general-company Renovation Service Income. No payment is implied." : ""}</p>
      <Link className="block underline" href={`/renovation?client=${d.client_id}`}>Open {d.client_snapshot.name}'s client folder</Link>
      <section className="space-y-3 rounded border bg-white p-4" aria-label="Renovation document amounts">
        <p>Customer: <strong>{d.client_snapshot.name}</strong></p><p>Project: <strong>{d.project}</strong></p>
        <div className="grid grid-cols-2 gap-3"><p>{d.kind === "invoice" ? "Invoice amount" : "Quotation amount"}<strong className="block">{money(amounts.subtotal / 100)}</strong></p><p>Discount<strong className="block">{money(amounts.discount / 100)}</strong></p>{amounts.tax > 0 && <p>Tax<strong className="block">{money(amounts.tax / 100)}</strong></p>}<p>{d.kind === "invoice" ? "Final invoice amount" : "Final quotation amount"}<strong className="block">{money(Number(d.total))}</strong></p></div>
      </section>
      {d.approval_name && <p className="rounded border bg-white p-3">Approval recorded for {d.approval_name}. Evidence: {d.approval_evidence}</p>}
      {d.source_quotation_id && <Link className="block underline" href={`/renovation/${d.source_quotation_id}`}>View original approved quotation</Link>}
      {d.revision_of_id && <Link className="block underline" href={`/renovation/${d.revision_of_id}`}>View previous quotation</Link>}
      {(children ?? []).map(child => <Link className="block underline" href={`/renovation/${child.id}`} key={child.id}>View {child.kind === "invoice" ? "converted invoice" : "quotation revision"}: {child.document_number ?? "draft"} ({child.status})</Link>)}
      {manage && <IssueForm document={d} today={malaysiaToday()} />}
      {manage&&<CloseDocumentForm document={d} today={malaysiaToday()}/>}
      <details className="rounded border bg-white p-4"><summary className="font-semibold">Document version history</summary><p className="my-2 text-sm">Current version: {d.version}. Earlier snapshots are read-only. Legacy changes may only have their original audit entry.</p><div className="flex flex-wrap gap-3">{[...versions.keys()].sort((a,b)=>b-a).map(version=><Link className="underline" key={version} href={`/renovation/${id}?version=${version}`}>View version {version}</Link>)}</div><ul className="mt-3 space-y-3 text-sm">{events.map(event=><li key={event.id}>{event.performed_at} · {event.action} · User {event.performed_by}<br/>{event.reason}</li>)}</ul></details>
      {paymentData && summary && <section className="space-y-4"><h2 className="text-xl font-bold">Renovation payments & outstanding</h2>
        <div className="grid grid-cols-2 gap-3"><p className="rounded border bg-emerald-50 p-3">Amount received<strong className="block">{money(summary.verified)}</strong></p><p className="rounded border bg-white p-3">Outstanding<strong className="block">{money(summary.outstanding)}</strong></p>{summary.pending > 0 && <p className="rounded border bg-amber-50 p-3">Pending verification (not received)<strong className="block">{money(summary.pending)}</strong></p>}</div>
        <p className="text-sm">Admin receipts are recorded immediately. Bank matching happens later in Bank Statement Reconciliation and does not reduce outstanding twice.</p>
        {manage && summary.outstanding > 0 && <PaymentUpload invoiceId={d.id} banks={paymentData.banks} today={malaysiaToday()} outstanding={summary.outstanding} />}
        {paymentData.payments.map(payment => <PaymentCard key={payment.id} payment={payment} manage={manage} />)}
      </section>}
    </div>
    {historical&&<p className="mx-auto mb-4 max-w-5xl rounded border border-amber-400 bg-amber-50 p-4">Historical version {printed.version}. Current payments are not included in this historical copy. <Link href={`/renovation/${id}`} className="underline">Return to current version</Link></p>}
    <RenovationPdfPreview key={`${id}-${printed.version}`} document={printed} manage={manage} payments={historical?undefined:summary??undefined} historical={historical}/>
  </main>;
}
