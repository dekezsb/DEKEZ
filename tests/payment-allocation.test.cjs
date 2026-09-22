const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const resolve=Module._resolveFilename,load=Module._load;
Module._resolveFilename=function(r,...a){return resolve.call(this,r.startsWith('@/')?path.join(root,r.slice(2)):r,...a)};
Module._load=function(r,...a){if(r==='next/navigation')return {useRouter:()=>({refresh(){}})};if(r==='@/app/reports/actions')return {};return load.call(this,r,...a)};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {existingPaymentChoices,canAllocateExistingPayment,canBulkGroupPayments,allocationAmount}=require('../lib/accounting/payment-allocation.ts');
const {TenantPaymentReconciliation}=require('../components/accounting/tenant-payment-reconciliation.tsx');
const {loadExistingPayments,loadAccountingBankCredits}=require('../lib/accounting/tenant-reconciliation-data.ts');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const p=(x={})=>({id:'a',tenant:'HO MUI FATT',tenancyId:'tenancy',property:'MGT',propertyCode:'MGT',room:'15',invoice:'DINV-2026-0919',invoiceId:'inv',invoiceMonth:'2026-09-01',receipt:'',amount:380,date:'2026-09-10',reference:'',arReference:'inv',slipUrl:'https://example.invalid/slip',eligible:true,tenantStatus:'confirmed',reconciliationStatus:'PENDING',bankId:null,legacyMatched:false,submissionId:'slip',slipVerified:true,...x});
const bank=(x={})=>({id:'bank',amount:480,date:'2026-09-10',reference:'036080',description:'DUITNOW Mgt 15',used:false,...x});
test('one verified RM480 slip combines existing RM380 and RM100, enables Reconcile, keeps one invoice',()=>{
  const parts=[p(),p({id:'b',amount:100})],before=JSON.stringify(parts);
  const choices=existingPaymentChoices(parts);assert.equal(choices.length,1);assert.equal(choices[0].amount,480);
  assert.equal(choices[0].allocationParts.length,2);assert.equal(canAllocateExistingPayment(bank(),choices[0]),true);
  const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:parts,banks:[bank()],locked:false,canUnmatch:true}));
  assert.match(html,/Same verified slip: RM 380.00 \+ RM 100.00 = RM 480.00/);
  assert.doesNotMatch(html.match(/<button\b[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);
  assert.match(html,/DINV-2026-0919/);assert.match(html,/Filter reconciliation by confidence/);
  assert.equal(JSON.stringify(parts),before);
});
test('partial bank transfer consumes only remaining verified amount irrespective of paid invoice',()=>{
  const master=p({amount:400,remainingAmount:300,reconciledAmount:100});
  assert.equal(canAllocateExistingPayment(bank({amount:300}),master),true);
  assert.equal(canAllocateExistingPayment(bank({amount:500}),master),true);
  assert.equal(allocationAmount(bank({amount:500}),master),300);
  assert.equal(canAllocateExistingPayment(bank({amount:50}),master),true,'small amount is reconciliation, not a new electricity charge');
  assert.equal(existingPaymentChoices([p({remainingAmount:0,reconciliationStatus:'RECONCILED'})]).length,0);
});

test('one verified slip across different paid invoices is one usable group with both invoice details',()=>{
  const parts=[p(),p({id:'b',amount:100,invoiceId:'inv-b',invoice:'DINV-B',arReference:'inv-b'})];
  const before=JSON.stringify(parts),[choice]=existingPaymentChoices(parts);
  assert.equal(choice.amount,480);assert.equal(choice.eligible,true);
  assert.equal(canAllocateExistingPayment(bank(),choice),true);
  assert.deepEqual(choice.allocationParts.map(x=>x.invoiceId),['inv','inv-b']);
  const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:parts,banks:[bank()],locked:false,canUnmatch:true}));
  assert.match(html,/Existing invoice allocations/);assert.match(html,/DINV-2026-0919/);assert.match(html,/DINV-B/);
  assert.doesNotMatch(html.match(/<button\b[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);
  assert.equal(JSON.stringify(parts),before);
});

