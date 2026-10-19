const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync('lib/renovation/model.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {totalCents,discountCents,stageAmounts,paymentSummary}=m.exports;
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
