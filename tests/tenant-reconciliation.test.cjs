const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
const load = Module._load;
Module._resolveFilename = function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);};
Module._load = function(request,...args){
  if(request==='next/navigation') return {useRouter:()=>({refresh(){}})};
  if(request==='@/app/reports/actions') return {};
  return load.call(this,request,...args);
};
for(const ext of ['.ts','.tsx']) Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {rankExistingPayments,flagDuplicateBanks,directReconciliationPayment}=require('../lib/accounting/tenant-reconciliation.ts');
const {loadExistingPayments,refreshPaymentSuggestions}=require('../lib/accounting/tenant-reconciliation-data.ts');
const {TenantPaymentReconciliation}=require('../components/accounting/tenant-payment-reconciliation.tsx');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const payment=(extra={})=>({id:'payment-1',tenant:'Example Tenant',property:'SLS - SULAMAN',room:'B4',invoice:'INV-1001',invoiceId:'bill',receipt:'REC-1001',amount:380,date:'2026-09-07',reference:'BANK-1234',arReference:'Existing invoice INV-1001',slipUrl:'https://example.invalid/slip',eligible:true,tenantStatus:'confirmed',reconciliationStatus:'PENDING',bankId:null,legacyMatched:false,...extra});
const bank=(extra={})=>({id:'bank-1',amount:380,date:'2026-09-08',reference:'',description:'Payment',used:false,...extra});