test('multi-invoice group checks every child month and retains the unpaid reconciliation remainder',()=>{
  const [invalid]=existingPaymentChoices([p(),p({id:'b',amount:100,invoiceId:'inv-b',invoiceMonth:'2026-08-01'})]);
  assert.equal(canAllocateExistingPayment(bank(),invalid),false);
  const [partial]=existingPaymentChoices([p({remainingAmount:0,reconciliationStatus:'RECONCILED',bankId:'prior'}),p({id:'b',amount:100,invoiceId:'inv-b',remainingAmount:80})]);
  assert.equal(partial.remainingAmount,80);assert.equal(partial.amount,480);
  assert.equal(canAllocateExistingPayment(bank({amount:100}),partial),true);
  assert.equal(allocationAmount(bank({amount:100}),partial),80);
});
test('one exhausted portion does not hide the remaining portion of the same slip',()=>{
  const choices=existingPaymentChoices([p({remainingAmount:0,reconciledAmount:380,bankId:'prior',reconciliationStatus:'RECONCILED'}),p({id:'b',amount:100,remainingAmount:100})]);
  assert.equal(choices.length,1);assert.equal(choices[0].remainingAmount,100);assert.equal(choices[0].bankId,null);
  assert.equal(canAllocateExistingPayment(bank({amount:100}),choices[0]),true);
});
test('never merge separate slips or tenants merely because invoice or amount matches',()=>{
  assert.equal(existingPaymentChoices([p(),p({id:'b',submissionId:'another',amount:100})]).length,2);
  const mixed=existingPaymentChoices([p(),p({id:'b',tenancyId:'other'})]);assert.ok(mixed.every(p=>!p.eligible));
  assert.equal(canAllocateExistingPayment(bank({amount:50,description:'MGT 16'}),p()),false);
  assert.equal(canAllocateExistingPayment(bank({amount:50,date:'2026-08-10'}),p()),false);
  for(const x of [{duplicate:true},{legacyMatched:true},{eligible:false},{bankId:'used'}])assert.equal(canAllocateExistingPayment(bank({amount:50}),p(x)),false);
  assert.equal(canAllocateExistingPayment(bank({amount:50,used:true}),p()),false);
});
test('partial bank remains visible even after one payment is fully reconciled to it',()=>{
  const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[p({amount:380,remainingAmount:0,bankId:'bank',reconciliationStatus:'RECONCILED'}),p({id:'next',amount:120,submissionId:'next'})],banks:[bank({amount:500,allocatedAmount:380,remainingAmount:120})],locked:false,canUnmatch:true}));
  assert.match(html,/1 bank transactions still in process/);assert.match(html,/Remaining: RM 120.00/);
  assert.doesNotMatch(html.match(/<button\b[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);
});
test('unique identified slip enables Reconcile for either larger or smaller bank amount',()=>{
  for(const amount of [300,500]) {
    const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[p({amount:480})],banks:[bank({amount})],locked:false,canUnmatch:true}));
    assert.doesNotMatch(html.match(/<button\b[^>]*>Reconcile<\/button>/)[0],/\sdisabled(?:=|>)/);
    assert.match(html,new RegExp(`Reconcile RM ${Math.min(480,amount)}.00 now`));
    assert.match(html,new RegExp(`Bank remaining after: RM ${Math.max(0,amount-480)}.00`));
    assert.match(html,new RegExp(`Payment remaining after: RM ${Math.max(0,480-amount)}.00`));
  }
});
test('bank loader exposes remaining amount and keeps modern partial bank usable',async()=>{
  const data=[{id:'bank',amount:500,status:'unmatched',bank_reconciliation_matches:[{source_type:'payment',source_id:'p',matched_amount:380,existing_payment_link:true}]}];
  const db={from(){const q={select(){return q},eq(){return q},neq(){return q},gt(){return q},order(){return q},range(){return q},then(yes,no){return Promise.resolve({data,error:null}).then(yes,no)}};return q}};
  const [b]=await loadAccountingBankCredits(db,'company');assert.equal(b.allocatedAmount,380);assert.equal(b.remainingAmount,120);assert.equal(b.used,false);assert.equal(b.completed,false);
});
test('data loader keeps trusted partial payments available and legacy partials locked',async()=>{
  const rows={payments:[{id:'p',amount:400,status:'confirmed',payment_date:'2026-09-10',reference_number:null,payment_submission_id:'s',tenancy_id:'t',payment_submissions:{verification_status:'verified'},properties:{property_code:'MGT'},rooms:{room_number:'15'}}],accounting_payment_reconciliations:[],bank_reconciliation_matches:[{source_type:'payment',source_id:'p',statement_line_id:'bank',matched_amount:100,existing_payment_link:true}],payment_submissions:[]};
  const db={from(table){const q={select(){return q},eq(){return q},in(){return q},order(){return q},range(){return q},then(yes,no){return Promise.resolve({data:rows[table],error:null}).then(yes,no)}};return q},storage:{from:()=>({createSignedUrls:async()=>({data:[]})})}};
  let result=await loadExistingPayments(db,'c',false);assert.equal(result[0].remainingAmount,300);assert.equal(result[0].legacyMatched,false);
  rows.bank_reconciliation_matches[0].existing_payment_link=false;
  result=await loadExistingPayments(db,'c',false);assert.equal(result[0].legacyMatched,true);
});

