const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const {historicalCreditSummary}=require('../lib/accounting/historical-credit.ts');
const {balanceSnapshot}=require('../lib/accounting/balance-breakdown.ts');
test('September summary is separate; only frozen scope bypasses the normal matching table',()=>{
 const {septemberStatementRange,historicalMonth}=require('../lib/accounting/historical-credit.ts');
 assert.equal(historicalMonth('2026-09'),false);assert.equal(septemberStatementRange('2026-09-01','2026-09-30'),true);
 assert.equal(septemberStatementRange('2026-08-31','2026-09-30'),false);assert.equal(septemberStatementRange('2026-09-01','2026-10-01'),false);
 const summary=historicalCreditSummary([{month:'2026-09',amount:1200,allocated:600,remaining:600,ready:600,new_ar_credit:600,reason:null}],['2026-09']);
 assert.equal(summary.length,1);assert.equal(summary[0].ready,600);assert.equal(summary[0].completed,600);
 const page=read('app/reports/page.tsx');
 assert.match(page,/septemberScopeIds.has\(line.id\)/);assert.match(page,/scope="september"/);
 assert.match(page,/eq\("company_id", company.id\).eq\("bank_account_id", selectedStatement!.bank_account_id\)/);
 const action=read('app/reports/historical-credit-actions.ts');
 assert.match(action,/rpc\('preview_september_credit_cleanup'/);assert.match(action,/rpc\('clear_september_credit_cleanup'/);
});
test('July example is 83398 already completed, 18360 ready, zero missing-evidence exclusions',()=>{
 const totals=historicalCreditSummary([
 {month:'2026-07',amount:83398,allocated:83398,remaining:0,ready:0,new_ar_credit:0,reason:'already_completed'},
 {month:'2026-07',amount:18360,allocated:0,remaining:18360,ready:18360,new_ar_credit:18360,reason:null},
 ])[4];
 assert.equal(totals.total,101758);assert.equal(totals.completed,83398);assert.equal(totals.ready,18360);assert.equal(totals.newCredit,18360);assert.equal(totals.excluded,0);
});
test('v2 is the active server path; confirmation and current lock warning are retained',()=>{
 const action=read('app/reports/historical-credit-actions.ts'),ui=read('components/accounting/historical-credit-cleanup.tsx');
 assert.match(action,/'preview_historical_credit_classification'/);assert.match(action,/'clear_historical_credit_classification'/);
 assert.doesNotMatch(action,/rpc\('(?:preview|clear)_historical_rental_credits'/);
 assert.doesNotMatch(ui,/Protected exclusions|Missing accounting evidence is not treated/);
 assert.match(ui,/Clear all credit to Rental Receivable/);assert.match(ui,/preview.period_locked/);
});
test('report source is private, company-scoped, current-date AR-only; P&L does not read it',()=>{
 const page=read('app/reports/page.tsx');
 assert.match(page,/createAdminClient\(\).from\("historical_bank_credit_classifications"\)[^\n]+eq\("company_id", company.id\).lte\("classification_date", endDate\)/);
 assert.match(page,/if \(!selectedPropertyId\) for \(const entry of historicalClassifications\)/);
 assert.match(page,/manualNetDebitByAccount.set\(entry.account_id,[^\n]+- Number\(entry.amount\)/);
 assert.match(page,/for \(const entry of historicalClassifications\) addPosting\(entry.account_id,[^\n]+entry.classification_date/);
 assert.doesNotMatch(read('lib/accounting/report-data.ts'),/historical_bank_credit_classifications/);
 assert.doesNotMatch(page,/bankAssets\s*\+=.*historical/i);
});
test('current-date classification reduces AR once, leaves past snapshot/Bank/profit unchanged',()=>{
 const defs=[{key:'ar',code:'1100',label:'Rental Receivable',section:'Assets'},{key:'bank',code:'1000',label:'Bank',section:'Assets'},{key:'profit',code:'YTD',label:'Profit',section:'Equity'}];
 const base=defs.map((d,i)=>({...d,id:d.key,date:'2026-07-31',propertyId:null,propertyName:'Company',reference:'source',description:'existing',source:'existing',amount:[20000,50000,10000][i]}));
 const offset={...base[0],id:'classification',date:'2026-10-21',amount:-18360,source:'Historical bank classification'};
 const before=balanceSnapshot('2026-08-31',defs,base,''),historical=balanceSnapshot('2026-08-31',defs,[...base,offset],''),after=balanceSnapshot('2026-10-21',defs,[...base,offset],'');
 assert.deepEqual(historical,before);assert.equal(after.rows.find(r=>r.key==='ar').amount,1640);assert.equal(after.rows.find(r=>r.key==='bank').amount,50000);assert.equal(after.rows.find(r=>r.key==='profit').amount,10000);
});
