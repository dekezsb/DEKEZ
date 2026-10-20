import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { RenovationEditor } from "@/components/renovation/editor";
import { renovationContext, renovationDocument, renovationLists } from "@/lib/renovation/server";
import { addDays, malaysiaToday } from "@/lib/renovation/model";

export default async function NewRenovationPage({ searchParams }: { searchParams: Promise<{ edit?: string; revise?: string; copy?: string; correct?:string }> }) {
  const { db, company } = await renovationContext(true);
  const { edit, revise, copy, correct } = await searchParams;
  const sourceId = edit || revise || copy || correct;
  const document = sourceId ? await renovationDocument(sourceId) : null;
  if (sourceId && !document) notFound();
  if (edit && document?.status !== "draft") redirect(`/renovation/${edit}`);
  if(correct&&(document?.kind!=='invoice'||document.status!=='issued'))redirect(`/renovation/${correct}`);
  if (revise) {
    if (document?.kind !== "quotation" || document.status !== "issued") redirect(`/renovation/${revise}`);
    const { data: revision, error } = await db.from("renovation_documents").select("id").eq("company_id", company.id).eq("revision_of_id", revise).maybeSingle();
    if (error) throw new Error("Could not check existing quotation revision.");
    if (revision) redirect(`/renovation/new?edit=${revision.id}`);
  }
  const lists = await renovationLists();
  const initial = copy && document ? { ...document, id: "",client_id:'',client_snapshot:{name:'',phone:'',email:'',address:''}, status: "draft" as const, version: 0, document_date: malaysiaToday(), due_date: addDays(malaysiaToday(), 30), revision_of_id: null, source_quotation_id: null } : document;
  return <div className="mx-auto max-w-5xl space-y-5"><Link className="underline" href="/renovation">← Renovation documents</Link>
    <h1 className="text-2xl font-bold">{correct?'Correct issued invoice':edit ? "Edit draft" : revise ? "Revise quotation" : "New renovation quotation / invoice"}</h1>
    {revise && <p className="rounded border border-amber-300 bg-amber-50 p-4">The original remains intact. Issuing this revision replaces the original for future approval; it cannot then be invoiced separately.</p>}
    {!lists.clients.length ? <p className="rounded border bg-white p-5">First <Link href="/renovation" className="font-semibold underline">add a client</Link>, then return here to select work items.</p> : <RenovationEditor id={edit ?? correct ?? randomUUID()} today={malaysiaToday()} clients={lists.clients} catalogue={lists.catalogue} taxAccounts={lists.taxAccounts} document={initial ?? undefined} revisionOf={revise} correction={Boolean(correct)} />}
  </div>;
}
