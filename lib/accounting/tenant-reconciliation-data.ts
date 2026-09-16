import type { SupabaseClient } from '@supabase/supabase-js';
import { allReportRows } from './report-data';
import { flagDuplicateBanks, rankExistingPayments, type ExistingPayment, type StatementTransaction, type ReconciliationStatus } from './tenant-reconciliation';
const one = (value: any): any => Array.isArray(value) ? value[0] : value;
export async function loadExistingPayments(db: SupabaseClient, companyId: string, includeSlips = true, internalAccountingDb: SupabaseClient = db): Promise<ExistingPayment[]> {
  const [payments, states, matches, submissions] = await Promise.all([
    allReportRows(db.from('payments').select('id,amount,payment_date,reference_number,status,reversed_at,rent_bill_id,payment_submission_id,properties(name),rooms(room_number),tenancies(tenants(full_name)),rent_bills(invoice_number,bill_month),receipts(receipt_number),payment_submissions(receipt_url)').eq('company_id',companyId)),
    // This table deliberately has no tenant-facing grants. The reports page supplies
    // its server-only client after checking report access; all other reads retain RLS.
    allReportRows(internalAccountingDb.from('accounting_payment_reconciliations').select('*').eq('company_id',companyId)),
    allReportRows(db.from('bank_reconciliation_matches').select('id,source_id,source_type,statement_line_id').in('source_type',['payment','rent_bill'])),
    allReportRows(db.from('payment_submissions').select('id,amount,payment_date,reference_number,verification_status,receipt_url,rent_bill_id,properties!inner(name,company_id),rooms(room_number),tenancies(tenants(full_name)),tenant_applications(full_name),rent_bills(invoice_number,bill_month)').eq('properties.company_id',companyId)),
  ]);
  for(const [index,result] of [payments,states,matches,submissions].entries()) if(result.error) {
    const error=result.error as {code?:string;message?:string};
    console.error('[accounting-reconciliation] read failed',{source:['payments','internal_statuses','matches','submissions'][index],code:error.code,message:error.message});
    throw new Error('Unable to load reconciliation records. Please retry; no records were changed.');
  }
  const stateMap = new Map(states.data.map(s=>[s.payment_record_id,s]));
  const matchedPaymentIds = new Set(matches.data.filter(m=>m.source_type==='payment').map(m=>m.source_id));
  const linkedSubmissionIds = new Set(payments.data.map(p=>p.payment_submission_id));
  const paths = [...new Set([...payments.data.map(p=>one(p.payment_submissions)?.receipt_url),...submissions.data.map(s=>s.receipt_url)].filter((p):p is string=>Boolean(p)))];
  const slipUrls = new Map<string,string>();
  if (includeSlips) for(let offset=0;offset<paths.length;offset+=100) {
    const {data} = await db.storage.from('payment-receipts').createSignedUrls(paths.slice(offset,offset+100),3600);
    for(const slip of data??[]) if(slip.path&&slip.signedUrl) slipUrls.set(slip.path,slip.signedUrl);
  }
  const records:ExistingPayment[] = payments.data.map((p:any) => {
    const state:any = stateMap.get(p.id);
    const legacy = matches.data.some(m => (m.source_type==='payment' && m.source_id===p.id) || (m.source_type==='rent_bill' && m.source_id===p.rent_bill_id));
    const path = one(p.payment_submissions)?.receipt_url;
    return {id:p.id,tenant:one(one(p.tenancies)?.tenants)?.full_name ?? 'Unlinked tenant',property:one(p.properties)?.name ?? 'Unallocated',room:one(p.rooms)?.room_number ?? '—',
      invoice:one(p.rent_bills)?.invoice_number ?? '',invoiceId:p.rent_bill_id,invoiceMonth:one(p.rent_bills)?.bill_month ?? null,receipt:(p.receipts ?? []).map((r:any)=>r.receipt_number).join(', '),
      amount:Number(p.amount),date:p.payment_date ?? '',reference:p.reference_number ?? '',
      arReference:p.rent_bill_id ? `Existing invoice ${one(p.rent_bills)?.invoice_number ?? p.rent_bill_id} / payment ${p.id}` : 'No linked AR invoice',
      slipUrl:slipUrls.get(path) ?? null,eligible:p.status==='confirmed' && !p.reversed_at && Number(p.amount)>0,
      duplicate:Boolean(p.reference_number?.trim() && payments.data.some(other=>other.id!==p.id && matchedPaymentIds.has(other.id) && Number(other.amount)===Number(p.amount) && other.payment_date===p.payment_date && other.reference_number===p.reference_number)),
      tenantStatus:p.status,reconciliationStatus:state?.reconciliation_status ?? (legacy?'MANUAL_REVIEW':'PENDING'),bankId:state?.bank_transaction_id ?? null,legacyMatched:legacy && !state?.bank_transaction_id};
  });
  for(const s of submissions.data.filter(s=>!linkedSubmissionIds.has(s.id))) records.push({
    id:`submission:${s.id}`,submissionOnly:true,tenant:one(one(s.tenancies)?.tenants)?.full_name ?? one(s.tenant_applications)?.full_name ?? 'Unlinked tenant',
    property:one(s.properties)?.name ?? 'Unallocated',room:one(s.rooms)?.room_number ?? '—',invoice:one(s.rent_bills)?.invoice_number ?? '',invoiceId:s.rent_bill_id,invoiceMonth:one(s.rent_bills)?.bill_month ?? null,
    receipt:'Awaiting existing payment record',amount:Number(s.amount),date:s.payment_date??'',reference:s.reference_number??'',arReference:'Submission only — normal payment verification remains unchanged',
    slipUrl:slipUrls.get(s.receipt_url)??null,eligible:false,tenantStatus:s.verification_status,reconciliationStatus:'PENDING',bankId:null,legacyMatched:false,
  });
  return records;
}

