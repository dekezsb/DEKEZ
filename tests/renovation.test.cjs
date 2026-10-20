const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/renovation/model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {totalCents,discountCents,stageAmounts,paymentSummary}=m.exports;
test('converted quotations leave the active list but remain unchanged in their client folder',()=>{
  const docs=[
    {id:'q',client_id:'david',kind:'quotation',status:'approved'},
    {id:'i',client_id:'david',kind:'invoice',status:'issued',source_quotation_id:'q'},
    {id:'m',client_id:'michelle',kind:'invoice',status:'issued'},
    {id:'draft',client_id:'david',kind:'quotation',status:'draft'},
    {id:'open',client_id:'david',kind:'quotation',status:'issued'},
  ];
  const snapshot=JSON.stringify(docs);
  assert.deepEqual(m.exports.renovationWorkspaceDocuments(docs).map(d=>d.id),['i','m','draft','open']);
  assert.deepEqual(m.exports.renovationWorkspaceDocuments(docs,'david').map(d=>d.id),['q','i','draft','open']);
  assert.deepEqual(m.exports.renovationWorkspaceDocuments(docs,'unknown'),[]);
  assert.equal(JSON.stringify(docs),snapshot);
});
test('issued conversion link hides a quote; draft invoice does not archive an open quote',()=>{
  const quote={id:'q',kind:'quotation',status:'issued'};
  const invoice={id:'i',kind:'invoice',source_quotation_id:'q',status:'draft'};
  assert.equal(m.exports.renovationWorkspaceDocuments([quote,invoice]).length,2);
  assert.deepEqual(m.exports.renovationWorkspaceDocuments([quote,{...invoice,status:'issued'}]).map(d=>d.id),['i']);
});
test('client folders preserve company scope, filters and invoice-only outstanding',()=>{
  const page=fs.readFileSync('app/renovation/page.tsx','utf8');
  assert.match(page,/eq\("company_id", company.id\)/);
  assert.match(page,/type="hidden" name="client" value=\{client\}/);
  assert.match(page,/filter\(p => invoiceIds.has\(p.invoice_id\)\)/);
  assert.match(page,/Client folders/);
});

test('overview renders client folders once; invoices and quotations remain inside the selected folder',async()=>{
  const React=require('react'), {renderToStaticMarkup}=require('react-dom/server');
  const docs=[
    {id:'quote',client_id:'david',client_snapshot:{name:'David'},kind:'quotation',status:'approved',document_number:'DQ-TEST',project:'Apartment',created_at:'2026-10-01',total:2800},
    {id:'invoice',client_id:'david',client_snapshot:{name:'David'},kind:'invoice',status:'issued',document_number:'DRI-TEST',project:'Apartment',created_at:'2026-10-02',total:2800},
    {id:'other',client_id:'michelle',client_snapshot:{name:'Michelle'},kind:'invoice',status:'issued',document_number:'DRI-OTHER',project:'Shoplot',created_at:'2026-10-03',total:40000},
  ];
  const db={from(table){return {table,select(){return this;},eq(){return this;}};}};
  const mocks={
    'next/link':({children,...props})=>React.createElement('a',props,children),
    '@/components/renovation/forms':{ClientForm:()=>null,CatalogueForm:()=>null},
    '@/lib/renovation/server':{renovationContext:async()=>({db,company:{id:'company'}})},
    '@/lib/accounting/report-data':{allReportRows:async q=>({data:q.table==='renovation_documents'?docs:[],error:null})},
    '@/lib/renovation/model':m.exports,
    '@/lib/auth/session':{getCurrentUserAccess:async()=>({access:{}})},
    '@/lib/auth/access':{hasModuleAccess:()=>false},
  };
  const pageModule={exports:{}};
  new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/renovation/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),pageModule,pageModule.exports);
  const render=async params=>renderToStaticMarkup(await pageModule.exports.default({searchParams:Promise.resolve(params)}));
  const overview=await render({});
  assert.equal((overview.match(/href="\/renovation\?client=david"/g)||[]).length,1);
  assert.match(overview,/client=michelle/);
  assert.doesNotMatch(overview,/href="\/renovation\/(invoice|quote|other)"/);
  const folder=await render({client:'david'});
  assert.match(folder,/href="\/renovation\/invoice"/);assert.match(folder,/href="\/renovation\/quote"/);
  assert.doesNotMatch(folder,/DRI-OTHER/);
  for(const q of ['DQ-TEST','DRI-TEST','Apartment','David']) {
    const result=await render({q});assert.match(result,/client=david/);assert.doesNotMatch(result,/client=michelle/);
  }
  assert.match(await render({q:'not found'}),/No matching client folders/);
  assert.doesNotMatch(await render({q:'David',kind:'quotation'}),/client=michelle/);
});
test('quantity/rate rounding, percentage and fixed discount agree with cents-based totals',()=>{
  assert.equal(totalCents([{quantity:2798,rate:8.5}]),2378300);
  assert.equal(totalCents([{quantity:0.5,rate:0.01}]),1);
  assert.equal(discountCents(100000,'percent',10),10000);
  assert.equal(discountCents(100000,'amount',150),15000);
});
test('stage rounding allocates every sen exactly once',()=>{
  const amounts=stageAmounts(10001,[{percent:50},{percent:30},{percent:20}]);
  assert.deepEqual(amounts,[50.01,30,20]);
});
test('outstanding ignores pending/rejected slips and bank matching does not subtract twice',()=>{
  const p=[{amount:400,status:'verified',matched:200},{amount:300,status:'pending'},{amount:100,status:'rejected'}];
  assert.deepEqual(paymentSummary(900,p),{verified:400,pending:300,outstanding:500});
});
test('renovation receipts cannot recur as new income in other months',()=>{
  const source=fs.readFileSync('app/reports/page.tsx','utf8');
  assert.equal((source.match(/const isRecurringTemplate = candidate.sourceType === "manual_bank_transaction" && !candidate.isRenovation/g)||[]).length,4);
  assert.match(fs.readFileSync('app/reports/actions.ts','utf8'),/if \(candidate.isRenovation\)[\s\S]*?match_renovation_payment/);
});
