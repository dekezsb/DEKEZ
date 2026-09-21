const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename, load = Module._load;
let mutations = 0;
Module._resolveFilename = function(request, ...args) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
Module._load = function(request, ...args) {
  if (request === 'next/navigation') return { useRouter: () => ({ refresh() {} }) };
  if (request === '@/app/reports/actions') return new Proxy({}, { get: () => () => { mutations++; throw Error('Filters must not post'); } });
  return load.call(this, request, ...args);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }, fileName: f,
}).outputText, f);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { TenantPaymentReconciliation } = require('../components/accounting/tenant-payment-reconciliation.tsx');
const { reconciliationViewGroup: group, reconciliationViewPriority: priority } = require('../lib/accounting/reconciliation-view.ts');
const { rankExistingPayments } = require('../lib/accounting/tenant-reconciliation.ts');
const p = (id, amount) => ({ id, amount, tenant: `Tenant ${id}`, property: 'DGG', room: '1', date: '2026-08-01', reference: '', invoice: '', invoiceId: null, receipt: `receipt-${id}`, arReference: '', slipUrl: null, eligible: true, tenantStatus: 'paid', reconciliationStatus: 'PENDING', bankId: null, legacyMatched: false });
const b = (id, amount, description, date = '2026-08-01') => ({ id, amount, description, date, reference: '', used: false });
const payments = [p('Alice', 100), p('Betty', 200), p('Cathy', 300)];
const banks = [b('unmatched', 999, 'No identity', '2026-08-30'), b('review', 301, 'DGG 1 Tenant Cathy'), b('high', 200, 'Tenant Betty', '2026-08-10'), b('exact', 100, 'Tenant Alice'), { ...b('completed', 100, 'Completed hidden'), completed: true }];
function render(filter = 'all', search = '', selected = {}) {
  const original = React.useState; let index = 0;
  React.useState = initial => original([search, filter, selected][index++] ?? initial);
  try { return renderToStaticMarkup(React.createElement(TenantPaymentReconciliation, { payments, banks, locked: false, canUnmatch: true })); }
  finally { React.useState = original; }
}
const rows = html => html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
test('all five filters stay in sticky header with counts and highest confidence first', () => {
  const html = render();
  assert.match(html, /sticky top-0/);
  for (const label of ['All (4)', 'Exact / High Confidence (2)', 'Possible Match (0)', 'Manual Review (1)', 'Unmatched (1)']) assert.ok(html.includes(label), label);
  assert.match(html, /Filter reconciliation by confidence/);
  assert.ok(rows(html).indexOf('Tenant Alice') < rows(html).indexOf('Tenant Betty'));
  assert.ok(rows(html).indexOf('Tenant Betty') < rows(html).indexOf('Tenant Cathy'));
  assert.doesNotMatch(html, /Completed hidden/);
});
test('filters combine with search and show a reset hint for an empty group', () => {
  assert.match(rows(render('high')), /Tenant Alice/);
  assert.match(rows(render('high')), /Tenant Betty/);
  assert.doesNotMatch(rows(render('high')), /Tenant Cathy|No matching receipt selected/);
  assert.match(render('high'), /Showing 2 of 4/);
  assert.match(render('high', 'Betty'), /Showing 1 of 4/);
  assert.match(render('possible'), /Choose All to see the other items/);
  assert.match(render('review'), /Showing 1 of 4/);
  assert.match(render('unmatched'), /Showing 1 of 4/);
});
test('unsafe selected matches remain review and filters never mutate payments', () => {
  const bank = banks[3], ranked = rankExistingPayments(bank, payments);
  assert.equal(group(bank, ranked), 'high');
  for (const override of [{ duplicate: true }, { used: true }]) assert.equal(group({ ...bank, ...override }, ranked), 'review');
  for (const override of [{ duplicate: true }, { eligible: false }, { amount: 120 }, { bankId: 'used' }, { legacyMatched: true }]) assert.equal(group(bank, ranked, { ...payments[0], ...override }), 'review');
  assert.equal(group(bank, [], payments[0]), 'review');
  assert.equal(group(bank, []), 'unmatched');
  assert.equal(group(bank, [{ ...ranked[0], confidence: 'Possible Match', status: 'MATCH_SUGGESTED' }]), 'possible');
  assert.ok(priority('high', 'Exact Match') < priority('high', 'High Confidence'));
  const before = JSON.stringify({ banks, payments });
  render('high'); render('review', '', { exact: 'Cathy' }); render('all');
  assert.equal(JSON.stringify({ banks, payments }), before);
  assert.equal(mutations, 0);
});