export async function loadAccountingBankCredits(db:SupabaseClient,companyId:string):Promise<StatementTransaction[]> {
  const result=await allReportRows(db.from('bank_statement_lines').select('id,bank_account_id,statement_import_id,amount,transaction_date,reference_number,description,status,bank_statement_imports!inner(company_id,status),bank_reconciliation_matches(id,source_type,source_id,matched_amount)').eq('bank_statement_imports.company_id',companyId).neq('bank_statement_imports.status','void').gt('amount',0));
  if(result.error) throw new Error('Unable to load bank transactions. No records changed.');
  return flagDuplicateBanks(result.data.map(b=>({id:b.id,bankAccountId:b.bank_account_id,statementId:b.statement_import_id,amount:Number(b.amount),date:b.transaction_date,reference:b.reference_number??'',description:b.description??'',used:b.status!=='unmatched'||Boolean(b.bank_reconciliation_matches?.length),legacyPaymentLinks:b.bank_reconciliation_matches?.length&&b.bank_reconciliation_matches.every(m=>['payment','rent_bill'].includes(m.source_type))?b.bank_reconciliation_matches.map(m=>({sourceType:m.source_type,sourceId:m.source_id,amount:Number(m.matched_amount)})):[]})));
}

// Only internal accounting states are written. Never touch payment or receipt rows.
export async function refreshPaymentSuggestions(db:SupabaseClient,companyId:string) {
  const [payments,banks]=await Promise.all([loadExistingPayments(db,companyId,false),loadAccountingBankCredits(db,companyId)]);
  const states=new Map<string,ReconciliationStatus>();
  const appearances=new Map<string,number>();
  for(const bank of banks.filter(b=>!b.used)) {
    const ranked=rankExistingPayments(bank,payments);
    for(const candidate of ranked) {
      const id=candidate.payment.id;
      appearances.set(id,(appearances.get(id)??0)+1);
      states.set(id,candidate.status==='MANUAL_REVIEW'||states.get(id)==='MANUAL_REVIEW'?'MANUAL_REVIEW':'MATCH_SUGGESTED');
    }
  }
  const unlocked=payments.filter(p=>!p.submissionOnly&&!p.bankId&&!p.legacyMatched);
  if(!unlocked.length) return;
  const seeded=await db.from('accounting_payment_reconciliations').upsert(unlocked.map(p=>({payment_record_id:p.id,company_id:companyId})),{onConflict:'payment_record_id',ignoreDuplicates:true});
  if(seeded.error) throw new Error('Unable to refresh internal statuses. Payments unchanged.');
  for(const status of ['PENDING','UNMATCHED','MATCH_SUGGESTED','MANUAL_REVIEW'] as const) {
    const ids=unlocked.filter(p=>(p.duplicate||(appearances.get(p.id)??0)>1?'MANUAL_REVIEW':states.get(p.id)??(p.eligible?'UNMATCHED':'PENDING'))===status).map(p=>p.id);
    for(let offset=0;offset<ids.length;offset+=100) {
      const result=await db.from('accounting_payment_reconciliations').update({reconciliation_status:status,updated_at:new Date().toISOString()}).eq('company_id',companyId).is('bank_transaction_id',null).in('payment_record_id',ids.slice(offset,offset+100));
      if(result.error) throw new Error('Unable to refresh internal statuses. Payments unchanged.');
    }
  }
}
