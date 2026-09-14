import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceSnapshot, balanceComparison, accountLedger } from '../../lib/accounting/balance-breakdown.ts';

test('asset ledger shows opening, separate debit/credit and closing in date order', () => {
  const details = [
    {id:'old',date:'2026-06-01',amount:100,source:'Posted journal'},
    {id:'purchase',date:'2026-07-02',amount:50.25,source:'Bank voucher / adjustment offset'},
    {id:'sale',date:'2026-07-03',amount:-20,source:'Posted journal'},
  ];
  const result=accountLedger(details,'Assets','2026-07-01','2026-07-31');
  assert.equal(result.opening,100); assert.equal(result.debit,50.25); assert.equal(result.credit,20); assert.equal(result.closing,130.25);
  assert.deepEqual(result.rows.map(r=>r.runningBalance),[150.25,130.25]);
});
test('liability credit increases balance, debit repayment reduces it, snapshots are not postings', () => {
  const result=accountLedger([{id:'loan',date:'2026-07-01',amount:1000,source:'Posted journal'},{id:'repay',date:'2026-07-02',amount:-100,source:'Bank voucher / adjustment offset'},{id:'snapshot',date:'2026-07-03',amount:25,source:'Verified bill currently unpaid'}],'Liabilities','2026-07-01','2026-07-31');
  assert.equal(result.credit,1000); assert.equal(result.debit,100); assert.equal(result.closing,925);
  assert.equal(result.rows[2].debit,null); assert.equal(result.balanceSupport,25);
});

const defs = [
  {key:'asset', code:'1500', label:'Equipment', section:'Assets'},
  {key:'loan', code:'2500', label:'Loan payable', section:'Liabilities'},
  {key:'empty', code:'1600', label:'Other asset', section:'Assets'},
];
const line = (key, id, date, amount, propertyId = 'a') => ({...defs.find(d => d.key === key), id, date, amount, propertyId, propertyName: propertyId, reference: id, description:'Test posting', source:'Voucher'});

test('supporting records reconcile in cents, cut off future postings and keep zero accounts', () => {
  const snapshot = balanceSnapshot('2026-07-31', defs, [line('asset','a','2026-07-01',100.10),line('asset','b','2026-07-03',20.20),line('asset','future','2026-08-01',999)]);
  const row = snapshot.rows.find(r => r.key === 'asset');
  assert.equal(row.amount, 120.30);
  assert.equal(row.details.length, 2);
  assert.equal(snapshot.rows.find(r => r.key === 'empty').amount, 0);
  for (const row of snapshot.rows) assert.equal(row.amount, row.details.reduce((s,d)=>s+Math.round(d.amount*100),0)/100);
});
test('comparison uses date balances rather than summing month-end balances', () => {
  const lines = [line('loan','june','2026-06-01',1000),line('loan','july','2026-07-01',-200)];
  const result = balanceComparison(balanceSnapshot('2026-07-31',defs,lines),balanceSnapshot('2026-06-30',defs,lines));
  const loan = result.find(r => r.key === 'loan');
  assert.equal(loan.amount,800); assert.equal(loan.priorAmount,1000); assert.equal(loan.change,-200);
  assert.equal(loan.details.length,2); assert.equal(loan.priorDetails.length,1);
});
test('outlet scope excludes other outlets but explicitly shared bank remains once', () => {
  const lines = [line('asset','a','2026-07-01',10,'a'),line('asset','b','2026-07-01',20,'b'),{...line('asset','shared','2026-07-01',30,null),shared:true}];
  assert.equal(balanceSnapshot('2026-07-31',defs,lines,'a').rows.find(r=>r.key==='asset').amount,40);
  assert.equal(balanceSnapshot('2026-07-31',defs,lines).rows.find(r=>r.key==='asset').amount,60);
});
test('accounts only present in the previous snapshot are not lost', () => {
  const prior=balanceSnapshot('2026-06-30',defs,[line('asset','x','2026-06-01',10)]);
  const result=balanceComparison(balanceSnapshot('2026-07-31',[],[]),prior);
  assert.equal(result.find(r=>r.key==='asset').change,-10);
});
