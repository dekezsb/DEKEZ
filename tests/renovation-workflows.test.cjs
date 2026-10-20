const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const m = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(id => Object.hasOwn(mocks, id) ? mocks[id] : require(id), m, m.exports);
  return m.exports;
}
const model = load('lib/renovation/model.ts');
const rentalMatch=load('lib/accounting/tenant-reconciliation.ts',{'./bank-room-scope':load('lib/accounting/bank-room-scope.ts')});
const reconciliation=load('lib/renovation/reconciliation.ts',{'@/lib/accounting/tenant-reconciliation':rentalMatch});
const link = ({href, children, ...props}) => React.createElement('a', {...props, href}, children);
const viewer = () => React.createElement('button', null, 'Preview slip');
const base = {id:'receipt',invoice_id:'invoice',amount:2800,status:'verified',bank_account_id:'bank',bank_transaction_id:'transaction',proof_path:'proof.pdf',proofUrl:'https://example.test/proof',reference_number:'00119128',payment_date:'2026-10-11',matched:0};
const invoices = [{id:'invoice',document_number:'DRI-TEST',client_snapshot:{name:'Example Client'},project:'Works'}];
test('payment loader scopes bank lines to selected company statements and subtracts existing allocations',async()=>{
  const queries=[];
  const db={from(table){const q={table,ops:[]};for(const method of ['select','eq','order','in','gt','neq','is'])q[method]=(...args)=>{q.ops.push([method,...args]);return q;};queries.push(q);return q;},storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'signed'}})})}};
  const {renovationPaymentData}=load('lib/renovation/payments.ts',{
    'server-only':{},'./server':{renovationContext:async()=>({db,company:{id:'company'}})},
    '@/lib/accounting/report-data':{allReportRows:async q=>({data:q.table==='renovation_payment_submissions'?[base]:q.table==='bank_statement_lines'?[{id:'line',bank_account_id:'bank',amount:2000}]:q.table==='bank_reconciliation_matches'?[{source_id:'transaction',statement_line_id:'line',matched_amount:1000}]:[],error:null})},
  });
  const invoice=await renovationPaymentData('invoice');
  assert.equal(invoice.payments[0].matched,1000);assert.equal(invoice.payments[0].proofUrl,'signed');
  assert.ok(!queries.some(q=>q.table==='bank_statement_lines'));
  const result=await renovationPaymentData(undefined,['statement']);
  assert.equal(result.lines[0].remaining,1000);
  const bank=queries.find(q=>q.table==='bank_statement_lines');
  for(const expected of [['eq','bank_statement_imports.company_id','company'],['eq','bank_statement_imports.status','in_progress'],['in','statement_import_id',['statement']],['is','duplicate_of_line_id',null],['neq','status','ignored']])assert.ok(bank.ops.some(op=>JSON.stringify(op)===JSON.stringify(expected)));
  assert.ok(queries.filter(q=>q.table==='renovation_payment_submissions').every(q=>q.ops.some(op=>op[0]==='eq'&&op[1]==='company_id'&&op[2]==='company')));
});
function mocks(data, manage = true) {
  return {
    'next/link':link,
    '@/lib/auth/session':{getCurrentUserAccess:async()=>({role:'super_admin',access:{}})},
    '@/lib/auth/access':{hasModuleAccess:(_a,_m,level)=>level==='view'||manage},
    '@/lib/renovation/payments':{renovationPaymentData:async(...args)=>{data.calls?.push(args);return data;}},
    '@/lib/renovation/model':model,
    '@/lib/renovation/reconciliation':reconciliation,
    '@/components/renovation/payments':{VerifyPayment:()=>React.createElement('button',null,'VERIFY ACTION'),MatchPayment:()=>React.createElement('button',null,'MATCH ACTION'),RenovationBulkReconcile:()=>React.createElement('button',null,'BULK ACTION'),MissingReference:()=>null},
    './receipt-viewer':{ReceiptViewer:viewer},
    '@/app/payment-verification/receipt-viewer':{ReceiptViewer:viewer},
  };
}
test('workflow redirects keep only permitted filters and force the correct workspace',()=>{
  for(const unsafe of ['https://evil.test','//evil.test','/\\evil.test','/renovation/other']) assert.equal(model.renovationWorkflowReturnTo(unsafe,'verification'),'/verification?view=payments#renovation-payments');
  const result = model.renovationWorkflowReturnTo('/reports?tab=profit&bankFlow=debit&month=2026-10&statement=one&redirect=https://evil.test','bank');
  assert.equal(result,'/reports?month=2026-10&statement=one&tab=bank&bankFlow=credit#renovation-reconciliation');
  assert.match(model.renovationWorkflowReturnTo('/verification?view=tenants&renovation_status=verified&tenant=one','verification'),/tenant=one&renovation_status=verified&view=payments/);
});
test('renovation Reports receipt shows payment records only, never bank status or reconciliation controls',()=>{
  const {PaymentCard}=load('components/renovation/payments.tsx',{'next/link':link,'@/lib/renovation/model':model,'@/app/payment-verification/receipt-viewer':{ReceiptViewer:viewer},'@/app/renovation/actions':{saveRenovationReference:async()=>({})}});
  for(const status of ['pending','verified','rejected']) for(const matched of [0,1000,2800]) {
    const html=renderToStaticMarkup(React.createElement(PaymentCard,{payment:{...base,status,matched,admin_uploaded:true}}));
    assert.doesNotMatch(html,/<form|Match verified payment|Verify payment|Bank matched|Fully matched|Reconciliation|Reconcile|line_id|tab=bank|verification\?view/);
    assert.match(html,/Payment date:.*2026-10-11/);assert.match(html,/Bank code \/ reference:.*00119128/);
    assert.match(html,status==='verified'?/RECORDED/:new RegExp(status.toUpperCase()));
  }
  const missing=renderToStaticMarkup(React.createElement(PaymentCard,{payment:{...base,admin_uploaded:true,reference_number:''},manage:true}));
  assert.match(missing,/Save bank code/);assert.match(missing,/name="payment_id" value="receipt"/);
  assert.doesNotMatch(missing,/Match verified payment|Verify payment|Bank matched|Fully matched|Reconciliation|Reconcile|line_id/);
});
test('central verification defaults to pending and never offers reapproval of verified receipts',async()=>{
  const data={payments:[base,{...base,id:'new',status:'pending',amount:100}],invoices,banks:[],lines:[]};
  const {RenovationPaymentVerification:View}=load('app/payment-verification/renovation-payments.tsx',mocks(data));
  const pending=renderToStaticMarkup(await View({params:{},returnTo:'/verification?view=payments'}));
  assert.match(pending,/1 awaiting approval/);assert.match(pending,/VERIFY ACTION/);assert.doesNotMatch(pending,/Bank matched:/);
  const verified=renderToStaticMarkup(await View({params:{renovation_status:'verified'},returnTo:'/verification?view=payments'}));
  assert.doesNotMatch(verified,/VERIFY ACTION/);assert.match(verified,/Bank matched:/);assert.match(verified,/00119128/);
});
test('missing proof and view-only users cannot approve; forbidden users load no renovation data',async()=>{
  const data={payments:[{...base,status:'pending',proofUrl:undefined}],invoices,banks:[],lines:[]};
  for(const manage of [true,false]) {
    const {RenovationPaymentVerification:View}=load('app/payment-verification/renovation-payments.tsx',mocks(data,manage));
    assert.doesNotMatch(renderToStaticMarkup(await View({params:{},returnTo:'/verification?view=payments'})),/VERIFY ACTION/);
  }
  const scoped=mocks(data);scoped['@/lib/auth/access']={hasModuleAccess:()=>false};scoped['@/lib/renovation/payments']={renovationPaymentData:()=>{throw Error('must not load');}};
  assert.equal(await load('app/payment-verification/renovation-payments.tsx',scoped).RenovationPaymentVerification({params:{},returnTo:'/verification?view=payments'}),null);
});
test('bank workspace shows only same-bank verified remaining receipts and scopes statement lines',async()=>{
  const data={payments:[{...base,matched:1000},{...base,id:'complete',reference_number:'COMPLETED',matched:2800},{...base,id:'pending',reference_number:'PENDING',status:'pending'},{...base,id:'other',reference_number:'OTHERBANK',bank_account_id:'other'}],invoices,banks:[],lines:[],calls:[]};
  const {RenovationBankReconciliation:View}=load('components/accounting/renovation-bank-reconciliation.tsx',mocks(data));
  const props={statementIds:['statement'],bankAccountId:'bank',locked:false,returnTo:'/reports?statement=statement'};
  const html=renderToStaticMarkup(await View(props));
  assert.match(html,/1,800.00/);assert.match(html,/MATCH ACTION/);assert.doesNotMatch(html,/COMPLETED|PENDING|OTHERBANK/);
  assert.deepEqual(data.calls,[[undefined,['statement']]]);
  assert.doesNotMatch(renderToStaticMarkup(await View({...props,locked:true})),/MATCH ACTION/);
  const readonly=load('components/accounting/renovation-bank-reconciliation.tsx',mocks(data,false)).RenovationBankReconciliation;
  assert.doesNotMatch(renderToStaticMarkup(await readonly(props)),/MATCH ACTION/);
});
test('verification and matching use existing scoped RPCs and invalidate the actual invoice',async()=>{
  const calls=[],invalidated=[];
  const query={select(){return this;},eq(...args){calls.push(['eq',...args]);return this;},async maybeSingle(){return {data:{invoice_id:'actual'}};}};
  const db={from(table){assert.equal(table,'renovation_payment_submissions');return query;},async rpc(name,args){calls.push([name,args]);return {};}};
  const actions=load('app/renovation/actions.ts',{
    '@/lib/renovation/server':{renovationContext:async manage=>{assert.equal(manage,true);return {db,company:{id:'company'},user:{id:'actor'}};}},
    '@/lib/auth/session':{requireRole:async(roles,permission)=>{assert.deepEqual(roles,['super_admin','admin']);assert.deepEqual(permission,{module:'verification',level:'manage'});}},
    '@/lib/renovation/model':model,
    '@/lib/renovation/payments':{},
    '@/lib/renovation/reconciliation':reconciliation,
    'next/cache':{revalidatePath:path=>invalidated.push(path)},
    '@/lib/renovation/saved-translations':require('./renovation-loader.cjs')('lib/renovation/saved-translations.ts'),
    'next/navigation':{redirect:path=>{throw Error('REDIRECT '+path);}},
  });
  const form=new FormData();for(const [key,value] of Object.entries({decision:'verify',confirm:'yes',payment_id:'receipt',invoice_id:'forged',transaction_id:'transaction',line_id:'line',return_to:'https://evil.test'}))form.set(key,value);
  await assert.rejects(actions.verifyRenovationPayment({},form),/REDIRECT \/verification/);
  assert.deepEqual(calls.find(c=>c[0]==='verify_renovation_payment')[1],{p_company:'company',p_actor:'actor',p_id:'receipt',p_accept:true,p_reason:null});
  assert.ok(invalidated.includes('/renovation/actual'));assert.ok(!invalidated.includes('/renovation/forged'));
  await assert.rejects(actions.matchRenovationPayment({},form),/REDIRECT \/reports/);
  assert.deepEqual(calls.find(c=>c[0]==='match_renovation_payment')[1],{p_company:'company',p_actor:'actor',p_transaction:'transaction',p_line:'line'});
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='status'&&c[2]==='verified'));
  form.set('decision','invalid');assert.match((await actions.verifyRenovationPayment({},form)).error,/Choose/);
  form.set('decision','verify');form.delete('confirm');assert.match((await actions.verifyRenovationPayment({},form)).error,/Confirm/);
});
test('admin receipts never appear in verification, even under all or verified filters',async()=>{
  const data={payments:[{...base,admin_uploaded:true}],invoices,banks:[],lines:[]};
  const {RenovationPaymentVerification:View}=load('app/payment-verification/renovation-payments.tsx',mocks(data));
  for(const status of ['pending','verified','all']) {
    const html=renderToStaticMarkup(await View({params:{renovation_status:status},returnTo:'/verification?view=payments'}));
    assert.doesNotMatch(html,/00119128|VERIFY ACTION/);
  }
});
test('saved PDF translations require manage access and the current company/version; append audit only',async()=>{
  const translationModule=require('./renovation-loader.cjs')('lib/renovation/saved-translations.ts');
  const id='11111111-1111-4111-8111-111111111111';
  const document={id,company_id:'company',version:3,items:[{description:'9MM board',quantity:1,unit:'LOT',rate:100}],stages:[{label:'Deposit',percent:100}],terms:'Included',remarks:''};
  const review={'item:0':{source:'9MM board',text:'9MM 板'},'stage:0':{source:'Deposit',text:'首期款'},terms:{source:'Included',text:'包括'}};
  const queries=[],writes=[];let allowed=true,found=true;
  const db={from(table){const q={select(){return q;},eq(...args){queries.push([table,...args]);return q;},async maybeSingle(){return {data:found?document:null,error:null};},async insert(value){writes.push({table,value});return {error:null};}};return q;}};
  const actions=load('app/renovation/actions.ts',{
    '@/lib/renovation/server':{renovationContext:async manage=>{assert.equal(manage,true);if(!allowed)throw Error('access denied');return {db,company:{id:'company'},user:{id:'actor'}};}},
    '@/lib/auth/session':{},'@/lib/renovation/model':model,'@/lib/renovation/payments':{},'@/lib/renovation/reconciliation':reconciliation,
    '@/lib/renovation/saved-translations':translationModule,'next/cache':{revalidatePath(){}},'next/navigation':{},
  });
  const form=new FormData();for(const [key,value] of Object.entries({id,version:'3',language:'zh',reviewed:'yes',review:JSON.stringify(review)}))form.set(key,value);
  assert.match((await actions.savePdfTranslations(form)).success,/saved/);
  assert.equal(writes.length,1);assert.equal(writes[0].table,'accounting_audit_logs');assert.equal(writes[0].value.entity_type,'renovation_translation');
  assert.deepEqual(writes[0].value.after_data,{document_version:3,language:'zh',review});assert.equal(writes[0].value.performed_by,'actor');
  assert.ok(queries.some(q=>q[1]==='company_id'&&q[2]==='company'));assert.ok(queries.some(q=>q[1]==='version'&&q[2]===3));
  found=false;assert.match((await actions.savePdfTranslations(form)).error,/changed/);assert.equal(writes.length,1);
  found=true;form.set('review',JSON.stringify({...review,total:1}));assert.match((await actions.savePdfTranslations(form)).error,/Unknown/);assert.equal(writes.length,1);
  allowed=false;await assert.rejects(actions.savePdfTranslations(form),/access denied/);
});
test('bank-code bulk candidates reject ambiguous/exhausted/other-bank receipts and preview running consumption',()=>{
  const payment={...base,reference_number:'119128'};
  const line={id:'line',bank_account_id:'bank',transaction_date:'2026-10-11',reference_number:'BANK 119128',description:'',remaining:2000};
  assert.equal(reconciliation.renovationBulkCandidates([payment],[line])[0].amount,2000);
  assert.deepEqual(reconciliation.renovationBulkCandidates([payment,{...payment,id:'other',bank_transaction_id:'tx2'}],[line]),[]);
  for(const changes of [{status:'pending'},{matched:2800},{bank_account_id:'other'},{reference_number:''},{payment_date:'2026-09-11'}])assert.deepEqual(reconciliation.renovationBulkCandidates([{...payment,...changes}],[line]),[]);
  for(const changes of [{blocked:true},{remaining:0},{reference_number:'991191280'},{matchedSourceIds:['transaction']}])assert.deepEqual(reconciliation.renovationBulkCandidates([payment],[{...line,...changes}]),[]);
  assert.deepEqual(reconciliation.renovationBulkCandidates([payment],[line,{...line,id:'line2'}]).map(c=>c.amount),[2000,800]);
});