test('suggestions use exact amount with date, reference, identity and document in priority order',()=>{
  assert.equal(rankExistingPayments(bank(),[payment()])[0].priority,1);
  assert.equal(rankExistingPayments(bank({date:'2026-08-01',reference:'BANK-1234'}),[payment()])[0].priority,2);
  assert.equal(rankExistingPayments(bank({date:'2026-08-01',description:'Example Tenant'}),[payment()])[0].priority,3);
  assert.equal(rankExistingPayments(bank({date:'2026-08-01',description:'INV-1001'}),[payment()])[0].priority,4);
  assert.equal(rankExistingPayments(bank({amount:378}),[payment()])[0].priority,5);
  assert.equal(rankExistingPayments(bank({date:'2026-01-01'}),[payment()]).length,0,'amount alone is never sufficient');
});
test('same amount / date for two tenants is manual review, not an automatic match',()=>{
  const result=rankExistingPayments(bank(),[payment(),payment({id:'p2',tenant:'Another Tenant'})]);
  assert.ok(result.every(s=>s.status==='MANUAL_REVIEW'&&s.confidence==='Manual Review'));
  const resolved=rankExistingPayments(bank({reference:'BANK-1234'}),[payment(),payment({id:'p2',tenant:'Another Tenant',reference:'OTHER-REF'})]);
  assert.equal(resolved[0].payment.id,'payment-1');assert.equal(resolved[0].confidence,'Exact Match');
});
test('amount differences, duplicate references and conflicting room references require review',()=>{
  assert.equal(rankExistingPayments(bank({amount:379}),[payment()])[0].status,'MANUAL_REVIEW');
  assert.equal(rankExistingPayments(bank({description:'SLS B7'}),[payment()])[0].locationConflict,true);
  assert.equal(rankExistingPayments(bank({duplicate:true}),[payment()])[0].status,'MANUAL_REVIEW');
  assert.equal(rankExistingPayments(bank(),[payment({duplicate:true})])[0].status,'MANUAL_REVIEW');
});
test('already linked, legacy-linked, reversed and unconfirmed masters cannot be suggested',()=>{
  assert.equal(rankExistingPayments(bank(),[payment({bankId:'used'}),payment({legacyMatched:true}),payment({eligible:false})]).length,0);
  assert.equal(rankExistingPayments(bank({used:true}),[payment()]).length,0);
});
test('clear matches with a slip or receipt are ready without a separate selection click',()=>{
  for(const p of [payment({receipt:''}),payment({slipUrl:null})]){
    const b=bank();assert.equal(directReconciliationPayment(b,rankExistingPayments(b,[p])).id,p.id);
    const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[p],banks:[b],locked:false,canUnmatch:true}));
    assert.match(html,/Ready to reconcile/);assert.doesNotMatch(html,/Select Suggested Match/);
    const button=html.match(/<button\b[^>]*>Reconcile<\/button>/)?.[0];assert.ok(button);assert.doesNotMatch(button,/\sdisabled(?:=|>)/);
    for(const value of ['Receipt amount: RM 380.00','Bank amount: RM 380.00','Payment reference:','Bank reference:','SLS - SULAMAN'])assert.ok(html.includes(value));
  }
});
test('missing proof, ambiguous identities, mismatched rooms and duplicates still require manual review',()=>{
  for(const [b,payments] of [
    [bank(),[payment({slipUrl:null,receipt:''})]],
    [bank(),[payment(),payment({id:'p2',tenant:'Other Tenant'})]],
    [bank({description:'SLS B7'}),[payment()]],
    [bank({duplicate:true}),[payment()]],
    [bank({amount:379}),[payment()]],
  ]){
    assert.equal(directReconciliationPayment(b,rankExistingPayments(b,payments)),null);
    const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments,banks:[b],locked:false,canUnmatch:true}));
    assert.match(html.match(/<button\b[^>]*>Reconcile<\/button>/)?.[0]??'',/\sdisabled(?:=|>)/);
    assert.match(html,/>Manual Match<\/button>/);
  }
});
test('duplicate bank detection includes account, amount, date and reference; amount alone does not block',()=>{
  const result=flagDuplicateBanks([bank({id:'used',used:true,bankAccountId:'a',reference:'REF123'}),bank({bankAccountId:'a',reference:'REF123'}),bank({id:'other-account',bankAccountId:'b',reference:'REF123'}),bank({id:'different',bankAccountId:'a',reference:'REF999',description:'Different'})]);
  assert.equal(result[1].duplicate,true);assert.equal(result[2].duplicate,false);assert.equal(result[3].duplicate,false);
});
test('compact UI displays original receipt, slip, AR and bank details, and exposes admin-only unmatch',()=>{
  const render=(admin)=>renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[payment({bankId:'bank-1',reconciliationStatus:'RECONCILED'})],banks:[bank({used:true})],locked:false,canUnmatch:admin}));
  const html=render(true);
  for(const value of ['Example Tenant','INV-1001','REC-1001','BANK-1234','RECONCILED','View Receipt','View Slip','View Bank Transaction','AR reference','Unmatch']) assert.ok(html.includes(value),value);
  assert.ok(!render(false).includes('>Unmatch</button>'));
  assert.ok(!html.includes('type="file"'),'no tenant upload controls');
  assert.ok(!html.includes('Create payment'),'no payment creation controls');
});

