"use client";
import { useActionState } from "react";
import { issueDocument, saveCatalogueItem, saveClient, closeRenovationDocument } from "@/app/renovation/actions";
import { addDays, type RenovationDocument, type CatalogueItem } from "@/lib/renovation/model";
const field = "block w-full rounded border border-slate-300 px-3 py-2";
const button = "rounded bg-[#b58a2a] px-4 py-2 font-semibold text-white disabled:opacity-50";
export function ClientForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(saveClient, {});
  return <form action={action} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="id" value={id} />
    <label>Client / company name<input className={field} name="name" required maxLength={200} /></label><label>Phone<input className={field} name="phone" maxLength={50} /></label>
    <label>Email<input className={field} name="email" type="email" maxLength={254} /></label><label>Billing address<textarea className={field} name="address" maxLength={2000} /></label>
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}<button className={button} disabled={pending}>{pending ? "Saving…" : "Save client & start document"}</button>
  </form>;
}
export function CatalogueForm({item}:{item?:CatalogueItem}) {
  const [state, action, pending] = useActionState(saveCatalogueItem, {});
  return <form action={action} className="space-y-3">
    <input type="hidden" name="id" value={item?.id??''}/><input type="hidden" name="version" value={item?.version??0}/>
    <label className="block">Item code<input className={field} name="item_code" required maxLength={80} defaultValue={item?.item_code}/></label>
    <label className="block">Category<input className={field} name="category" maxLength={100} defaultValue={item?.category}/></label>
    <label className="block">English description<textarea className={field} name="description" required maxLength={1000} defaultValue={item?.description}/></label>
    <label className="block">Malay description (optional)<textarea className={field} name="description_ms" maxLength={1000} defaultValue={item?.translations?.ms}/></label>
    <label className="block">Chinese description (optional)<textarea className={field} name="description_zh" maxLength={1000} defaultValue={item?.translations?.zh}/></label>
    <label className="block">Unit<input className={field} name="unit" required maxLength={30} placeholder="LOT / SQ FT / SET / POINT" defaultValue={item?.unit}/></label>
    <label className="block">Default selling price (RM)<input className={field} name="rate" required type="number" min="0" max="9999999.99" step="0.01" defaultValue={item?.rate??0}/></label>
    <label className="block">Cost price (RM, optional)<input className={field} name="cost_price" type="number" min="0" max="9999999.99" step="0.01" defaultValue={item?.cost_price??''}/></label>
    <label className="block">Availability<select className={field} name="active" defaultValue={item?.active===false?'false':'true'}><option value="true">Active</option><option value="false">Inactive</option></select></label>
    {item&&<label className="flex gap-2"><input type="checkbox" required name="confirm_update" value="yes"/>Update this master item explicitly. Existing documents stay unchanged.</label>}
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}<button className={button} disabled={pending}>{item?'Update master item':'Save new master item'}</button></form>;
}

export function CloseDocumentForm({document:d,today}:{document:RenovationDocument;today:string}) {
  const [state,action,pending]=useActionState(closeRenovationDocument,{});
  if(d.status!=='issued')return null;
  return <details className="rounded border bg-white p-4"><summary>{d.kind==='quotation'?'Record rejection':'Void unpaid invoice'}</summary><form action={action} className="mt-3 space-y-3">
    <input type="hidden" name="id" value={d.id}/><input type="hidden" name="version" value={d.version}/>
    <label className="block">Reason<textarea name="reason" required minLength={10} maxLength={2000} className={field}/></label>
    <label className="block">Posting date<input name="posting_date" type="date" required defaultValue={today} className={field}/></label>
    <label className="flex gap-2"><input name="confirm" value="yes" type="checkbox" required/>I confirm. The original document and audit history will remain. Invoices with receipts cannot be voided here.</label>
    {state.error&&<p role="alert">{state.error}</p>}<button className={button} disabled={pending}>{d.kind==='quotation'?'Record rejection':'Confirm void'}</button>
  </form></details>;
}
export function IssueForm({ document, today }: { document: RenovationDocument; today: string }) {
  const [state, action, pending] = useActionState(issueDocument, {});
  const approving = document.kind === "quotation" && document.status === "issued";
  if (document.status !== "draft" && !approving) return null;
  return <form action={action} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-5 print:hidden">
    <input type="hidden" name="id" value={document.id} /><input type="hidden" name="version" value={document.version} />
    <h2 className="text-lg font-semibold">{approving ? "Record client approval → create invoice" : `Issue ${document.kind}`}</h2>
    {approving && <><input type="hidden" name="approve" value="yes" /><label className="block">Approved by (client name)<input name="approval_name" required maxLength={200} className={field} /></label>
      <label className="block">Approval evidence / reference<textarea name="approval_evidence" required minLength={10} maxLength={2000} className={field} placeholder="e.g. Client accepted by WhatsApp on 19/10/2026; signed quotation filed under…" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>Invoice date<input type="date" name="invoice_date" required defaultValue={today} className={field} /></label><label>Invoice due date<input type="date" name="due_date" required defaultValue={addDays(today, 30)} className={field} /></label></div>
      <p className="text-sm">This records approval you received. It does not collect an online client signature. The original quotation remains available.</p></>}
    <label className="flex items-start gap-2"><input type="checkbox" name="confirm" value="yes" required className="mt-1" /><span>{approving ? "I have received the client's approval for this exact quotation and discount." : "I have checked the client, scope, prices, discount, dates and terms."}</span></label>
    <p className="text-sm">{approving || document.kind === "invoice" ? "This posts one invoice to General Company / Renovation Service Income and client receivables. It does not mark payment received." : "This allocates a quotation number. No income or payment will be recorded. To negotiate changes later, use Revise quotation."}</p>
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}<button className={button} disabled={pending}>{pending ? "Processing…" : approving ? "Confirm approval & create invoice" : `Issue ${document.kind}`}</button>
  </form>;
}
