const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),resolve=Module._resolveFilename,load=Module._load;
let allowed=true,actor={id:'admin'},visible=true,rpcError=null,calls=[];
const db={from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{property_id:'property'}})}},rpc:async(name,args)=>{calls.push({name,args});return {data:args.p_reference,error:rpcError}}};
Module._resolveFilename=function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args)};
Module._load=function(request,...args){
  if(request==='next/navigation')return {useRouter:()=>({refresh(){}}),redirect(url){throw Error(url)}};
  if(request==='next/cache')return {revalidatePath(){}};
  if(request==='@/lib/auth/session')return {requireRole:async()=>{if(!allowed)throw Error('Forbidden');return 'admin'}};
  if(request==='@/lib/data/organization')return {getCurrentUser:async()=>actor,getProperties:async()=>visible?[{id:'property'}]:[]};
  if(request==='@/lib/supabase/admin')return {createAdminClient:()=>db};
  if(request==='./actions')return {reviewPaymentSubmission(){throw Error('Do not verify from Save')},reviewPaymentSubmissionInline(){throw Error('Do not verify from Save')},reversePaymentSubmission(){}};
  return load.call(this,request,...args);
};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {PaymentSlipRow}=require('../app/payment-verification/payment-slip-row.tsx');
const {savePaymentBankReference}=require('../app/payment-verification/reference-actions.ts');
const {paymentMatchesFilters,usableBankReference,bankReferenceRequired}=require('../lib/payments/verification-row.ts');
const row={submissionId:'s',status:'verified',tenantName:'Fixture Tenant',propertyName:'SLS',roomName:'D1',billMonth:'2026-09-01',paymentDate:'2026-09-01',amountSubmitted:'RM 100.00',amountSubmittedValue:100,paymentPurpose:'monthly_rent',invoiceOutstanding:100,rentOutstanding:100,depositOutstanding:0,referenceNumber:'',receiptIsImage:true,receiptUrl:'/fixture.png'};
const render=(extra={})=>renderToStaticMarkup(React.createElement('table',null,React.createElement('tbody',null,React.createElement(PaymentSlipRow,{row:{...row,...extra},paymentMethod:'bank_transfer',canCorrectPurpose:false,canReverse:false,returnTo:'/verification?view=payments',errorMessages:{}}))));
test('one row per slip with all columns; old verified missing-code row has input and Save, not Verify',()=>{
 const html=render();assert.equal((html.match(/<tr /g)||[]).length,1);assert.equal((html.match(/<td /g)||[]).length,9);
 for(const value of ['Fixture Tenant','SLS','D1','Sept 2026','RM 100.00','Bank Code','bank transfer','Verified','Enter bank code','>Save<'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/>Verify<|Rental folder|name="decision"/);
});
test('existing leading-zero and usable QR codes display without manual entry',()=>{
 for(const referenceNumber of ['00027588','QR00027588']){const html=render({referenceNumber});assert.ok(html.includes(referenceNumber));assert.doesNotMatch(html,/Enter bank code|>Save</)}
 assert.ok(render({referenceNumber:'QR PAYMENT'}).includes('Enter bank code'));
});
test('pending slip exposes Verify and missing-code input without any folder expansion',()=>{
 const html=render({status:'pending_verification'});assert.match(html,/>Verify</);assert.match(html,/Enter bank code/);assert.doesNotMatch(html,/<details/);
});
test('filters apply to each slip, keep old verified slips findable and never leak sibling months/status',()=>{
 const base={tenant_id:'t',payment_method:'bank_transfer',bill_month:'2026-08-01',payment_date:'2026-08-02',verification_status:'verified'};
 assert.equal(paymentMatchesFilters(base,{status:'verified',month:'2026-08'}),true);
 assert.equal(paymentMatchesFilters(base,{status:'pending_verification'}),false);
 assert.equal(paymentMatchesFilters(base,{status:'all',month:'2026-09'}),false);
 assert.equal(paymentMatchesFilters(base,{status:'all',tenant:'other'}),false);
});
test('usable QR code is reused; generic labels are not mistaken for transaction codes; cash optional',()=>{
 assert.equal(usableBankReference(' 00027588 '),'00027588');assert.equal(usableBankReference('QR PAYMENT'),'');
 assert.equal(usableBankReference('QR00027588'),'QR00027588');assert.equal(bankReferenceRequired('cash'),false);assert.equal(bankReferenceRequired('duitnow'),true);
});
test('Save calls only reference RPC with leading zeroes and previous value, never verification',async()=>{
 calls=[];const result=await savePaymentBankReference('s',' 00027588 ','');
 assert.equal(result.reference,'00027588');assert.deepEqual(calls,[{name:'save_payment_bank_reference',args:{p_submission:'s',p_actor:'admin',p_reference:'00027588',p_previous:''}}]);
});
test('duplicate message is explicit; invalid code and permission failures never write',async()=>{
 calls=[];rpcError={message:'duplicate_bank_reference'};assert.equal((await savePaymentBankReference('s','00027588','')).error,'This bank code is already linked to another payment.');rpcError=null;
 calls=[];assert.equal((await savePaymentBankReference('s','','')).error,'Please enter bank code.');assert.equal(calls.length,0);
 visible=false;assert.equal((await savePaymentBankReference('s','00027588','')).error,'Payment unavailable.');visible=true;
 allowed=false;await assert.rejects(savePaymentBankReference('s','00027588',''),/Forbidden/);allowed=true;assert.equal(calls.length,0);
});
