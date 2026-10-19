"use client";
import { startTransition, useActionState, useState } from "react";
import { saveDraft } from "@/app/renovation/actions";
import { addDays, defaultStages, defaultTerms, discountCents, lineCents, money, starterItems, totalCents,
  type CatalogueItem, type RenovationClient, type RenovationDocument, type WorkLine } from "@/lib/renovation/model";

const field = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-md border border-[#b58a2a] px-3 py-2 text-sm font-medium hover:bg-amber-50 disabled:opacity-50";
export function RenovationEditor({ id, today, clients, catalogue, document, revisionOf }: {
  id: string; today: string; clients: RenovationClient[]; catalogue: CatalogueItem[]; document?: RenovationDocument; revisionOf?: string;
}) {
  const [state, action, pending] = useActionState(saveDraft, {});
  const [kind, setKind] = useState(document?.kind ?? "quotation");
  const [clientId, setClientId] = useState(document?.client_id ?? clients[0]?.id ?? "");
  const [project, setProject] = useState(document?.project ?? "");
  const [site, setSite] = useState(document?.site_address ?? "");
  const [date, setDate] = useState(revisionOf ? today : document?.document_date ?? today);
  const [due, setDue] = useState(revisionOf ? addDays(today, 30) : document?.due_date ?? addDays(today, 30));
  const [items, setItems] = useState<WorkLine[]>(document?.items ?? []);
  const [stages, setStages] = useState(document?.stages ?? defaultStages);
  const [terms, setTerms] = useState(document?.terms ?? defaultTerms);
  const [discountKind, setDiscountKind] = useState<"amount" | "percent">(document?.discount_kind ?? "amount");
  const [discountValue, setDiscountValue] = useState(Number(document?.discount_value ?? 0));
  const [search, setSearch] = useState("");
  const subtotal = totalCents(items), discount = discountCents(subtotal, discountKind, discountValue), total = subtotal - discount;
  const choices = [...catalogue, ...starterItems.filter(s => !catalogue.some(c => c.description.toLowerCase() === s.description.toLowerCase()))]
    .filter(c => c.description.toLowerCase().includes(search.toLowerCase()));
  const change = (index: number, patch: Partial<WorkLine>) => setItems(previous => previous.map((line, i) => i === index ? { ...line, ...patch } : line));
  const payload = { kind, client_id: clientId, project, site_address: site, document_date: date, due_date: due,
    items, stages, terms, discount_kind: discountKind, discount_value: discountValue, revision_of_id: revisionOf ?? document?.revision_of_id ?? null };
  // Dispatch explicitly so React's successful-action reset cannot reset select
  // elements when the server returns validation errors instead of redirecting.
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="space-y-6">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={revisionOf ? 0 : document?.version ?? 0} />
    <input type="hidden" name="payload" value={JSON.stringify(payload)} />
    {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{state.error}</p>}
    <section className="grid gap-4 rounded-xl border bg-white p-5 sm:grid-cols-2">
      <label>Document type<select className={field} value={kind} disabled={Boolean(revisionOf || document?.revision_of_id)} onChange={e => setKind(e.target.value as typeof kind)}><option value="quotation">Renovation quotation</option><option value="invoice">Direct renovation invoice</option></select></label>
      <label>Client<select required className={field} value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>)}</select></label>
      <label className="sm:col-span-2">Project / scope title<input required maxLength={500} className={field} value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. Shoplot partition renovation" /></label>
      <label className="sm:col-span-2">Work site address<textarea maxLength={2000} className={field} value={site} onChange={e => setSite(e.target.value)} /></label>
      <label>Document date<input required className={field} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label>{kind === "quotation" ? "Valid until" : "Invoice due date"}<input required min={date} className={field} type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Click to add work items</h2>
      <p className="mb-3 text-sm text-slate-600">Saved prices are suggestions. Review the price and quantity for this job. Starter items have no preset price.</p>
      <input aria-label="Search work items" className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search partition, painting, wiring…" />
      <div className="my-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">{choices.map((item, i) => <button className={button} key={i} type="button" disabled={items.length >= 100} onClick={() => setItems([...items, { description: item.description, unit: item.unit, rate: Number(item.rate), quantity: 1 }])}>+ {item.description}</button>)}</div>
      <button className={button} type="button" disabled={items.length >= 100} onClick={() => setItems([...items, { description: "", quantity: 1, rate: 0, unit: "LOT" }])}>+ Custom work item</button>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Job items</h2>
      {!items.length && <p className="text-slate-500">Choose an item above to start your quotation.</p>}
      {items.map((item, index) => <div key={index} className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-4">
        <label className="sm:col-span-4">{index + 1}. Description<textarea required maxLength={1000} className={field} value={item.description} onChange={e => change(index, { description: e.target.value })} /></label>
        <label>Quantity<input required className={field} type="number" min="0.001" max="1000000" step="0.001" value={item.quantity} onChange={e => change(index, { quantity: Number(e.target.value) })} /></label>
        <label>Unit<input required maxLength={30} className={field} value={item.unit} onChange={e => change(index, { unit: e.target.value })} /></label>
        <label>Unit price (RM)<input required className={field} type="number" min="0" max="9999999.99" step="0.01" value={item.rate} onChange={e => change(index, { rate: Number(e.target.value) })} /></label>
        <div><span className="block">Amount</span><strong>{money(lineCents(item) / 100)}</strong><button aria-label={`Remove item ${index + 1}`} className="ml-3 text-sm text-red-700 underline" type="button" onClick={() => setItems(items.filter((_, i) => i !== index))}>Remove</button></div>
      </div>)}
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
        <label>Discount type<select className={field} value={discountKind} onChange={e => setDiscountKind(e.target.value as typeof discountKind)}><option value="amount">Fixed amount (RM)</option><option value="percent">Percentage (%)</option></select></label>
        <label>Discount<input className={field} required type="number" min="0" max={discountKind === "percent" ? "99.99" : Math.max(0, subtotal / 100 - 0.01)} step="0.01" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} /></label>
        <div className="text-right"><p>Subtotal {money(subtotal / 100)}</p><p>Discount −{money(discount / 100)}</p><p className="text-xl font-bold">Total {money(total / 100)}</p></div>
      </div>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Payment stages</h2>
      {stages.map((stage, index) => <div key={index} className="flex items-end gap-3"><label className="flex-1">Stage<input required maxLength={200} className={field} value={stage.label} onChange={e => setStages(stages.map((s, i) => i === index ? { ...s, label: e.target.value } : s))} /></label><label className="w-24">Percent<input required className={field} type="number" min="0.01" max="100" step="0.01" value={stage.percent} onChange={e => setStages(stages.map((s, i) => i === index ? { ...s, percent: Number(e.target.value) } : s))} /></label><button aria-label={`Remove payment stage ${index + 1}`} type="button" className={button} onClick={() => setStages(stages.filter((_, i) => i !== index))}>Remove</button></div>)}
      <button className={button} type="button" disabled={stages.length >= 10} onClick={() => setStages([...stages, { label: "", percent: 0 }])}>+ Payment stage</button><p className="text-sm">Percentages must total 100%. Stage amounts use the total after discount.</p>
      <label className="block">Terms & conditions (one per line)<textarea required className={`${field} min-h-48`} maxLength={15000} value={terms} onChange={e => setTerms(e.target.value)} /></label>
    </section>
    <p className="text-sm text-slate-600">Saving a draft does not record income or payment. You can review the printable document before issuing it.</p>
    <button type="submit" className="rounded-lg bg-[#b58a2a] px-6 py-3 font-semibold text-white disabled:opacity-50" disabled={pending || !clientId || !items.length || total <= 0}>{pending ? "Saving…" : "Save draft & preview"}</button>
  </form>;
}
