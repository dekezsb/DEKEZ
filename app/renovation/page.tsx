import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ClientForm, CatalogueForm } from "@/components/renovation/forms";
import { renovationContext } from "@/lib/renovation/server";
import { allReportRows } from "@/lib/accounting/report-data";
import { money, paymentSummary, renovationWorkspaceDocuments, documentStatus, type RenovationPayment, type RenovationDocument } from "@/lib/renovation/model";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";

export default async function RenovationPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; client?: string;from?:string;to?:string;status?:string;project?:string }> }) {
  const { db, company } = await renovationContext();
  const { access } = await getCurrentUserAccess();
  const manage = hasModuleAccess(access, "reports", "manage");
  const { q = "", kind = "all", client = "",from='',to='',status='',project='' } = await searchParams;
  const { data, error } = await allReportRows(db.from("renovation_documents").select("*").eq("company_id", company.id));
  const paymentRows = error ? { data: [], error: null } : await allReportRows(db.from("renovation_payment_submissions").select("invoice_id,amount,status").eq("company_id", company.id));
  if (paymentRows.error) throw new Error("Could not load renovation outstanding balances.");
  const allDocuments = data as RenovationDocument[];
  const folders = [...new Map(allDocuments.map(d => [d.client_id, d.client_snapshot.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const clientName = folders.find(([id]) => id === client)?.[1];
  const workspaceDocuments = renovationWorkspaceDocuments(allDocuments, client);
  const invoiceIds = new Set(workspaceDocuments.filter(d => d.kind === "invoice" && d.status === "issued").map(d => d.id));
  const payments = (paymentRows.data as RenovationPayment[]).filter(p => invoiceIds.has(p.invoice_id));
  const invoiceTotals = workspaceDocuments.filter(d => invoiceIds.has(d.id)).reduce((sum, d) => sum + Number(d.total), 0);
  const summary = paymentSummary(invoiceTotals, payments);
  const received=(d:RenovationDocument)=>paymentSummary(Number(d.total),payments.filter(p=>p.invoice_id===d.id)).verified;
  const documents = (client ? workspaceDocuments : allDocuments).filter(d => (kind === "all" || d.kind === kind) &&
    (!from||d.document_date>=from)&&(!to||d.document_date<=to)&&(!status||documentStatus(d,received(d))===status)&&d.project.toLowerCase().includes(project.toLowerCase())&&
    `${d.document_number ?? "draft"} ${d.client_snapshot.name} ${d.project} ${d.status}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const matchingClients = new Set(documents.map(d => d.client_id));
  const visibleFolders = folders.filter(([id]) => matchingClients.has(id));
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Renovation Quotations & Invoices</h1><p className="mt-1 text-slate-600">Client renovation jobs · General company income · Separate from rental invoices</p></div>{manage && !error && <Link className="rounded-lg bg-[#b58a2a] px-4 py-3 font-semibold text-white" href="/renovation/new">+ New quotation / invoice</Link>}</header>
    {error ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5">This section needs its renovation database migration before it can be used. No rental records have been changed.</div> : <>
      {client ? <section className="rounded-xl border bg-white p-5"><Link className="underline" href="/renovation">← Client folders</Link><h2 className="mt-3 text-xl font-bold">{clientName ? `${clientName} — Client folder` : "Client folder not found"}</h2><p className="mt-1 text-slate-600">Complete document history, including approved quotations retained for your records.</p></section> : <p className="text-sm text-slate-600">Open a client folder to view its quotations, invoices and payment records.</p>}
      <div className="grid gap-3 sm:grid-cols-3"><p className="rounded-xl border bg-white p-4">Renovation outstanding<strong className="block text-xl">{money(summary.outstanding)}</strong></p><p className="rounded-xl border bg-emerald-50 p-4">Renovation verified received<strong className="block text-xl">{money(summary.verified)}</strong></p><p className="rounded-xl border bg-amber-50 p-4">Renovation pending verification<strong className="block text-xl">{money(summary.pending)}</strong></p></div>
      {manage && <div className="grid gap-4 md:grid-cols-2"><details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer font-semibold">+ Add client</summary><div className="mt-4"><ClientForm id={randomUUID()} /></div></details><details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer font-semibold">+ Save / update reusable work item</summary><div className="mt-4"><CatalogueForm /></div></details></div>}
      {manage&&<Link className="inline-block underline" href="/renovation/items">Manage master Item Library →</Link>}
      <form className="flex flex-wrap gap-3">{client && <input type="hidden" name="client" value={client} />}<input name="q" aria-label="Search renovation documents" defaultValue={q} placeholder="Search client, project or document number" className="min-w-60 flex-1 rounded border px-3 py-2" /><select name="kind" aria-label="Document type" defaultValue={kind} className="rounded border px-3 py-2"><option value="all">{client ? "All client records" : "All documents"}</option><option value="quotation">Quotations</option><option value="invoice">Invoices</option></select>
      <input name="project" aria-label="Filter project" defaultValue={project} placeholder="Project" className="rounded border px-3 py-2"/><label>From <input aria-label="Document date from" type="date" name="from" defaultValue={from} className="rounded border p-2"/></label><label>To <input aria-label="Document date to" type="date" name="to" defaultValue={to} className="rounded border p-2"/></label>
      <select name="status" aria-label="Document status" defaultValue={status} className="rounded border p-2"><option value="">All statuses</option>{['draft','sent','accepted','rejected','issued','partially_paid','paid','voided','superseded'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select><button className="rounded border px-4 py-2">Search</button></form>
      {client && <div className="space-y-3">{documents.map(d => <Link href={`/renovation/${d.id}`} key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 hover:border-[#b58a2a]"><div><p className="font-semibold">{d.document_number ?? `Draft ${d.kind}`} <span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs uppercase">{documentStatus(d, received(d)).replaceAll('_', ' ')}</span></p><p>{d.client_snapshot.name} — {d.project}</p><p className="text-sm text-slate-500">{d.document_date}{Number(d.discount_amount) > 0 ? ` · Discount ${money(Number(d.discount_amount))}` : ""}</p></div><div className="text-right"><strong>{money(Number(d.total))}</strong>{d.kind === "invoice" && d.status === "issued" && <p className="text-sm">Outstanding {money(paymentSummary(Number(d.total), payments.filter(p => p.invoice_id === d.id)).outstanding)}</p>}</div></Link>)}{!documents.length && <p className="rounded-xl border bg-white p-8 text-center text-slate-600">No matching documents. Create your first renovation quotation above.</p>}</div>}
      {!client && <section className="rounded-xl border bg-white p-5"><h2 className="text-xl font-semibold">Client folders</h2><p className="mt-1 text-sm text-slate-600">Original quotations, revisions and invoices are kept here. Nothing is deleted.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{visibleFolders.map(([id, name]) => <Link key={id} href={`/renovation?client=${id}`} className="rounded-lg border p-4 hover:border-[#b58a2a]"><strong>{name}</strong><span className="mt-1 block text-sm underline">Open client records →</span></Link>)}</div>{!visibleFolders.length && <p className="mt-4 text-slate-600">No matching client folders.</p>}</section>}
    </>}
  </div>;
}
