'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { rankExistingPayments, directReconciliationPayment, type ExistingPayment, type StatementTransaction } from '@/lib/accounting/tenant-reconciliation';
import { reconcileExistingPayment, unreconcileExistingPayment, refreshExistingPaymentSuggestions, unreconcileLegacyTenantBank } from '@/app/reports/actions';
const money = (n:number) => `RM ${n.toFixed(2)}`;
export function TenantPaymentReconciliation({ payments, banks, locked, canUnmatch }: {payments:ExistingPayment[];banks:StatementTransaction[];locked:boolean;canUnmatch:boolean}) {
  const [search,setSearch]=useState('');
  const [selected,setSelected]=useState<Record<string,string>>({});
  const [activeBank,setActiveBank]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const [pending,start]=useTransition();
  const router=useRouter();
  const suggestions=useMemo(()=>new Map(banks.map(b=>[b.id,rankExistingPayments(b,payments)])),[banks,payments]);
  const paymentById=useMemo(()=>new Map(payments.map(p=>[p.id,p])),[payments]);
  const paymentByBank=useMemo(()=>new Map(payments.filter(p=>p.bankId).map(p=>[p.bankId,p])),[payments]);
  const available=useMemo(()=>payments.filter(p=>p.eligible&&!p.bankId&&!p.legacyMatched),[payments]);
  const matchesSearch=(value:string)=>value.toLowerCase().includes(search.toLowerCase());
  function run(bankId:string,paymentId:string,unmatch=false) {
    const reason=unmatch ? window.prompt('Reason for unmatching this payment:') : null;
    if(unmatch && !reason) return;
    start(async()=>{
      try {
      const data=new FormData();data.set('lineId',bankId);data.set('paymentId',paymentId);if(reason)data.set('reason',reason);
      const result=await (unmatch ? paymentId ? unreconcileExistingPayment(data) : unreconcileLegacyTenantBank(data) : reconcileExistingPayment(data));
      setMessage(result.ok ? (unmatch?'Unmatched. Existing payment and receipt unchanged.':'RECONCILED — existing payment linked; nothing posted again.') : result.error);
      if(result.ok) router.refresh();
      } catch { setMessage('Unable to confirm the result. Refresh this page before retrying. Duplicate protection remains active.'); }
    });
  }
  return <section className="space-y-3 rounded-lg border bg-white p-4" id="bank-transactions">
    <h2 className="text-lg font-semibold">Tenant payments ↔ Bank statement</h2>
    <p className="text-sm text-slate-600">Link existing records only. No new payment, receipt or Accounts Receivable posting. Suggestions never reconcile automatically.</p>
    <p className="text-sm text-slate-600">Clear matches with a receipt or slip are ready: View Receipt, check the tenant and amount, then press Reconcile. Use Manual Match when proof is missing or the match needs review.</p>
    <button type="button" disabled={pending||locked} className="rounded border px-3 py-2 text-sm disabled:opacity-40" onClick={()=>start(async()=>{try{const result=await refreshExistingPaymentSuggestions();setMessage(result.ok?'Suggestions refreshed. No payments or receipts changed.':result.error);if(result.ok)router.refresh();}catch{setMessage('Unable to refresh suggestions. Please retry.');}})}>Refresh match suggestions</button>
    <input aria-label="Search reconciliation" className="w-full rounded border p-2" placeholder="Search tenant, property, room, invoice, receipt or bank reference" value={search} onChange={e=>setSearch(e.target.value)}/>
    {message ? <p role="status" className="rounded bg-blue-50 p-2 text-sm">{message}</p>:null}
    <div className="max-h-[65vh] overflow-auto rounded border"><table className="w-full text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-100"><tr>
      {['Existing tenant payment / receipt','Property / Room','Invoice / Receipt No.','Receipt amount / date','Payment reference / AR','Bank amount / date','Bank description / reference','Confidence / Status','Action'].map(h=><th key={h} className="p-2">{h}</th>)}
    </tr></thead><tbody>{banks.filter(b=>matchesSearch(`${b.description} ${b.reference} ${payments.find(p=>p.bankId===b.id)?.tenant ?? ''}`)|| (suggestions.get(b.id)??[]).some(s=>matchesSearch(`${s.payment.tenant} ${s.payment.property} ${s.payment.room} ${s.payment.invoice} ${s.payment.receipt}`))).map(bank=>{
      const linked=paymentByBank.get(bank.id);
      const ranked=suggestions.get(bank.id)??[];
      const readyPayment=directReconciliationPayment(bank,ranked);
      const chosenPayment=paymentById.get(selected[bank.id])??readyPayment;
      const payment=linked ?? paymentById.get(selected[bank.id]) ?? ranked[0]?.payment;
      const suggestion=payment ? ranked.find(s=>s.payment.id===payment.id) : ranked[0];
      const same=payment && Math.round(payment.amount*100)===Math.round(bank.amount*100);
      const duplicate=bank.duplicate||payment?.duplicate;
      const status=linked?'RECONCILED':bank.used||duplicate?'MANUAL_REVIEW':payment ? suggestion?.status ?? 'MANUAL_REVIEW' : ranked[0]?.status ?? 'UNMATCHED BANK TRANSACTION';
      return <tr key={bank.id} className={`border-t ${linked?'bg-emerald-50':''}`}>
        <td className="min-w-64 p-2">{linked ? linked.tenant : <><strong className="block">{payment?.tenant??'No matching receipt selected'}</strong>{readyPayment&&!selected[bank.id]?<span className="block text-emerald-700">Ready to reconcile</span>:null}<button type="button" disabled={bank.used||locked||pending} className="text-blue-700 underline disabled:opacity-40" onClick={()=>setActiveBank(activeBank===bank.id?null:bank.id)}>{readyPayment?'Change match':'Manual Match'}</button>{activeBank===bank.id?<select aria-label={`Existing payment for ${bank.reference || bank.id}`} className="mt-1 w-full rounded border p-1" value={selected[bank.id]??readyPayment?.id??''} onChange={e=>setSelected(previous=>({...previous,[bank.id]:e.target.value}))} disabled={bank.used||locked||pending}><option value="">Select existing payment</option>{available.map(p=><option value={p.id} key={p.id} disabled={p.duplicate}>{p.tenant} · {p.property} {p.room} · {money(p.amount)} · {p.date} · {p.reference||p.receipt||p.id.slice(0,8)}</option>)}</select>:null}</>}</td>
        <td className="p-2">{payment?.property}<br/>{payment?.room}</td><td className="p-2">{payment?.invoice||'—'}<br/>{payment?.receipt||'No receipt number'}</td>
        <td className="p-2 whitespace-nowrap">{payment?money(payment.amount):'—'}<br/>{payment?.date}</td><td className="max-w-48 break-words p-2">{payment?.reference||'—'}<details><summary>AR reference</summary>{payment?.arReference||'Select payment'}</details></td>
        <td className="whitespace-nowrap p-2">{money(bank.amount)}<br/>{bank.date}</td><td className="max-w-64 p-2"><details><summary className="cursor-pointer">View Bank Transaction</summary>{bank.description}<br/>{bank.reference}<br/>{bank.id}</details><span>{bank.reference||bank.description.slice(0,55)}</span></td>
        <td className="p-2"><strong>{status}</strong><br/>{!linked?suggestion?.confidence??(payment?'Manual Review':null):null}{duplicate?<p className="text-red-700">Possible duplicate transaction. Please review.</p>:null}{suggestion?.locationConflict?<p className="text-red-700">Bank property / room reference differs. Check the correct tenant.</p>:null}{bank.used&&!linked?<p>Existing allocation — locked for review.</p>:null}{payment&&!same?<p className="text-red-700">Amount differs. Manual review required.</p>:null}</td>
        <td className="min-w-36 p-2">{linked ? canUnmatch?<button type="button" disabled={pending} className="text-red-700 underline" onClick={()=>run(bank.id,linked.id,true)}>Unmatch</button>:null : <button type="button" disabled={!chosenPayment||!payment||!same||bank.used||locked||pending||Boolean(payment.bankId)||payment.legacyMatched||duplicate} className="rounded bg-emerald-700 px-3 py-2 text-white disabled:opacity-40" onClick={()=>chosenPayment&&run(bank.id,chosenPayment.id)}>Reconcile</button>}
          {payment?<details className="mt-1"><summary>View Receipt</summary><div className="mt-2 space-y-1 rounded border bg-white p-2"><strong>{payment.tenant}</strong><p>{payment.property} / {payment.room}</p><p>Invoice: {payment.invoice||'—'}<br/>Receipt: {payment.receipt||'No receipt number assigned'}</p><p>Receipt amount: {money(payment.amount)}<br/>Bank amount: {money(bank.amount)}</p><p>Payment date: {payment.date}<br/>Bank date: {bank.date}</p><p>Payment reference: {payment.reference||'—'}<br/>Bank reference: {bank.reference||bank.description}</p>{payment.slipUrl?<a className="block text-blue-700 underline" target="_blank" rel="noreferrer" href={payment.slipUrl}>Open original payment slip</a>:null}<p>Existing payment {payment.id}<br/>Tenant status (unchanged): {payment.tenantStatus}</p></div></details>:null}
          {payment?.slipUrl?<a className="block text-blue-700 underline" target="_blank" rel="noreferrer" href={payment.slipUrl}>View Slip</a>:null}
          {!linked&&bank.legacyPaymentLinks?.length?<details className="mt-1"><summary>Review existing allocation</summary>{bank.legacyPaymentLinks.map(link=><p key={`${link.sourceType}:${link.sourceId}`}>{paymentById.get(link.sourceId)?.tenant??link.sourceType} · {money(link.amount)} · {link.sourceId}</p>)}{canUnmatch?<button type="button" disabled={pending} className="text-red-700 underline" onClick={()=>run(bank.id,'',true)}>Unmatch legacy links</button>:null}</details>:null}
        </td></tr>;
    })}</tbody></table></div>
    <details><summary className="cursor-pointer font-semibold">All existing payments / receipts ({payments.length}) — including pending and unmatched</summary>
      <p className="py-2 text-xs text-slate-600">Slips awaiting an existing confirmed payment are read-only here. Continue to use your normal payment verification; reconciliation does not create or verify tenant payments.</p>
      <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['Tenant','Property / Room','Invoice','Receipt','Amount / Date','Reference','Reconciliation status','Slip'].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{payments.filter(p=>matchesSearch(`${p.tenant} ${p.property} ${p.room} ${p.invoice} ${p.receipt} ${p.reference}`)).map(p=><tr className="border-t" key={p.id}><td className="p-2">{p.tenant}</td><td>{p.property} / {p.room}</td><td>{p.invoice||'—'}</td><td>{p.receipt||'—'}</td><td>{money(p.amount)} / {p.date}</td><td>{p.reference||'—'}</td><td>{p.bankId?'RECONCILED':p.legacyMatched?'MANUAL_REVIEW':p.reconciliationStatus}{!p.eligible?' — existing payment not confirmed / reversed':''}</td><td>{p.slipUrl?<a href={p.slipUrl} target="_blank" rel="noreferrer">View Slip</a>:'—'}</td></tr>)}</tbody></table></div>
    </details>
  </section>;
}
