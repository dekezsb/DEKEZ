const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {historicalMonth,historicalStatementRange,historicalCreditSummary}=require('../lib/accounting/historical-credit.ts');
test('historical UI applies only to fully bounded March-August 2026 statements',()=>{
  for(const m of ['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08'])assert.equal(historicalMonth(m),true);
  for(const m of ['2026-02','2026-09','2025-03','2027-08',''])assert.equal(historicalMonth(m),false);
  assert.equal(historicalStatementRange('2026-03-01','2026-08-31'),true);
  assert.equal(historicalStatementRange('2026-02-28','2026-08-31'),false);
  assert.equal(historicalStatementRange('2026-08-01','2026-09-01'),false);
  assert.equal(historicalStatementRange('2026-08-31','2026-08-01'),false);
});
test('preview totals distinguish prior allocation, existing link, new AR credit and excluded remainder exactly',()=>{
  const base={month:'2026-08',allocated:0,remaining:0,ready:0,new_ar_credit:0,reason:null};
  const s=historicalCreditSummary([
    {...base,amount:400,allocated:100,remaining:300,ready:200},
    {...base,amount:500,remaining:500,ready:500,new_ar_credit:500},
    {...base,amount:12.15,reason:'already_completed'},
    {...base,amount:13.51,remaining:13.51,reason:'transfer_or_non_rental'},
  ])[5];
  assert.deepEqual(s,{month:'2026-08',count:4,total:925.66,completed:112.15,ready:700,newCredit:500,excluded:113.51,readyCount:2});
  assert.equal(Math.round(s.total*100),Math.round(s.completed*100)+Math.round(s.ready*100)+Math.round(s.excluded*100));
});
test('empty preview retains all six zero-amount months',()=>{
  const s=historicalCreditSummary([]);assert.equal(s.length,6);assert.ok(s.every(r=>r.count===0&&r.ready===0&&r.total===0));
});
test('server authority, confirmation and retry identity remain server-controlled',()=>{
  const actions=fs.readFileSync(path.join(__dirname,'../app/reports/historical-credit-actions.ts'),'utf8');
  assert.match(actions,/requireRole\(\['super_admin', 'admin', 'owner'\], \{ module: 'reports', level: 'manage' \}/);
  assert.match(actions,/p_company: company.id, p_bank: bankId, p_actor: user.id/);
  assert.match(actions,/confirmed !== true/);assert.match(actions,/p_run: runId, p_hash: hash/);
  assert.doesNotMatch(actions,/\.from\(['"](?:payments|rent_bills|tenancies|receipts)['"]\)/);
  const ui=fs.readFileSync(path.join(__dirname,'../components/accounting/historical-credit-cleanup.tsx'),'utf8');
  assert.match(ui,/clearHistoricalCredits\(bankId, runId, preview.hash, confirmed\)/);
  assert.match(ui,/disabled=\{pending \|\| !confirmed \|\| ready <= 0\}/);
  assert.doesNotMatch(ui,/useEffect/);
});