function fakeDb(rows){
  const reads=[],writes=[];
  const db={reads,writes,storage:{from:()=>({createSignedUrls:async(paths)=>({data:paths.map(path=>({path,signedUrl:`https://example.invalid/${path}`}))})})},from(table){
    let filtered=rows[table]??[],range=[0,999],write=false;
    const q={select(){return q;},order(column){reads.push({table,column});return q;},range(a,b){range=[a,b];return q;},eq(){return q;},neq(){return q;},gt(){return q;},in(){return q;},is(){return q;},upsert(data){writes.push({table,op:'upsert',data});write=true;return q;},update(data){writes.push({table,op:'update',data});write=true;return q;},then(yes,no){return Promise.resolve({data:write?[]:filtered.slice(range[0],range[1]+1),error:null}).then(yes,no);}};return q;
  }};return db;
}
test('loader pages every payment, uses correct state primary key, and keeps orphan slips read-only',async()=>{
  const rows={payments:Array.from({length:501},(_,i)=>({id:`p${i}`,company_id:'c',amount:380,payment_date:'2026-09-07',status:'confirmed',reference_number:'',properties:{name:'SLS'},rooms:{room_number:'B4'},tenancies:{tenants:{full_name:'Example Tenant'}},receipts:[{receipt_number:`REC${i}`}]})),accounting_payment_reconciliations:[],bank_reconciliation_matches:[],payment_submissions:[{id:'orphan',amount:100,payment_date:'2026-09-07',receipt_url:'original.jpg',verification_status:'pending_verification',properties:{name:'SLS'},tenant_applications:{full_name:'Pending Applicant'}}]};
  const db=fakeDb(rows),before=JSON.stringify(rows);
  const result=await loadExistingPayments(db,'c');
  assert.equal(result.length,502);assert.equal(result.find(p=>p.id==='submission:orphan').eligible,false);
  assert.equal(result.find(p=>p.id==='submission:orphan').slipUrl,'https://example.invalid/original.jpg');
  assert.ok(db.reads.some(r=>r.table==='accounting_payment_reconciliations'&&r.column==='payment_record_id'));
  assert.equal(JSON.stringify(rows),before);assert.equal(db.writes.length,0);
});
test('refresh suggestions writes only internal reconciliation state, never tenant records',async()=>{
  const rows={payments:[{id:'p1',company_id:'c',amount:380,payment_date:'2026-09-07',status:'confirmed',reference_number:'R123',tenancies:{tenants:{full_name:'Example Tenant'}},receipts:[]}],accounting_payment_reconciliations:[],bank_reconciliation_matches:[],payment_submissions:[],bank_statement_lines:[{id:'b1',amount:380,transaction_date:'2026-09-07',status:'unmatched',description:'R123',reference_number:'R123',bank_reconciliation_matches:[]}]};
  const db=fakeDb(rows),before=JSON.stringify(rows);await refreshPaymentSuggestions(db,'c');
  assert.ok(db.writes.length>0);assert.ok(db.writes.every(w=>w.table==='accounting_payment_reconciliations'));
  assert.ok(db.writes.some(w=>w.data.reconciliation_status==='MATCH_SUGGESTED'));
  assert.equal(JSON.stringify(rows),before);
});
test('reports use a separate private accounting connection only for reconciliation states',async()=>{
  const regular=fakeDb({payments:[],payment_submissions:[],bank_reconciliation_matches:[]});
  const internal=fakeDb({accounting_payment_reconciliations:[]});
  const regularFrom=regular.from;
  regular.from=function(table){assert.notEqual(table,'accounting_payment_reconciliations','regular user connection must not access private accounting states');return regularFrom.call(this,table);};
  await loadExistingPayments(regular,'company',false,internal);
  assert.ok(internal.reads.length>0);
  assert.ok(internal.reads.every(r=>r.table==='accounting_payment_reconciliations'));
  assert.equal(regular.writes.length+internal.writes.length,0);
  const page=fs.readFileSync(path.join(root,'app/reports/page.tsx'),'utf8');
  assert.match(page,/loadExistingPayments\(supabase, company\.id, true, createAdminClient\(\)\)/);
  assert.ok(page.indexOf('await requireRole(')<page.indexOf('loadExistingPayments(supabase,'));
});
test('reconciliation RPCs contain no tenant or journal mutation; old tenant-creation action is disabled',()=>{
  for(const file of ['20260914151709_accounting_payment_link_only_reconciliation.sql','20260914153810_accounting_legacy_unmatch_audit.sql']){
    const sql=fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8');
    assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+(?:public\.)?(?:payments|receipts|rent_bills|accounting_journal_entries|accounting_journal_lines)\b/i);
    assert.match(sql,/security invoker/);assert.match(sql,/accounting_audit_logs/);
  }
  const actions=fs.readFileSync(path.join(root,'app/reports/actions.ts'),'utf8');
  assert.doesNotMatch(actions,/record_bank_tenant_payment_and_match/);
});
