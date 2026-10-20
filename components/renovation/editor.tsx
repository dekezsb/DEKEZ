"use client";
import { startTransition, useActionState, useRef, useState } from "react";
import Link from "next/link";
import { saveDraft, saveCatalogueItem } from "@/app/renovation/actions";
import { addDays, defaultStages, defaultTerms, documentTotals, stageAmounts, lineCents, money, starterItems,
  type CatalogueItem, type RenovationClient, type RenovationDocument, type WorkLine } from "@/lib/renovation/model";

const field = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
const button = "rounded-md border border-[#b58a2a] px-3 py-2 text-sm font-medium hover:bg-amber-50 disabled:opacity-50";
export function RenovationEditor({ id, today, clients, catalogue, document, revisionOf, correction=false, taxAccounts=[] }: {
  id: string; today: string; clients: RenovationClient[]; catalogue: CatalogueItem[]; document?: RenovationDocument; revisionOf?: string; correction?:boolean; taxAccounts?:{id:string;code:string;name:string}[];
}) {
  const [state, action, pending] = useActionState(saveDraft, {});
  const [kind, setKind] = useState(document?.kind ?? "quotation");
  const [clientId, setClientId] = useState(document?.client_id ?? clients[0]?.id ?? "");
  const [customer,setCustomer]=useState(document?.client_snapshot??clients[0]??{name:'',phone:'',email:'',address:''});
  const [project, setProject] = useState(document?.project ?? "");
  const [site, setSite] = useState(document?.site_address ?? "");
  const [date, setDate] = useState(revisionOf ? today : document?.document_date ?? today);
  const [due, setDue] = useState(revisionOf ? addDays(today, 30) : document?.due_date ?? addDays(today, 30));
  const rowSequence = useRef(document?.items.length ?? 0);
  const nextRowKey = () => String(rowSequence.current++);
  const [items, setItems] = useState<(WorkLine & { editorKey: string })[]>(() => (document?.items ?? []).map((item, index) => ({ ...item, editorKey: String(index) })));
  const [stages, setStages] = useState(document?.stages ?? defaultStages);
  const [terms, setTerms] = useState(document?.terms ?? defaultTerms);
  const [remarks,setRemarks]=useState(document?.remarks??'');
  const [taxRate,setTaxRate]=useState(Number(document?.tax_rate??0)),[taxAccount,setTaxAccount]=useState(document?.tax_account_id??'');
  const [target,setTarget]=useState('');
  const [discountKind, setDiscountKind] = useState<"amount" | "percent">(document?.discount_kind ?? "amount");
  const [discountValue, setDiscountValue] = useState(Number(document?.discount_value ?? 0));
  const [search, setSearch] = useState("");
  const {subtotal,discount,tax,total}=documentTotals({items,discount_kind:discountKind,discount_value:discountValue,tax_rate:taxRate});
  const stageTotal=stages.reduce((sum,s)=>sum+Math.round(s.percent*100),0),amounts=stageAmounts(total,stages);
  const choices:Partial<CatalogueItem>[] = [...catalogue.filter(c=>c.active!==false), ...starterItems.filter(s => !catalogue.some(c => c.description.toLowerCase() === s.description.toLowerCase()))];
  const filtered=choices.filter(c=>`${c.item_code??''} ${c.category??''} ${c.description}`.toLowerCase().includes(search.toLowerCase()));
  const change = (index: number, patch: Partial<WorkLine>) => setItems(previous => previous.map((line, i) => i === index ? { ...line, ...patch } : line));
  const move=(index:number,offset:number)=>setItems(previous=>{const next=[...previous];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;});
  const payload = { kind, client_id: clientId, project, site_address: site, document_date: date, due_date: due,
    client_snapshot:{name:customer.name,phone:customer.phone,email:customer.email,address:customer.address},
    items: items.map(({ editorKey, ...line }) => line), stages, terms, remarks, tax_rate:taxRate,tax_account_id:taxRate>0?taxAccount:null, discount_kind: discountKind, discount_value: discountValue, revision_of_id: revisionOf ?? document?.revision_of_id ?? null };
  // Dispatch explicitly so React's successful-action reset cannot reset select
  // elements when the server returns validation errors instead of redirecting.
  return <form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="space-y-6">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={revisionOf ? 0 : document?.version ?? 0} />
    <input type="hidden" name="payload" value={JSON.stringify(payload)} />
    {state.error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800">{state.error}</p>}
    {correction&&<section className="space-y-3 rounded border border-amber-400 bg-amber-50 p-4"><input type="hidden" name="correction" value="yes"/><h2 className="font-bold">Controlled issued-invoice correction</h2><p>The original version and journal remain in history. Receipts and bank links remain unchanged. Only the financial difference is posted; the total cannot fall below payments received.</p><label className="block">Correction reason<textarea required minLength={10} maxLength={2000} name="reason" className={field}/></label><label className="block">Adjustment posting date<input type="date" name="posting_date" required defaultValue={today} className={field}/></label><label className="flex gap-2"><input type="checkbox" name="confirm" value="yes" required/>I have reviewed and approve this correction.</label></section>}
    <section className="grid gap-4 rounded-xl border bg-white p-5 sm:grid-cols-2">
      <label>Document type<select className={field} value={kind} disabled={Boolean(correction || revisionOf || document?.revision_of_id)} onChange={e => setKind(e.target.value as typeof kind)}><option value="quotation">Renovation quotation</option><option value="invoice">Direct renovation invoice</option></select></label>
      <label>Client<select required className={field} value={clientId} onChange={e => {setClientId(e.target.value);const next=clients.find(c=>c.id===e.target.value);if(next)setCustomer(next);}}><option value="">Select client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ""}</option>)}</select></label>
      <label>Customer name on document<input required maxLength={200} className={field} value={customer.name} onChange={e=>setCustomer({...customer,name:e.target.value})}/></label>
      <label>Customer phone<input maxLength={50} className={field} value={customer.phone} onChange={e=>setCustomer({...customer,phone:e.target.value})}/></label>
      <label>Customer email<input type="email" maxLength={254} className={field} value={customer.email} onChange={e=>setCustomer({...customer,email:e.target.value})}/></label>
      <label>Customer billing address<textarea maxLength={2000} className={field} value={customer.address} onChange={e=>setCustomer({...customer,address:e.target.value})}/></label>
      <p className="text-sm sm:col-span-2">Customer details are saved on this document only; other documents are unchanged.</p>
      <label className="sm:col-span-2">Project / scope title<input required maxLength={500} className={field} value={project} onChange={e => setProject(e.target.value)} placeholder="e.g. Shoplot partition renovation" /></label>
      <label className="sm:col-span-2">Work site address<textarea maxLength={2000} className={field} value={site} onChange={e => setSite(e.target.value)} /></label>
      <label>Document date<input required disabled={correction} className={field} type="date" value={date} onChange={e => setDate(e.target.value)} />{correction&&<small>Original issue date retained.</small>}</label>
      <label>{kind === "quotation" ? "Valid until" : "Invoice due date"}<input required min={date} className={field} type="date" value={due} onChange={e => setDue(e.target.value)} /></label>
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Click to add work items</h2>
      <Link href="/renovation/items" className="underline">Manage Item Library</Link>
      <p className="mb-3 text-sm text-slate-600">Saved prices are suggestions. Review the price and quantity for this job. Starter items have no preset price.</p>
      <input aria-label="Search work items" className={field} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search partition, painting, wiring…" />
      <div className="my-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">{filtered.map((item, i) => <button className={button} key={item.id??i} type="button" disabled={items.length >= 100} onClick={() => setItems([...items, { editorKey: nextRowKey(), description: item.description!, unit: item.unit!, rate: Number(item.rate), quantity: 1,item_code:item.item_code,catalogue_id:item.id,translations:item.translations?{...item.translations}:undefined,translation_source:item.description }])}>+ {item.description}</button>)}</div>
      <button className={button} type="button" disabled={items.length >= 100} onClick={() => setItems([...items, { editorKey: nextRowKey(), description: "", quantity: 1, rate: 0, unit: "LOT" }])}>+ Custom work item</button>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Job items</h2>
      {!items.length && <p className="text-slate-500">Choose an item above to start your quotation.</p>}
      <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr>{['NO.','DESCRIPTION','QTY','UNIT','UNIT PRICE (RM)','AMOUNT (RM)'].map(t=><th key={t} className="p-2 text-left">{t}</th>)}</tr></thead><tbody>
      {items.map((item,index)=><tr key={item.editorKey} className="border-t align-top"><td className="p-2">{index+1}</td><td className="min-w-64 p-2"><textarea aria-label={`${index+1}. Description`} required maxLength={1000} className={field} value={item.description} onChange={e=>change(index,{description:e.target.value})}/>{item.item_code&&<small>{item.item_code}</small>}<div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={index===0} aria-label={`Move item ${index+1} up`} onClick={()=>move(index,-1)}>↑</button><button type="button" className={button} disabled={index===items.length-1} aria-label={`Move item ${index+1} down`} onClick={()=>move(index,1)}>↓</button><button type="button" className={button} disabled={items.length>=100} aria-label={`Duplicate item ${index+1}`} onClick={()=>setItems([...items.slice(0,index+1),{...item,editorKey:nextRowKey(),translations:item.translations?{...item.translations}:undefined},...items.slice(index+1)])}>Duplicate</button><button type="button" className="text-red-700 underline" aria-label={`Remove item ${index+1}`} onClick={()=>setItems(items.filter((_,i)=>i!==index))}>Remove</button></div><SaveLineToLibrary key={item.editorKey} item={item} catalogue={catalogue}/></td>
        <td className="w-28 p-2"><input aria-label={items.length===1?'Quantity':`Quantity ${index+1}`} required className={field} type="number" min="0.001" max="1000000" step="0.001" value={item.quantity} onChange={e=>change(index,{quantity:Number(e.target.value)})}/></td><td className="w-28 p-2"><input aria-label={`Unit ${index+1}`} required maxLength={30} className={field} value={item.unit} onChange={e=>change(index,{unit:e.target.value})}/></td><td className="w-32 p-2"><input aria-label={`Unit price ${index+1}`} required className={field} type="number" min="0" max="9999999.99" step="0.01" value={item.rate} onChange={e=>change(index,{rate:Number(e.target.value)})}/></td><td className="p-2 text-right">{money(lineCents(item)/100)}</td></tr>)}
      </tbody></table></div>
      <div className="grid gap-3 border-t pt-4 sm:grid-cols-3">
        <label>Discount type<select className={field} value={discountKind} onChange={e => setDiscountKind(e.target.value as typeof discountKind)}><option value="amount">Fixed amount (RM)</option><option value="percent">Percentage (%)</option></select></label>
        <label>Discount<input className={field} required type="number" min="0" max={discountKind === "percent" ? "99.99" : Math.max(0, subtotal / 100 - 0.01)} step="0.01" value={discountValue} onChange={e => setDiscountValue(Number(e.target.value))} /></label>
        <label>Applicable tax (%)<input className={field} required type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e=>setTaxRate(Number(e.target.value))}/></label>
        {taxRate>0&&<label className="sm:col-span-3">Tax liability account<select required className={field} value={taxAccount} onChange={e=>setTaxAccount(e.target.value)}><option value="">Select the applicable existing account</option>{taxAccounts.map(a=><option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}</select><small>Set only the rate and account confirmed applicable for this business.</small></label>}
        <label>Agreed target total (optional)<input className={field} type="number" min="0.01" step="0.01" value={target} onChange={e=>setTarget(e.target.value)}/></label>{target&&<p className="sm:col-span-2">Difference from target: {money(total/100-Number(target))}. Enter an explicit discount above; item prices are never adjusted automatically.</p>}
        <div className="text-right sm:col-span-3"><p>Subtotal {money(subtotal / 100)}</p><p>Discount −{money(discount / 100)}</p><p>Tax {money(tax/100)}</p><p className="text-xl font-bold">Total {money(total / 100)}</p></div>
      </div>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">Payment stages</h2>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={()=>setStages([{...defaultStages[0],percent:50},{...defaultStages[2],percent:50}])}>50% + 50%</button><button type="button" className={button} onClick={()=>setStages(defaultStages)}>50% + 30% + 20%</button></div>
      {stages.map((stage, index) => <div key={index} className="flex items-end gap-3"><label className="flex-1">Stage<input required maxLength={200} className={field} value={stage.label} onChange={e => setStages(stages.map((s, i) => i === index ? { ...s, label: e.target.value } : s))} /></label><label className="w-24">Percent<input required className={field} type="number" min="0.01" max="100" step="0.01" value={stage.percent} onChange={e => setStages(stages.map((s, i) => i === index ? { ...s, percent: Number(e.target.value) } : s))} /></label><button aria-label={`Remove payment stage ${index + 1}`} type="button" className={button} onClick={() => setStages(stages.filter((_, i) => i !== index))}>Remove</button></div>)}
      <button className={button} type="button" disabled={stages.length >= 10} onClick={() => setStages([...stages, { label: "", percent: 0 }])}>+ Payment stage</button><p className="text-sm">Percentages must total 100%. Stage amounts use the total after discount.</p>
      <p role={stageTotal!==10000?'alert':undefined}>Schedule total: {stageTotal/100}%. {stageTotal===10000?amounts.map(a=>money(a)).join(' + '):'Must total 100% before saving.'}</p>
      <label className="block">Terms & conditions (one per line)<textarea required className={`${field} min-h-48`} maxLength={15000} value={terms} onChange={e => setTerms(e.target.value)} /></label>
      <label className="block">Remarks<textarea className={field} maxLength={5000} value={remarks} onChange={e=>setRemarks(e.target.value)}/></label>
    </section>
    <p className="text-sm text-slate-600">{correction?'Saving applies an audited correction, not a new invoice or payment.':'Saving a draft does not record income or payment. Preview it before issuing.'}</p>
    <button type="submit" className="rounded-lg bg-[#b58a2a] px-6 py-3 font-semibold text-white disabled:opacity-50" disabled={pending || !clientId || !items.length || total <= 0 || stageTotal!==10000}>{pending ? "Saving…" : correction?'Apply controlled correction':"Save draft & preview"}</button>
  </form>;
}

