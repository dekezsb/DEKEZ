const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');
const Module = require('node:module');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: f,
  }).outputText, f);
}

const {
  attachPrepaidElectricityTopUps,
  invoiceTotalsWithPrepaidTopUps,
} = require('../lib/billing/electricity-top-up-bill-lines.ts');

const bill = { id: 'bill-nov', tenancy_id: 'tenancy-1', bill_month: '2026-11-01' };

test('a verified electricity top-up appears on the month bill without changing rent outstanding', () => {
  const attached = attachPrepaidElectricityTopUps({
    bill,
    lineItems: [],
    topUps: [{
      id: 'topup-1',
      tenancy_id: 'tenancy-1',
      rent_bill_id: null,
      bill_month: '2026-11-01',
      amount: 50,
      status: 'approved_awaiting_top_up',
    }],
  });
  assert.equal(attached.lineItems.length, 1);
  assert.equal(attached.lineItems[0].alreadyPaid, true);
  assert.match(attached.lineItems[0].description, /Electricity \(Paid\)/);
  assert.equal(attached.prepaidAddedAmount, 50);

  const before = invoiceTotalsWithPrepaidTopUps({
    amount: 700, depositAmount: 0, paidAmount: 0, depositPaidAmount: 0,
    lineItems: [], prepaidAddedAmount: 0,
  });
  const after = invoiceTotalsWithPrepaidTopUps({
    amount: 700, depositAmount: 0, paidAmount: 0, depositPaidAmount: 0,
    lineItems: attached.lineItems, prepaidAddedAmount: attached.prepaidAddedAmount,
  });
  assert.equal(before.outstanding, 700);
  assert.equal(after.outstanding, 700);
  assert.equal(after.invoiceTotal, 750);
  assert.equal(after.invoicePaidAmount, 50);
});

test('pending or rejected slips stay off the invoice, and credited official lines are not duplicated', () => {
  const official = {
    id: 'line-1',
    category: 'top_up_utilities',
    description: 'Top Up Utilities - Electricity',
    amount: 50,
    smartMeterTopUpRequestId: 'topup-1',
  };
  const attached = attachPrepaidElectricityTopUps({
    bill,
    lineItems: [official],
    topUps: [
      { id: 'topup-1', tenancy_id: 'tenancy-1', rent_bill_id: 'bill-nov', bill_month: '2026-11-01', amount: 50, status: 'credited' },
      { id: 'topup-2', tenancy_id: 'tenancy-1', rent_bill_id: null, bill_month: '2026-11-01', amount: 30, status: 'pending_verification' },
      { id: 'topup-3', tenancy_id: 'tenancy-1', rent_bill_id: null, bill_month: '2026-10-01', amount: 80, status: 'approved_awaiting_top_up' },
    ],
  });
  assert.equal(attached.lineItems.length, 1);
  assert.equal(attached.lineItems[0].id, 'line-1');
  assert.equal(attached.lineItems[0].alreadyPaid, true);
  assert.equal(attached.prepaidAddedAmount, 0);

  const totals = invoiceTotalsWithPrepaidTopUps({
    amount: 700, depositAmount: 0, paidAmount: 50, depositPaidAmount: 0,
    lineItems: attached.lineItems, prepaidAddedAmount: 0,
  });
  assert.equal(totals.outstanding, 700);
});

test('the credit RPC and manual meter-credit action are left in place', () => {
  const rpc = fs.readFileSync(path.join(root, 'supabase/migrations/20261001160519_optional_meter_credit_for_topup.sql'), 'utf8');
  assert.match(rpc, /create or replace function public\.confirm_smart_meter_top_up_credit/);
  const actions = fs.readFileSync(path.join(root, 'app/verification/actions.ts'), 'utf8');
  assert.match(actions, /reviewSmartMeterTopUp/);
  assert.match(actions, /confirm_smart_meter_top_up_credit/);
  assert.doesNotMatch(actions, /confirm_smart_meter_top_up_credit[\s\S]*extendDoorAccessAfterPayment/);
});
