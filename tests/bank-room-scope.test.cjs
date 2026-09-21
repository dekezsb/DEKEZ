const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename,load=Module._load;
let mutations=0;
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);};
Module._load=function(request,...args){
  if(request==='next/navigation')return {useRouter:()=>({refresh(){}})};
  if(request==='@/app/reports/actions')return new Proxy({},{get:()=>()=>{mutations++;throw Error('Room suggestions must not post');}});
  return load.call(this,request,...args);
};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {bankRoomScope,paymentInBankScope,roomInvoicesForBank}=require('../lib/accounting/bank-room-scope.ts');
const {rankExistingPayments,directReconciliationPayment}=require('../lib/accounting/tenant-reconciliation.ts');
const {reconciliationViewGroup}=require('../lib/accounting/reconciliation-view.ts');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {TenantPaymentReconciliation}=require('../components/accounting/tenant-payment-reconciliation.tsx');
const b=(extra={})=>({id:'bank',amount:350,date:'2026-09-28',reference:'QR123456',description:'KLB 17',used:false,...extra});
const p=(extra={})=>({id:'right',tenant:'Right tenant',amount:350,date:'2026-09-07',property:'KLB - KOLOMBONG',propertyCode:'KLB',room:'Room 17',invoice:'SEP-17',invoiceId:'inv',invoiceMonth:'2026-09-01',receipt:'RECEIPT-1',reference:'',arReference:'AR-1',slipUrl:null,eligible:true,tenantStatus:'paid',reconciliationStatus:'PENDING',bankId:null,legacyMatched:false,...extra});
const inv=(extra={})=>({id:'inv',invoiceNumber:'SEP-17',billMonth:'2026-09-01',tenantName:'Right tenant',propertyCode:'KLB',roomCode:'17',rentOutstanding:0,...extra});
const render=(banks,payments,invoices=[])=>renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{banks,payments,invoices,locked:false,canUnmatch:true}));
test('every current property code constrains room and month even when payment is weeks apart',()=>{
  for(const code of ['PTT','DGG','BDS','BVH','INS','HLT','KLB','SLY','MGT','SLS']){
    const bank=b({description:`QR REF NO:123456 ${code} Room 017`});
    const correct=p({propertyCode:code,property:'Full property name'});
    const payments=[p({id:'wrong-property',propertyCode:code==='DGG'?'KLB':'DGG'}),{...correct,id:'wrong-room',room:'7'},{...correct,id:'previous-month',date:'2026-08-28'},{...correct,id:'old-invoice',invoiceMonth:'2026-08-01'},correct];
    assert.deepEqual(rankExistingPayments(bank,payments).map(x=>x.payment.id),['right']);
    assert.equal(directReconciliationPayment(bank,rankExistingPayments(bank,payments)).id,'right');
  }
});
test('letters, punctuation and repeated room references work; conflicting rooms fail closed',()=>{
  for(const text of ['SLS B4','sls-b4','SLS / ROOM B4','SLSB4']) assert.deepEqual(bankRoomScope(b({description:text})).hint,{propertyCode:'SLS',roomCode:'B4'});
  assert.deepEqual(bankRoomScope(b({reference:'KLB17',description:'KLB ROOM 017'})).hint,{propertyCode:'KLB',roomCode:'17'});
  const conflict=b({reference:'KLB 17',description:'DGG 17'});
  assert.equal(bankRoomScope(conflict).conflict,true);assert.equal(paymentInBankScope(conflict,p()),false);
  assert.deepEqual(rankExistingPayments(conflict,[p()]),[]);assert.equal(reconciliationViewGroup(conflict,[]),'review');
  assert.deepEqual(roomInvoicesForBank(conflict,[inv()]),[]);
  assert.equal(bankRoomScope(b({description:'Invoice number 17 only'})).hint,null);
});
test('dropdown is immediately visible and contains only identified room and month; filters remain',()=>{
  const html=render([b()],[p(),p({id:'wrong',tenant:'Other property',propertyCode:'SLY',property:'SLY',room:'3'}),p({id:'old',date:'2026-08-07'}),p({id:'wrong-month-invoice',invoiceMonth:'2026-08-01'})],[inv()]);
  const select=html.match(/<select[\s\S]*?<\/select>/)[0];
  assert.match(select,/value="right"/);assert.doesNotMatch(select,/value="wrong"|value="old"|value="wrong-month-invoice"/);
  assert.match(html,/Matching only KLB \/ Room 17/);assert.match(html,/SEP-17/);assert.match(html,/Filter reconciliation by confidence/);
  assert.doesNotMatch(html.match(/<button[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);
});
test('paid invoices and invoice-only rooms remain visible without inventing another payment',()=>{
  const invoices=[inv(),inv({id:'old',invoiceNumber:'AUG-17',billMonth:'2026-08-01'}),inv({id:'other',invoiceNumber:'WRONG-ROOM',roomCode:'7'})];
  const html=render([b()],[],invoices);
  assert.match(html,/href="\/invoices\/inv"/);assert.match(html,/Rent \/ charges balance: RM 0.00/);
  assert.doesNotMatch(html,/AUG-17|WRONG-ROOM/);assert.match(html,/No available confirmed payment/);
  assert.match(html.match(/<button[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);assert.equal(mutations,0);
});
test('split amounts stay in the correct room for review and duplicate receipts never become ready',()=>{
  const partial=b({amount:100}),master=p({amount:400});
  const ranked=rankExistingPayments(partial,[master]);assert.equal(ranked[0].payment.id,'right');assert.equal(ranked[0].status,'MANUAL_REVIEW');
  assert.equal(directReconciliationPayment(partial,ranked),null);
  const duplicates=[p(),p({id:'duplicate'})];assert.equal(directReconciliationPayment(b(),rankExistingPayments(b(),duplicates)),null);
  assert.equal(rankExistingPayments(b(),[p({bankId:'already'}),p({legacyMatched:true}),p({eligible:false})]).length,0);
});
test('month and code are loaded, paid invoices are passed to UI, and no posting functions change',()=>{
  const data=fs.readFileSync(path.join(root,'lib/accounting/tenant-reconciliation-data.ts'),'utf8');
  assert.match(data,/properties\(name,property_code\)/);assert.match(data,/rent_bills\(invoice_number,bill_month\)/);
  const page=fs.readFileSync(path.join(root,'app/reports/page.tsx'),'utf8');assert.match(page,/invoices=\{allInvoiceOptions\}/);
  assert.match(page,/legacyTenantNames\.get\(bill\.tenancy_id\)/);assert.equal(mutations,0);
});

test('bank property and room populate property and invoice columns for every property, even without a selectable payment',()=>{
  for(const code of ['PTT','DGG','BDS','BVH','INS','HLT','KLB','SLY','MGT','SLS']) {
    const bank=b({reference:'164195',description:`DUITNOW TRSF CR · PAYER NAME               ${code} B1`,date:'2026-09-02'});
    const invoice=inv({id:'september-b1',invoiceNumber:'DINV-2026-0907',propertyCode:code,roomCode:'Room B1',rentOutstanding:0});
    const html=render([bank],[],[invoice]);
    const row=html.slice(html.indexOf('<tbody>'),html.indexOf('</tbody>'));
    const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(x=>x[1]);
    assert.match(cells[1],new RegExp(`${code}<br/>Room B1`));
    assert.match(cells[2],/href="\/invoices\/september-b1"/);assert.match(cells[2],/DINV-2026-0907/);
    assert.match(html,/Filter reconciliation by confidence/);assert.equal(mutations,0);
  }
});