function SaveLineToLibrary({item,catalogue}:{item:WorkLine;catalogue:CatalogueItem[]}) {
  const existing=catalogue.find(c=>c.id===item.catalogue_id);
  const [code,setCode]=useState(item.item_code??''),[result,setResult]=useState(''),[busy,setBusy]=useState(false);
  async function save(update:boolean) {
    setBusy(true);setResult('');const form=new FormData();
    for(const [key,value] of Object.entries({id:update?existing!.id:crypto.randomUUID(),version:update?existing!.version??1:0,item_code:code,description:item.description,unit:item.unit,rate:item.rate,category:existing?.category??'',cost_price:existing?.cost_price??'',active:existing?.active===false?'false':'true',description_ms:item.translation_source===item.description?item.translations?.ms??'':'',description_zh:item.translation_source===item.description?item.translations?.zh??'':'',confirm_update:update?'yes':''}))form.set(key,String(value));
    try{const response=await saveCatalogueItem({},form);setResult(response.error??response.success??'Saved');}catch{setResult('Could not save the item. Please retry.');}finally{setBusy(false);}
  }
  return <details className="mt-2 text-xs"><summary className="cursor-pointer">Save to Item Library</summary><label>Item code<input aria-label={`Library code for ${item.description}`} className={field} value={code} onChange={e=>setCode(e.target.value)} maxLength={80}/></label><button className={button} type="button" disabled={busy||!code||!item.description} onClick={()=>save(false)}>Save as new item</button>{existing&&<button type="button" className={button} disabled={busy||!code} onClick={()=>{if(window.confirm(`Update master item ${existing.item_code??existing.description}? Other documents stay unchanged.`))void save(true);}}>Update existing master item</button>}{result&&<p role="status">{result}</p>}</details>;
}