test('canBulkGroupPayments: same tenant + distinct amounts group; different tenants or an equal-amount pair never do',()=>{
  assert.equal(canBulkGroupPayments([p()]),true,'a single candidate is trivially groupable');
  assert.equal(canBulkGroupPayments([p({id:'a',amount:100}),p({id:'b',amount:350})]),true,'same tenancyId, distinct amounts');
  assert.equal(canBulkGroupPayments([p({id:'a',tenancyId:null,amount:100}),p({id:'b',tenancyId:null,amount:350})]),true,'falls back to tenant name + property/room when tenancyId is missing');
  assert.equal(canBulkGroupPayments([p({id:'a',tenancyId:null,amount:100}),p({id:'b',tenancyId:'other',amount:350})]),true,'only one side has a tenancyId — still falls back to name + property/room');
  assert.equal(canBulkGroupPayments([p({id:'a',amount:100}),p({id:'b',tenancyId:'other-tenancy',amount:350})]),false,'different tenancyId is never grouped, even with the same name');
  assert.equal(canBulkGroupPayments([p({id:'a',tenancyId:null,amount:100}),p({id:'b',tenancyId:null,tenant:'Other Tenant',amount:350})]),false,'different tenant name is never grouped');
  assert.equal(canBulkGroupPayments([p({id:'a',tenancyId:null,amount:100}),p({id:'b',tenancyId:null,room:'16',amount:350})]),false,'different room is never grouped even with the same name');
  assert.equal(canBulkGroupPayments([p({id:'a',amount:350}),p({id:'b',amount:350})]),false,'an equal-amount pair could be indistinguishable duplicates — never grouped');
  assert.equal(canBulkGroupPayments([p({id:'a',amount:100}),p({id:'b',amount:200}),p({id:'c',amount:100})]),false,'any equal-amount pair blocks the whole group, not just the two that match');
});

test('bulk panel combines a same-tenant deposit and rent invoice identified on one bank line into one multi-payment item',()=>{
  const deposit=p({id:'deposit',invoice:'',invoiceId:null,receipt:'REC-DEP',amount:100,submissionId:'slip-deposit',arReference:''});
  const rent=p({id:'rent',invoice:'DINV-2026-0861',invoiceId:'bill-rent',receipt:'REC-RENT',amount:350,submissionId:'slip-rent'});
  const line=bank({amount:450});
  const html=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[deposit,rent],banks:[line],locked:false,canUnmatch:true}));
  assert.match(html,/Ready to reconcile by room match \(1\)/,'one bank line, even though it covers two payments');
  assert.match(html,/Reconcile all 1 now/);
  const panel=html.slice(html.indexOf('Ready to reconcile by room match'),html.indexOf('Filter reconciliation by confidence'));
  assert.match(panel,/RM 100\.00/);assert.match(panel,/RM 350\.00/);
  assert.match(panel,/split across 2 payments/);
  assert.equal((panel.match(/HO MUI FATT/g)||[]).length,2,'one preview row per payment');
});

test('bulk panel never auto-groups different tenants or an equal-amount pair identified on the same bank line',()=>{
  const line=bank({amount:450});
  const differentTenant=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[p({id:'a',invoiceId:'inv-a',amount:100,submissionId:'slip-a'}),p({id:'b',tenancyId:'other-tenancy',tenant:'Other Tenant',invoiceId:'inv-b',amount:350,submissionId:'slip-b'})],banks:[line],locked:false,canUnmatch:true}));
  assert.doesNotMatch(differentTenant,/Ready to reconcile by room match/,'ambiguous across two different tenants stays manual, never auto-bulked');
  const equalAmounts=renderToStaticMarkup(React.createElement(TenantPaymentReconciliation,{payments:[p({id:'a',invoiceId:'inv-a',amount:350,submissionId:'slip-a'}),p({id:'b',invoiceId:'inv-b',amount:350,submissionId:'slip-b'})],banks:[line],locked:false,canUnmatch:true}));
  assert.doesNotMatch(equalAmounts,/Ready to reconcile by room match/,'an equal-amount pair could be indistinguishable duplicates, so it stays manual too');
});
