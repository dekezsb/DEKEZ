import { randomUUID } from "node:crypto";
import Link from "next/link";
import { ClientForm, CatalogueForm } from "@/components/renovation/forms";
import { renovationContext } from "@/lib/renovation/server";
import { allReportRows } from "@/lib/accounting/report-data";
import { money, paymentSummary, type RenovationPayment, type RenovationDocument } from "@/lib/renovation/model";
import { getCurrentUserAccess } from "@/lib/auth/session";
import { hasModuleAccess } from "@/lib/auth/access";

export default async function RenovationPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string }> }) {
  const { db, company } = await renovationContext();
  const { access } = await getCurrentUserAccess();
  const manage = hasModuleAccess(access, "reports", "manage");
  const { q = "", kind = "all" } = await searchParams;
  const { data, error } = await allReportRows(db.from("renovation_documents").select("*").eq("company_id", company.id));
  const paymentRows = error ? { data: [], error: null } : await allReportRows(db.from("renovation_payment_submissions").select("invoice_id,amount,status").eq("company_id", company.id));
  if (paymentRows.error) throw new Error("Could not load renovation outstanding balances.");
  const payments = paymentRows.data as RenovationPayment[];
  const invoiceTotals = (data as RenovationDocument[]).filter(d => d.kind === "invoice" && d.status === "issued").reduce((sum, d) => sum + Number(d.total), 0);
  const summary = paymentSummary(invoiceTotals, payments);
  const documents = (data as RenovationDocument[]).filter(d => (kind === "all" || d.kind === kind) &&
    `${d.document_number ?? "draft"} ${d.client_snapshot.name} ${d.project} ${d.status}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Renovation Quotations & Invoices</h1><p className="mt-1 text-slate-600">Client renovation jobs · General company income · Separate from rental invoices</p></div>{manage && !error && <Link className="rounded-lg bg-[#b58a2a] px-4 py-3 font-semibold text-white" href="/renovation/new">+ New quotation / invoice</Link>}</header>
    {error ? <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5">This section needs its renovation database migration before it can be used. No rental records have been changed.</div> : <>
      <div className="grid gap-3 sm:grid-cols-3"><p className="rounded-xl border bg-white p-4">Renovation outstanding<strong className="block text-xl">{money(summary.outstanding)}</strong></p><p className="rounded-xl border bg-emerald-50 p-4">Renovation verified received<strong className="block text-xl">{money(summary.verified)}</strong></p><p className="rounded-xl border bg-amber-50 p-4">Renovation pending verification<strong className="block text-xl">{money(summary.pending)}</strong></p></div>
      {manage && <div className="grid gap-4 md:grid-cols-2"><details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer font-semibold">+ Add client</summary><div className="mt-4"><ClientForm id={randomUUID()} /></div></details><details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer font-semibold">+ Save / update reusable work item</summary><div className="mt-4"><CatalogueForm /></div></details></div>}
      <form className="flex flex-wrap gap-3"><input name="q" aria-label="Search renovation documents" defaultValue={q} placeholder="Search client, project or document number" className="min-w-60 flex-1 rounded border px-3 py-2" /><select name="kind" aria-label="Document type" defaultValue={kind} className="rounded border px-3 py-2"><option value="all">All documents</option><option value="quotation">Quotations</option><option value="invoice">Invoices</option></select><button className="rounded border px-4 py-2">Search</button></form>
      <div className="space-y-3">{documents.map(d => <Link href={`/renovation/${d.id}`} key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-5 hover:border-[#b58a2a]"><div><p className="font-semibold">{d.document_number ?? `Draft ${d.kind}`} <span className="ml-2 rounded bg-slate-100 px-2 py-1 text-xs uppercase">{d.status}</span></p><p>{d.client_snapshot.name} — {d.project}</p><p className="text-sm text-slate-500">{d.document_date}{Number(d.discount_amount) > 0 ? ` · Discount ${money(Number(d.discount_amount))}` : ""}</p></div><div className="text-right"><strong>{money(Number(d.total))}</strong>{d.kind === "invoice" && d.status === "issued" && <p className="text-sm">Outstanding {money(paymentSummary(Number(d.total), payments.filter(p => p.invoice_id === d.id)).outstanding)}</p>}</div></Link>)}{!documents.length && <p className="rounded-xl border bg-white p-8 text-center text-slate-600">No matching documents. Create your first renovation quotation above.</p>}</div>
    </>}
  </div>;
}
