"use client";
import { useActionState } from "react";
import { issueDocument, saveCatalogueItem, saveClient } from "@/app/renovation/actions";
import { addDays, type RenovationDocument } from "@/lib/renovation/model";
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
export function CatalogueForm() {
  const [state, action, pending] = useActionState(saveCatalogueItem, {});
  return <form action={action} className="space-y-3"><label>Description<input className={field} name="description" required maxLength={1000} /></label>
    <label>Unit<input className={field} name="unit" required maxLength={30} placeholder="LOT / SQ FT / SET / POINT" /></label><label>Default unit price (RM)<input className={field} name="rate" required type="number" min="0" max="9999999.99" step="0.01" defaultValue="0" /></label>
    <p className="text-sm">Saving the same description and unit updates its suggested price. Existing documents are unchanged.</p>
    {state.error && <p role="alert" className="text-red-700">{state.error}</p>}<button className={button} disabled={pending}>Save work item</button></form>;
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
